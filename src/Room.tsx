import { useLayoutEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useLoader, useThree } from '@react-three/fiber'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
import { analyzeScene, type PointHint, type RoomInfo } from './analyze'
import { sceneHandlers } from './interact'
import { clearMaterials, mixRef, registerLight, registerMaterial, type MixGroup } from './LightMixer'
import { addPlaceholders } from './placeholders'
import { EXTERIOR_LAYER } from './Rain'
import type { Quality } from './quality'
import { setUI } from './store'
import { resolveStopCams, resolveTargets } from './targets'

export const MODEL_URL = `${import.meta.env.BASE_URL}desk.glb`

// Blender's static rain cards (RAIN_*) are replaced by the animated rain; they come back only when
// the particle rain is off (auto-quality step 2). Flip to always keep them.
const KEEP_GLB_RAIN = false

RectAreaLightUniformsLib.init()

/** Real download progress (bytes) for the loader; the GLB is the only big asset. */
function onProgress(e: ProgressEvent) {
  if (e.total > 0) setUI({ progress: Math.min(e.loaded / e.total, 1) })
  else setUI({ progress: Math.min(e.loaded / 6e6, 0.95) })
}

const simplified = new WeakSet<THREE.Material>()

/** Safe-mode materials: Lambert keeps colour, textures and emission but compiles a tiny shader. */
function simplify(m: THREE.Mesh) {
  const conv = (mt: THREE.Material) => {
    if (simplified.has(mt) || !(mt as THREE.MeshStandardMaterial).isMeshStandardMaterial) return mt
    const s = mt as THREE.MeshStandardMaterial
    const l = new THREE.MeshLambertMaterial({
      name: s.name,
      color: s.color,
      map: s.map,
      emissive: s.emissive,
      emissiveMap: s.emissiveMap,
      emissiveIntensity: s.emissiveIntensity,
      transparent: s.transparent,
      opacity: s.opacity,
      side: s.side,
      alphaTest: s.alphaTest,
      lightMap: s.lightMap,
      aoMap: s.aoMap,
    })
    simplified.add(l)
    return l
  }
  m.material = Array.isArray(m.material) ? m.material.map(conv) : conv(m.material)
}

/** Loads the replaceable GLB, tags interior/exterior, registers click targets and reports what it found. */
/** The loaded room, for code outside the React tree (keyboard presses). */
export let roomScene: THREE.Object3D | null = null
/** Blender's static rain cards (RAIN_Streaks, RAIN_StreaksFaint), see GlbRain in Rain.tsx. */
export const glbRain: THREE.Mesh[] = []

/**
 * Emissive meshes that follow a light group. Their materials are cloned per mesh first, because
 * the GLB shares e.g. one "Bulb" material between the desk lamp and the floor lamp.
 */
function emissiveGroup(name: string, deskBulb: string | undefined): MixGroup | null {
  if (/DuckEye/i.test(name)) return 'eyes'
  if (/^neon/i.test(name)) return 'neon'
  if (/^FloorLamp/i.test(name)) return 'floor'
  if (name === deskBulb || /^Lamp(Bulb|Shade)$/.test(name)) return 'desk'
  if (/bulb/i.test(name)) return 'floor'
  return null
}

