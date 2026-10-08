import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useFBO } from '@react-three/drei'
import type { RoomInfo } from './analyze'
import type { Quality } from './quality'
import { getUI } from './store'
import { glassFragment, glassVertex, streakFragment, streakVertex } from './rainShaders'

/** Layer used for "what is visible through the window" (city, sky, rain streaks). */
export const EXTERIOR_LAYER = 1

/**
 * Rain on the window glass.
 * Each frame we render only the exterior layer (city + falling rain) from the main camera into a
 * half-res, mip-mapped target. The glass shader samples that texture in screen space: misty glass
 * reads a blurred mip, drops and their trails act as small lenses that refract a sharp image.
 * Works on the GLB's own pane if one is found, or on an overlay plane in the window opening.
 */
export function RainGlass({ info, quality }: { info: RoomInfo; quality: Quality }) {
  const frame = info.glass!
  const { gl, scene, camera, size, viewport } = useThree()
  const scale = quality.tier === 'high' ? 0.5 : 0.35
  const fbo = useFBO(Math.max(2, Math.round(size.width * viewport.dpr * scale)), Math.max(2, Math.round(size.height * viewport.dpr * scale)), {
    type: THREE.HalfFloatType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    samples: 0,
  })

  const material = useMemo(() => {
    const origin = frame.center
      .clone()
      .addScaledVector(frame.right, -frame.width / 2)
      .addScaledVector(frame.up, -frame.height / 2)
    return new THREE.ShaderMaterial({
      vertexShader: glassVertex,
      fragmentShader: glassFragment,
      side: THREE.DoubleSide,
      uniforms: {
        uScene: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uRain: { value: 1 },
        uFog: { value: 0.22 },
        uLens: { value: quality.tier === 'high' ? 14 : 9 },
        uRoomTint: { value: new THREE.Color('#ffb070') },
        uPaneSize: { value: new THREE.Vector2(frame.width, frame.height) },
        uOrigin: { value: origin },
        uRight: { value: frame.right.clone() },
        uUp: { value: frame.up.clone() },
      },
    })
  }, [frame, quality.tier])

  // Put the rain material on the GLB pane (or on our overlay plane, rendered below).
  useEffect(() => {
    const mesh = frame.mesh
    if (!mesh) return
    const old = mesh.material
    mesh.material = material
    mesh.castShadow = false
    mesh.receiveShadow = false
    return () => {
      mesh.material = old
    }
  }, [frame, material])

  const overlay = useMemo(() => {
    if (frame.mesh) return null
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.normal)
    const pos = frame.center.clone().addScaledVector(frame.normal, 0.004)
    return { q, pos }
  }, [frame])

  const buf = useMemo(() => new THREE.Vector2(), [])
  useFrame((_, delta) => {
    const u = material.uniforms
    u.uTime.value += Math.min(delta, 0.1) * (quality.reducedMotion ? 0.35 : 1)
    // Window latch: drops dry up slowly / come back when it rains again.
    const want = getUI().rain ? 1 : 0
    u.uRain.value += (want - u.uRain.value) * Math.min(1, delta * 0.8)
    gl.getDrawingBufferSize(buf)
    u.uRes.value.copy(buf)
    // Exterior-only pass from the same camera.
    const mask = camera.layers.mask
    camera.layers.set(EXTERIOR_LAYER)
    const prevTarget = gl.getRenderTarget()
    gl.setRenderTarget(fbo)
    gl.clear()
    gl.render(scene, camera)
    gl.setRenderTarget(prevTarget)
    camera.layers.mask = mask
    u.uScene.value = fbo.texture
  })

  if (!overlay) return null
  return (
    <mesh position={overlay.pos} quaternion={overlay.q} material={material} renderOrder={1}>
      <planeGeometry args={[frame.width, frame.height]} />
    </mesh>
  )
}

/** Falling rain in the city layer behind the glass: instanced, camera-facing, GPU-animated streaks. */
export function RainStreaks({ info, quality }: { info: RoomInfo; quality: Quality }) {
  const frame = info.glass!
  const { geometry, material } = useMemo(() => {
    const out = frame.normal.clone().negate() // from the glass toward the city
    const near = 1.0
    const far = 15
    const c = frame.center.clone().addScaledVector(out, (near + far) / 2)
    const half = new THREE.Vector3(
      Math.abs(out.x) > 0.5 ? (far - near) / 2 : 8,
      0,
      Math.abs(out.z) > 0.5 ? (far - near) / 2 : 8,
    )
    const boxMin = new THREE.Vector3(c.x - half.x, frame.center.y - 6, c.z - half.z)
    const boxSize = new THREE.Vector3(half.x * 2, 12.5, half.z * 2)

    const base = new THREE.PlaneGeometry(1, 1)
    const g = new THREE.InstancedBufferGeometry()
    g.index = base.index
    g.setAttribute('position', base.getAttribute('position'))
    const n = quality.rainCount
    const seeds = new Float32Array(n * 3)
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random()
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3))
    g.instanceCount = n

    const m = new THREE.ShaderMaterial({
      vertexShader: streakVertex,
      fragmentShader: streakFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uBoxMin: { value: boxMin },
        uBoxSize: { value: boxSize },
        uWind: { value: new THREE.Vector2(0.9, 0.35) },
        uLen: { value: 0.5 },
        uWidth: { value: 0.005 },
        uColor: { value: new THREE.Color(0.62, 0.7, 0.85) },
        uOpacity: { value: quality.tier === 'high' ? 0.26 : 0.32 },
      },
    })
    return { geometry: g, material: m }
  }, [frame, quality])

  useEffect(() => () => {
    geometry.dispose()
    material.dispose()
  }, [geometry, material])

  const baseOpacity = quality.tier === 'high' ? 0.26 : 0.32
  const mesh = useRef<THREE.Mesh>(null)
  useFrame((_, delta) => {
    const u = material.uniforms
    u.uTime.value += Math.min(delta, 0.1) * (quality.reducedMotion ? 0.35 : 1)
    const want = getUI().rain ? baseOpacity : 0
    u.uOpacity.value += (want - u.uOpacity.value) * Math.min(1, delta * 2)
    if (mesh.current) mesh.current.visible = u.uOpacity.value > 0.003
  })

  return (
    <mesh
      ref={mesh}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      onUpdate={(m) => m.layers.enable(EXTERIOR_LAYER)}
    />
  )
}
