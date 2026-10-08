import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Billboard, Line } from '@react-three/drei'
import type { Line2 } from 'three-stdlib'
import { getUI, momentHeld, useUI } from '../store'
import { targetByKey, type Target } from '../targets'

/**
 * Canvas side of Ask the Duck, kept quiet so it reads as part of the room, not a render bug:
 *  - a thin 2px cyan line (40% opacity, not bloomed) from DUCK_BeamOrigin (else the top of the
 *    duck) to each source the duck cites, drawn outward,
 *  - a slim pulsing ring on each source,
 * both gone ~1.5s after they appear. Plus the quack: the "Quack" shape key if the duck mesh has
 * one, otherwise a little squash-and-stretch bob. (The eyes' glow is a LightMixer group.)
 */
const CYAN = new THREE.Color('#38e8ff')
const GROW_MS = 300
const HOLD_MS = 1000 // fully visible
const FADE_MS = 500 // then fade: gone at ~1.5s
const LINE_OPACITY = 0.4

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
      {cited.map((t, i) => (
        <Ring key={`r-${sources.at}-${t.key}`} t={t} delay={i * 220 + GROW_MS} at={sources.at} />
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

/** grow 0..1 (eased) and alpha 0..1 for a cue that starts `delay` ms after `at`. */
function life(at: number, delay: number) {
  const age = performance.now() - at - delay
  if (age < 0) return { grow: 0, alpha: 0 }
  const grow = Math.min(1, age / GROW_MS)
  // ?debug screenshot hook (software GL renders a frame every few seconds): hold the cue.
  if (momentHeld()) return { grow: 1 - Math.pow(1 - grow, 3), alpha: 1 }
  const alpha = age < GROW_MS + HOLD_MS ? 1 : Math.max(0, 1 - (age - GROW_MS - HOLD_MS) / FADE_MS)
  return { grow: 1 - Math.pow(1 - grow, 3), alpha }
}

const SEGMENTS = 32

function Beam({ from, t, delay, at }: { from: THREE.Vector3; t: Target; delay: number; at: number }) {
  const line = useRef<Line2>(null)
  const points = useMemo(() => {
    const to = t.center
    const mid = from.clone().lerp(to, 0.5)
    mid.y = Math.max(from.y, to.y) + 0.04 + from.distanceTo(to) * 0.08
    return new THREE.QuadraticBezierCurve3(from.clone(), mid, to.clone()).getPoints(SEGMENTS)
  }, [from, t])
  useFrame(() => {
    const l = line.current
    if (!l) return
    const { grow, alpha } = life(at, delay)
    const n = Math.round(SEGMENTS * grow)
    ;(l.geometry as unknown as { instanceCount: number }).instanceCount = n
    l.material.opacity = LINE_OPACITY * alpha
    l.visible = alpha > 0 && n > 0
  })
  return (
    <Line
      ref={line}
      points={points}
      color={CYAN}
      lineWidth={2}
      transparent
      opacity={0}
      depthWrite={false}
      renderOrder={6}
      raycast={() => null}
      visible={false}
    />
  )
}

/** Slim pulsing ring on the cited object, facing the camera. */
function Ring({ t, delay, at }: { t: Target; delay: number; at: number }) {
  const ref = useRef<THREE.Mesh>(null)
  const { geometry, material, center } = useMemo(() => {
    const s = t.box.getSize(new THREE.Vector3())
    const r = THREE.MathUtils.clamp(Math.max(s.x, s.y, s.z) * 0.3, 0.035, 0.11)
    const g = new THREE.RingGeometry(r * 0.93, r, 64)
    const m = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })
    return { geometry: g, material: m, center: t.box.getCenter(new THREE.Vector3()) }
  }, [t])
  useEffect(() => () => (geometry.dispose(), material.dispose()), [geometry, material])
  useFrame(() => {
    const { alpha } = life(at, delay)
    const age = Math.max(0, performance.now() - at - delay)
    material.opacity = 0.5 * alpha * (0.7 + 0.3 * Math.cos(age / 120))
    if (ref.current) {
      ref.current.visible = alpha > 0
      ref.current.scale.setScalar(1 + 0.08 * Math.sin(age / 120))
    }
  })
  return (
    <Billboard position={center}>
      <mesh ref={ref} geometry={geometry} material={material} renderOrder={6} raycast={() => null} visible={false} />
    </Billboard>
  )
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