function registerEmissives(scene: THREE.Object3D, info: RoomInfo) {
  clearMaterials()
  const deskBulb = [...info.bulbs].sort((a, b) => a.position.distanceTo(info.focus) - b.position.distanceTo(info.focus))[0]?.name
  scene.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || Array.isArray(m.material)) return
    const mt = m.material as THREE.MeshStandardMaterial
    const group = emissiveGroup(m.name, deskBulb) ?? (/DuckEyes/i.test(mt.name) ? 'eyes' : null)
    if (!group || !('emissiveIntensity' in mt)) return
    if (group === 'eyes') {
      // MAT_DuckEyes ships "off" (a very dim cyan). Drive it as full cyan scaled by the mixer:
      // idle level 0.03 matches the exported look, thinking / agentic goes to 3+.
      mt.emissive?.set('#22ddff')
      registerMaterial(mt, 'eyes', 1)
      return
    }
    if (!m.userData.mixMaterial) {
      m.material = mt.clone()
      m.userData.mixMaterial = true
      m.userData.mixBase = mt.emissiveIntensity
      if (/^FloorLampShade/i.test(m.name)) {
        // Lit linen: the shade glows 2700K from the bulb inside instead of reading as a dark cone.
        const shade = m.material as THREE.MeshStandardMaterial
        shade.emissive.set(LAMP_2700K)
        shade.side = THREE.DoubleSide
        m.userData.mixBase = SHADE_GLOW
      }
    }
    // (Re-applied if a quality step swapped the shade to a Lambert material.)
    if (/^FloorLampShade/i.test(m.name) && !(m.material as THREE.Material).userData.falloff) fabricFalloff(m.material as THREE.Material, m.geometry)
    registerMaterial(m.material as THREE.Material, group, m.userData.mixBase)
  })
}

export function RoomModel({ onInfo, quality }: { onInfo: (info: RoomInfo) => void; quality: Quality }) {
  const { scene } = useLoader(GLTFLoader, MODEL_URL, undefined, onProgress)
  const info = useMemo(() => analyzeScene(scene), [scene])

  useLayoutEffect(() => {
    addPlaceholders(scene)
    roomScene = scene
    // Art placards were dropped (the art is just art from the real room): hide the blank cards.
    scene.traverse((o) => {
      if (/^PLACARD_/.test(o.name)) o.visible = false
    })
    const exterior = new Set(info.exterior)
    scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      if (exterior.has(m)) {
        m.castShadow = false
        m.receiveShadow = false
        m.layers.enable(EXTERIOR_LAYER)
        // Behind the glass: never a click target, so skip it in raycasts.
        m.raycast = () => {}
        if (/^rain/i.test(m.name)) {
          if (!glbRain.includes(m)) glbRain.push(m)
          m.visible = KEEP_GLB_RAIN
        }
      } else {
        // Lamp shades are thin linen: let light through instead of casting hard cones.
        m.castShadow = quality.shadows && !/shade/i.test(m.name)
        m.receiveShadow = quality.shadows
      }
      if (quality.simpleMaterials && m !== info.glass?.mesh) simplify(m)
      // Baked lightmaps / AO from Blender stay enabled as exported (UV2); nothing to override.
    })
    registerEmissives(scene, info)
    setUI({ targets: resolveTargets(scene), stopCams: resolveStopCams(scene) })
    onInfo(info)
  }, [scene, info, onInfo, quality])

  return <primitive object={scene} {...sceneHandlers} />
}

function cluster(points: PointHint[], radius: number) {
  const groups: { position: THREE.Vector3; color: THREE.Color; n: number }[] = []
  for (const p of points) {
    const g = groups.find((x) => x.position.distanceTo(p.position) < radius)
    if (g) {
      g.position.multiplyScalar(g.n).add(p.position).divideScalar(g.n + 1)
      g.color.multiplyScalar(g.n).add(p.color).multiplyScalar(1 / (g.n + 1))
      g.n++
    } else groups.push({ position: p.position.clone(), color: p.color.clone(), n: 1 })
  }
  return groups
}

const LAMP_2700K = new THREE.Color('#ffb46b')
const FILL_SKY = '#ffd9b5'
const FILL_GROUND = '#6a5545'
const FILL_HEMI = 0.72
const FILL_AMBIENT_COLOR = '#ffd2a8'
const FILL_AMBIENT = 0.3
const FLOOR_LAMP = 10
// Cut ~30% from 0.9 (Shuri: blown out). Re-check once Wanda's baked GLB lands: the bake may carry
// the shade's glow itself, in which case this drops further or goes away.
const SHADE_GLOW = 0.63
/** Shade glow at its top rim relative to its bottom opening (the bulb sits low and light spills out the bottom). */
const SHADE_TOP = 0.4

