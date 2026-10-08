import { useLayoutEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useLoader, useThree } from '@react-three/fiber'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
import { analyzeScene, type PointHint, type RoomInfo } from './analyze'
import { sceneHandlers } from './interact'
import { EXTERIOR_LAYER } from './Rain'
import type { Quality } from './quality'
import { setUI } from './store'
import { resolveTargets } from './targets'

export const MODEL_URL = `${import.meta.env.BASE_URL}desk.glb`

// Blender's static rain cards in the city are replaced by the animated rain. Flip to keep them.
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
export function RoomModel({ onInfo, quality }: { onInfo: (info: RoomInfo) => void; quality: Quality }) {
  const { scene } = useLoader(GLTFLoader, MODEL_URL, undefined, onProgress)
  const info = useMemo(() => analyzeScene(scene), [scene])

  useLayoutEffect(() => {
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
        if (!KEEP_GLB_RAIN && /^rain/i.test(m.name)) m.visible = false
      } else {
        // Lamp shades are thin linen: let light through instead of casting hard cones.
        m.castShadow = quality.shadows && !/shade/i.test(m.name)
        m.receiveShadow = quality.shadows
      }
      if (quality.simpleMaterials && m !== info.glass?.mesh) simplify(m)
      // Baked lightmaps / AO from Blender stay enabled as exported (UV2); nothing to override.
    })
    setUI({ targets: resolveTargets(scene) })
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
const LAMP_2400K = new THREE.Color('#ffa457')
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
      <hemisphereLight args={['#6b5d50', '#1b1815', (safe ? 1.6 : 0.8) * k]} />
      <ambientLight color="#463c36" intensity={(safe ? 0.9 : 0.35) * k} />

      {desk && (
        <>
          <primitive object={deskTarget} />
          <spotLight
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
          <pointLight position={desk.position} color={LAMP_2700K} intensity={1.6 * k} decay={2} />
        </>
      )}

      {others.map((b, i) => (
        <pointLight
          key={b.name + i}
          position={b.position}
          color={LAMP_2400K}
          intensity={7 * k}
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
        <pointLight position={[info.focus.x, info.focus.y + 0.8, info.focus.z + 0.4]} color={LAMP_2700K} intensity={8} decay={2} />
      )}

      {neon.map((n, i) => (
        <pointLight
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
        <pointLight position={info.glass.center.clone().addScaledVector(info.glass.normal, 0.6)} color={WINDOW_8000K} intensity={1.2} decay={2} />
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

