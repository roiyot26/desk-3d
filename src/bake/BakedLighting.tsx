import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { mixLevel, setAmbientOffLevel } from '../LightMixer'
import { expectFile, fileDone, fileProgress } from '../progress'
import { BAKE_DIR, type BakeGroupName, type BakeManifest, getKTX2Loader } from './assets'

/**
 * Baked lighting for Wanda's web package (README_FORGE.md §2):
 *
 *   linear_g   = srgb_to_linear(texel_g) * scale_g        (KTX2 is sRGB-tagged: the GPU decodes it)
 *   irradiance = Σ_g linear_g * intensity_g               (intensity 0 = off, 1 = as in Cycles)
 *
 * The six lightmaps (2048², no mips) are summed 1:1 into ONE HalfFloat render target with a
 * fullscreen quad, and only when an intensity changes (switch ramps are ~250 ms, see LightMixer).
 * The target is mipmapped and used as `lightMap` (channel 1 = TEXCOORD_1) on every mesh that has
 * a second UV set, with lightMapIntensity = π (three's BRDF_Lambert divides by π).
 *
 * Intensities: DeskLamp = desk, FloorLamp = floor, Fill + Pictures = ambient (the room circuit:
 * wall switch / HUD toggle), Neon = neon, Window = always 1. Agentic-mode dimming and the neon
 * pulse come through the same mixer levels.
 *
 * The env map (equirect, reflections only) goes through the same KTX2Loader → PMREM →
 * scene.environment, at manifest env.scale × 0.5. No diffuse scene lights are added: the
 * lightmaps already contain all diffuse light.
 */

type Loaded = { maps: Map<BakeGroupName, THREE.Texture>; env: THREE.Texture | null }

let cache: { key: string; promise: Promise<void>; value?: Loaded; error?: unknown } | null = null

function loadTextures(gl: THREE.WebGLRenderer, manifest: BakeManifest): Loaded {
  const key = manifest.groups.map((g) => g.file).join('|')
  if (!cache || cache.key !== key) {
    const loader = getKTX2Loader(gl)
    const one = (file: string) => {
      expectFile(file, file.includes('env') ? 4e5 : 6e5)
      return loader
        .loadAsync(BAKE_DIR + file, (e) => fileProgress(file, e))
        .then((t) => {
          fileDone(file)
          return t
        })
    }
    const c: NonNullable<typeof cache> = { key, promise: Promise.resolve() }
    c.promise = Promise.all([
      Promise.all(manifest.groups.map((g) => one(g.file).then((t) => [g.group, t] as const))),
      manifest.env ? one(manifest.env.file).catch(() => null) : Promise.resolve(null),
    ]).then(
      ([maps, env]) => {
        c.value = { maps: new Map(maps), env }
      },
      (e) => {
        c.error = e
      },
    )
    cache = c
  }
  if (cache.error) throw cache.error
  if (!cache.value) throw cache.promise
  return cache.value
}