/**
 * Lamp-shade linen: the glow falls off from the bottom opening (full) to the top rim (SHADE_TOP),
 * so the shade reads as lit fabric instead of a flat sticker. Object-space Y, so it holds for any
 * transform; works on the standard and the low-tier Lambert material (both have emissivemap_fragment).
 */
function fabricFalloff(mat: THREE.Material, geom: THREE.BufferGeometry) {
  if (!geom.boundingBox) geom.computeBoundingBox()
  const bb = geom.boundingBox!
  const range = new THREE.Vector2(bb.min.y, bb.max.y)
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uShadeY = { value: range }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uShadeY;\nvarying float vShadeY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShadeY = clamp((position.y - uShadeY.x) / max(uShadeY.y - uShadeY.x, 1e-4), 0.0, 1.0);')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vShadeY;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance *= mix(1.0, ${SHADE_TOP.toFixed(2)}, smoothstep(0.0, 1.0, vShadeY));`)
  }
  mat.customProgramCacheKey = () => 'desk3d-shade-falloff'
  mat.userData.falloff = true
  mat.needsUpdate = true
}
const WINDOW_8000K = new THREE.Color('#c4d4ff')

/**
 * Lighting for a cozy evening room. Blender lights are not exported, so we place them from the
 * emissive bulbs / neon / glass we found. Warm lamps are the key; window and neon are accents.
 * With baked lightmaps the dynamic lights are dimmed so they only add speculars and shadows.
 */
