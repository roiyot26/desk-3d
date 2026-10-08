import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { getUI, useUI } from '../store'
import { targetByKey, type Target } from '../targets'

/**
 * Canvas side of Ask the Duck: cyan beams from the duck (DUCK_BeamOrigin, else the top of the
 * duck) to every source the duck cites, a cyan glow box around each source, and the quack:
 * a "Quack" shape key if the duck mesh has one, otherwise a little squash-and-stretch bob.
 * (The eyes' glow is a LightMixer group, see LightMixer.tsx.)
 */
const CYAN = new THREE.Color('#38e8ff')
const BEAM_MAX_MS = 30000 // beams fade at sources.fadeAt (set by the duck runner), or after this
const FADE_MS = 800

export function DuckRig() {
  const targets = useUI((s) => s.targets)
  const sources = useUI((s) => s.sources)
  const duck = targets.get('duck')
  const origin = useMemo(() => (duck ? beamOrigin(duck) : null), [duck])
  const cited = useMemo(
    () => [...new Set(sources.keys.map((k) => targetByKey(targets, k)))].filter((t): t is Target => !!t && t.key !== 'duck'),
    [sources, targets],
  )
  return (
    <>
      {duck && <Quack duck={duck} />}
      {origin &&
        cited.map((t, i) => <Beam key={`${sources.at}-${t.key}`} from={origin} t={t} delay={i * 220} at={sources.at} />)}
      {cited.map((t) => (
        <Glow key={`g-${sources.at}-${t.key}`} t={t} at={sources.at} />
      ))}
    </>
  )
}

function beamOrigin(duck: Target): THREE.Vector3 {
  let o: THREE.Object3D | undefined
  for (const n of duck.nodes) {
    n.traverse((c) => {
      if (!o && /DUCK_BeamOrigin/i.test(c.name)) o = c
    })
  }
  if (o) return o.getWorldPosition(new THREE.Vector3())
  return new THREE.Vector3(duck.center.x, duck.box.max.y, duck.center.z)
}

function fade(at: number, delay: number) {
  const now = performance.now()
  const age = now - at - delay
  if (age < 0) return { grow: 0, alpha: 0 }
  const grow = Math.min(1, age / 650)
  const fadeAt = getUI().sources.at === at ? getUI().sources.fadeAt ?? at + BEAM_MAX_MS : now
  const end = Math.min(fadeAt, at + BEAM_MAX_MS)
  const alpha = now < end ? 1 : Math.max(0, 1 - (now - end) / FADE_MS)
  return { grow: 1 - Math.pow(1 - grow, 3), alpha }
}

function Beam({ from, t, delay, at }: { from: THREE.Vector3; t: Target; delay: number; at: number }) {
  const mesh = useRef<THREE.Mesh>(null)
  const { geometry, material, count } = useMemo(() => {
    const to = t.center
    const mid = from.clone().lerp(to, 0.5)
    mid.y = Math.max(from.y, to.y) + 0.05 + from.distanceTo(to) * 0.12
    const curve = new THREE.QuadraticBezierCurve3(from.clone(), mid, to.clone())
    const g = new THREE.TubeGeometry(curve, 64, 0.0055, 6, false)
    const m = new THREE.MeshBasicMaterial({
      color: CYAN.clone().multiplyScalar(2.5),
      toneMapped: false,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    return { geometry: g, material: m, count: g.index ? g.index.count : 0 }
  }, [from, t])
  useEffect(() => () => (geometry.dispose(), material.dispose()), [geometry, material])
  useFrame(({ clock }) => {
    const { grow, alpha } = fade(at, delay)
    // Draw the tube from the duck outward (index ranges follow the curve's segments).
    const n = Math.floor((count * grow) / 6) * 6
    geometry.setDrawRange(0, n)
    material.opacity = alpha * (0.75 + 0.25 * Math.sin(clock.elapsedTime * 12))
    if (mesh.current) mesh.current.visible = alpha > 0 && n > 0
  })
  return <mesh ref={mesh} geometry={geometry} material={material} renderOrder={6} raycast={() => null} />
}

function Glow({ t, at }: { t: Target; at: number }) {
  const ref = useRef<THREE.LineSegments>(null)
  const { geometry, material, center } = useMemo(() => {
    const size = t.box.getSize(new THREE.Vector3()).addScalar(0.03)
    const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z))
    const m = new THREE.LineBasicMaterial({ color: CYAN.clone().multiplyScalar(2), toneMapped: false, transparent: true, depthWrite: false })
    return { geometry: g, material: m, center: t.box.getCenter(new THREE.Vector3()) }
  }, [t])
  useEffect(() => () => (geometry.dispose(), material.dispose()), [geometry, material])
  useFrame(({ clock }) => {
    const { alpha } = fade(at, 400)
    material.opacity = alpha * (0.55 + 0.45 * Math.sin(clock.elapsedTime * 5))
    if (ref.current) ref.current.visible = alpha > 0
  })
  return <lineSegments ref={ref} position={center} geometry={geometry} material={material} renderOrder={6} raycast={() => null} />
}

function Quack({ duck }: { duck: Target }) {
  const rig = useMemo(() => {
    const morphs: { mesh: THREE.Mesh; index: number }[] = []
    for (const n of duck.nodes) {
      n.traverse((c) => {
        const m = c as THREE.Mesh
        const dict = m.morphTargetDictionary
        if (!dict || !m.morphTargetInfluences) return
        const key = Object.keys(dict).find((k) => /quack/i.test(k))
        if (key !== undefined) morphs.push({ mesh: m, index: dict[key] })
      })
    }
    const roots = duck.nodes.map((n) => ({ n, scale: n.scale.clone(), y: n.position.y }))
    return { morphs, roots }
  }, [duck])
  useEffect(
    () => () => {
      for (const r of rig.roots) {
        r.n.scale.copy(r.scale)
        r.n.position.y = r.y
      }
    },
    [rig],
  )
  useFrame(() => {
    const age = performance.now() - getUI().quackAt
    const on = age >= 0 && age < 420
    const k = on ? Math.sin((age / 420) * Math.PI) : 0
    if (rig.morphs.length) {
      for (const m of rig.morphs) m.mesh.morphTargetInfluences![m.index] = k
      return
    }
    for (const r of rig.roots) {
      r.n.scale.set(r.scale.x * (1 + 0.08 * k), r.scale.y * (1 - 0.12 * k), r.scale.z * (1 + 0.08 * k))
      r.n.position.y = r.y + 0.012 * Math.sin((age / 420) * Math.PI * 2) * (on ? 1 : 0)
    }
  })
  return null
}