/** Start the lightmap + env downloads alongside the GLB (called from the Canvas' onCreated). */
export function preloadBakeTextures(gl: THREE.WebGLRenderer, manifest: BakeManifest) {
  try {
    loadTextures(gl, manifest)
  } catch {
    /* pending (a promise) or failed: <BakedLighting> reads the same cache */
  }
}

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`

/** Σ texture_g * weight_g. Unused slots get a black texture and weight 0. */
const SUM_FRAG = /* glsl */ `
uniform sampler2D t0; uniform sampler2D t1; uniform sampler2D t2;
uniform sampler2D t3; uniform sampler2D t4; uniform sampler2D t5;
uniform float w[6];
uniform float outScale;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(t0, vUv).rgb * w[0] + texture2D(t1, vUv).rgb * w[1] + texture2D(t2, vUv).rgb * w[2]
         + texture2D(t3, vUv).rgb * w[3] + texture2D(t4, vUv).rgb * w[4] + texture2D(t5, vUv).rgb * w[5];
  gl_FragColor = vec4(c * outScale, 1.0);
}`

/**
 * Env equirect: KTX2 keeps the image's top row at v = 0 (flipY can't apply to compressed data) and
 * Blender's panorama is centred on its camera's forward (−Z glTF), where three expects +X.
 * One blit fixes both: v → 1 − v, u → u + 0.25.
 */
const ENV_FRAG = /* glsl */ `
uniform sampler2D src;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(texture2D(src, vec2(fract(vUv.x + 0.25), 1.0 - vUv.y)).rgb, 1.0);
}`

function fullscreen(material: THREE.ShaderMaterial) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
  mesh.frustumCulled = false
  const scene = new THREE.Scene()
  scene.add(mesh)
  return { scene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), dispose: () => mesh.geometry.dispose() }
}

function renderInto(gl: THREE.WebGLRenderer, rt: THREE.WebGLRenderTarget, q: ReturnType<typeof fullscreen>) {
  const prev = gl.getRenderTarget()
  const prevXr = gl.xr.enabled
  const prevAuto = gl.autoClear
  gl.xr.enabled = false
  gl.autoClear = true
  gl.setRenderTarget(rt)
  gl.render(q.scene, q.camera)
  gl.setRenderTarget(prev)
  gl.xr.enabled = prevXr
  gl.autoClear = prevAuto
}

/** Every material the lightmap went on, so a remount (quality fallback) can take it back off. */
const lit = new Set<THREE.Material>()

/**
 * Put the blended lightmap on every mesh with TEXCOORD_1. A material shared with a mesh that has
 * no second UV set is cloned for the TEXCOORD_1 mesh, so the other mesh never samples uv1 = 0.
 */
export function applyLightmap(root: THREE.Object3D, map: THREE.Texture | null) {
  for (const m of lit) {
    ;(m as THREE.MeshStandardMaterial).lightMap = null
    m.needsUpdate = true
  }
  lit.clear()
  if (!map) return 0
  const noUv1 = new Set<THREE.Material>()
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh && !m.geometry.attributes.uv1) for (const mt of ([] as THREE.Material[]).concat(m.material)) noUv1.add(mt)
  })
  let n = 0
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || !m.geometry.attributes.uv1) return
    const conv = (mt: THREE.Material) => {
      if (!('lightMap' in mt)) return mt
      const out = noUv1.has(mt) ? mt.clone() : mt
      const s = out as THREE.MeshStandardMaterial
      s.lightMap = map
      s.lightMapIntensity = Math.PI
      s.needsUpdate = true
      lit.add(out)
      return out
    }
    m.material = Array.isArray(m.material) ? m.material.map(conv) : conv(m.material)
    n++
  })
  return n
}

type Props = { manifest: BakeManifest; room: THREE.Object3D; lowRes: boolean; onReady: () => void }

export function BakedLighting({ manifest, room, lowRes, onReady }: Props) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const tex = loadTextures(gl, manifest)

  // HalfFloat needs a float-renderable colour buffer (WebGL2 + EXT_color_buffer_float/half_float).
  // Without it, fall back to 8-bit with the sum pre-divided (some banding in the darks, still lit).
  const fallback = useMemo(() => {
    const ok = gl.extensions.has('EXT_color_buffer_float') || gl.extensions.has('EXT_color_buffer_half_float')
    return ok ? null : { scale: 1 / 16 }
  }, [gl])

  const size = Math.min(manifest.resolution || 2048, lowRes ? 1024 : 2048)
  const rt = useMemo(() => {
    const t = new THREE.WebGLRenderTarget(size, size, {
      type: fallback ? THREE.UnsignedByteType : THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.LinearSRGBColorSpace,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
    })
    t.texture.channel = 1 // TEXCOORD_1
    t.texture.flipY = false
    t.texture.name = 'bake_lightmap_blend'
    return t
  }, [size, fallback])

  const groups = useMemo(() => manifest.groups.slice(0, 6), [manifest])
  const sum = useMemo(() => {
    const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1)
    black.needsUpdate = true
    const uniforms: Record<string, THREE.IUniform> = { w: { value: new Array(6).fill(0) }, outScale: { value: fallback?.scale ?? 1 } }
    for (let i = 0; i < 6; i++) {
      const g = groups[i]
      const t = g ? tex.maps.get(g.group) : undefined
      if (t) {
        t.colorSpace = THREE.SRGBColorSpace
        t.flipY = false
        t.channel = 1
      }
      uniforms['t' + i] = { value: t ?? black }
    }
    const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: QUAD_VERT, fragmentShader: SUM_FRAG, depthTest: false, depthWrite: false, toneMapped: false })
    const q = fullscreen(mat)
    return {
      ...q,
      weights: uniforms.w.value as number[],
      dispose: () => {
        q.dispose()
        mat.dispose()
        black.dispose()
      },
    }
  }, [groups, tex, fallback])

  // Lightmap onto the room (and off again on unmount). Live lights are not rendered with the bake.
  useLayoutEffect(() => {
    setAmbientOffLevel(0)
    const n = applyLightmap(room, rt.texture)
    if (fallback) for (const m of lit) (m as THREE.MeshStandardMaterial).lightMapIntensity = Math.PI / (fallback.scale ?? 1)
    console.info(`[desk-3d] lightmap on ${n} meshes (${size}², ${fallback ? '8-bit fallback' : 'half float'})`)
    onReady()
    return () => {
      applyLightmap(room, null)
      setAmbientOffLevel(0.25)
    }
  }, [room, rt, size, fallback, onReady])

  useEffect(
    () => () => {
      rt.dispose()
      sum.dispose()
    },
    [rt, sum],
  )

  // Env: flip/rotate blit → PMREM → scene.environment (reflections on metals + gloss only).
  useLayoutEffect(() => {
    const src = tex.env
    if (!src || !manifest.env) return
    const img = src.image as { width?: number; height?: number } | undefined
    const w = img?.width || 1024
    const h = img?.height || 512
    const flipRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: false })
    src.colorSpace = THREE.SRGBColorSpace
    const mat = new THREE.ShaderMaterial({ uniforms: { src: { value: src } }, vertexShader: QUAD_VERT, fragmentShader: ENV_FRAG, depthTest: false, depthWrite: false, toneMapped: false })
    const q = fullscreen(mat)
    renderInto(gl, flipRT, q)
    flipRT.texture.mapping = THREE.EquirectangularReflectionMapping
    const pmrem = new THREE.PMREMGenerator(gl)
    const envRT = pmrem.fromEquirectangular(flipRT.texture)
    pmrem.dispose()
    q.dispose()
    mat.dispose()
    flipRT.dispose()
    const prevEnv = scene.environment
    const prevIntensity = scene.environmentIntensity
    scene.environment = envRT.texture
    scene.environmentIntensity = manifest.env.scale * 0.5
    return () => {
      if (scene.environment === envRT.texture) {
        scene.environment = prevEnv
        scene.environmentIntensity = prevIntensity
      }
      envRT.dispose()
    }
  }, [gl, scene, tex, manifest])

  // Redraw the blend only when a weight moved (switch ramps, agentic dim, neon pulse).
  const last = useRef<number[] | null>(null)
  useFrame(() => {
    const level: Record<BakeGroupName, number> = {
      DeskLamp: mixLevel('desk'),
      FloorLamp: mixLevel('floor'),
      Fill: mixLevel('ambient'),
      Pictures: mixLevel('ambient'),
      Neon: Math.max(0, mixLevel('neon')),
      Window: 1,
    }
    let changed = !last.current
    for (let i = 0; i < 6; i++) {
      const g = groups[i]
      const v = g ? g.scale * (g.default_intensity ?? 1) * level[g.group] : 0
      if (!last.current || Math.abs(last.current[i] - v) > 1e-3 * Math.max(1, g?.scale ?? 1)) changed = true
      sum.weights[i] = v
    }
    if (!changed) return
    last.current = sum.weights.slice()
    renderInto(gl, rt, sum)
  })

  return null
}