export function RoomLights({ info, quality }: { info: RoomInfo; quality: Quality }) {
  const { gl } = useThree()
  const baked = info.baked.lightMap || new URLSearchParams(window.location.search).get('baked') === '1'
  const k = baked ? 0.35 : 1
  // Safe mode: Lambert ignores rect-area lights, so lift the fill lights instead.
  const safe = quality.tier === 'low'

  const bulbs = useMemo(() => {
    const list = [...info.bulbs]
    // Desk lamp = bulb closest to the desk; it gets the shadowed spot.
    list.sort((a, b) => a.position.distanceTo(info.focus) - b.position.distanceTo(info.focus))
    return list
  }, [info])
  const neon = useMemo(() => cluster(info.neon, 0.6), [info])

  const deskTarget = useMemo(() => {
    const t = new THREE.Object3D()
    if (bulbs[0]) t.position.set(bulbs[0].position.x * 0.5 + info.focus.x * 0.5, info.focus.y, bulbs[0].position.z * 0.5 + info.focus.z * 0.5)
    return t
  }, [bulbs, info])

  const windowLight = useMemo(() => {
    const g = info.glass
    if (!g) return null
    const l = new THREE.RectAreaLight(WINDOW_8000K, 2.2 * k, g.width, g.height)
    l.position.copy(g.center).addScaledVector(g.normal, 0.02)
    l.lookAt(l.position.clone().add(g.normal))
    return l
  }, [info, k])

  // The room is static: render shadow maps once (and again on resize / swap).
  useLayoutEffect(() => {
    gl.shadowMap.autoUpdate = false
    gl.shadowMap.needsUpdate = true
  }, [gl, info])

  // The rect-area window and ceiling bounce are plain objects: register them with the mixer.
  useLayoutEffect(() => (windowLight ? registerLight(windowLight, 'ambient') : undefined), [windowLight])

  const shadows = quality.shadows

  const r = info.room
  // Soft warm bounce from the ceiling so the far corners and the floor stay readable.
  const bounce = useMemo(() => {
    const s = r.getSize(new THREE.Vector3())
    const c = r.getCenter(new THREE.Vector3())
    const l = new THREE.RectAreaLight('#ffd8b4', 1.4 * k, s.x * 0.7, s.z * 0.7)
    l.position.set(c.x, r.max.y - 0.05, c.z)
    l.lookAt(c.x, r.min.y, c.z)
    return l
  }, [r, k])
  useLayoutEffect(() => registerLight(bounce, 'ambient'), [bounce])
  const ceiling = useMemo(() => {
    const s = r.getSize(new THREE.Vector3())
    const c = r.getCenter(new THREE.Vector3())
    return { size: [s.x, s.z] as [number, number], pos: [c.x, r.max.y, c.z] as [number, number, number] }
  }, [r])

  const desk = bulbs[0]
  const others = bulbs.slice(1)
  const mapSize = quality.shadowMapSize

  return (
    <>
      {/* Warm fill, raised so free roam never reads as a black void: the darkest floor / wall
          areas land around #2A2420 instead of #0D0D0D (the GLB albedos are ~0.04). Neon and rain
          are untouched. Re-check against Wanda's baked GLB (k drops with lightmaps). */}
      <hemisphereLight ref={mixRef('ambient')} args={[FILL_SKY, FILL_GROUND, (safe ? 1.6 : FILL_HEMI) * k]} />
      <ambientLight ref={mixRef('ambient')} color={FILL_AMBIENT_COLOR} intensity={(safe ? 0.9 : FILL_AMBIENT) * k} />

      {desk && (
        <>
          <primitive object={deskTarget} />
          <spotLight
            ref={mixRef('desk')}
            position={desk.position.clone().add(new THREE.Vector3(0, -0.01, 0))}
            target={deskTarget}
            color={LAMP_2700K}
            intensity={9 * k}
            angle={1.05}
            penumbra={1}
            decay={2}
            castShadow={shadows}
            shadow-mapSize={[mapSize, mapSize]}
            shadow-bias={-0.0004}
            shadow-normalBias={0.02}
            shadow-radius={6}
            shadow-camera-near={0.02}
            shadow-camera-far={6}
          />
          <pointLight ref={mixRef('desk')} position={desk.position} color={LAMP_2700K} intensity={1.6 * k} decay={2} />
        </>
      )}

      {/* Floor lamp(s): a warm 2700K point light inside the linen shade (the shade itself glows,
          see registerEmissives). */}
      {others.map((b, i) => (
        <pointLight
          ref={mixRef('floor')}
          key={b.name + i}
          position={b.position}
          color={LAMP_2700K}
          intensity={FLOOR_LAMP * k}
          decay={2}
          castShadow={shadows && quality.tier === 'high'}
          shadow-mapSize={[512, 512]}
          shadow-bias={-0.0005}
          shadow-normalBias={0.03}
          shadow-radius={8}
          shadow-camera-near={0.05}
          shadow-camera-far={8}
        />
      ))}

      {/* Fallback key if the GLB has no bulbs at all. */}
      {!desk && (
        <pointLight ref={mixRef('desk')} position={[info.focus.x, info.focus.y + 0.8, info.focus.z + 0.4]} color={LAMP_2700K} intensity={8} decay={2} />
      )}

      {neon.map((n, i) => (
        <pointLight
          ref={mixRef('neon')}
          key={'neon' + i}
          position={n.position}
          color={n.color}
          intensity={0.28 * k * Math.min(n.n, 3)}
          decay={2}
          distance={3.5}
        />
      ))}

      {windowLight && !safe && <primitive object={windowLight} />}
      {!safe && <primitive object={bounce} />}
      {safe && info.glass && (
        <pointLight ref={mixRef('ambient')} position={info.glass.center.clone().addScaledVector(info.glass.normal, 0.6)} color={WINDOW_8000K} intensity={1.2} decay={2} />
      )}

      {/* Blender keeps the ceiling out of the export; close the box so the room reads as a room. */}
      {!info.hasCeiling && (
      <mesh position={ceiling.pos} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={ceiling.size} />
        <meshStandardMaterial color="#1c1a1d" roughness={0.95} />
      </mesh>
      )}
    </>
  )
}

