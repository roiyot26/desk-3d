import { useEffect, useMemo, useRef, type RefObject } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Billboard } from '@react-three/drei'
import { getUI, momentHeld, useUI } from '../store'
import { targetByKey, type Target } from '../targets'

/**
 * Canvas side of Ask the Duck, kept quiet so it reads as part of the room, not a render bug:
 *  - a thin cyan beam (40% opacity, not bloomed) from DUCK_BeamOrigin (else the top of the
 *    duck) to each source the duck cites, drawn outward. It is a real triangle mesh (a 3 mm
 *    tube), not GL lines / Line2, so it renders the same on every renderer, software GL included,
 *  - a slim pulsing ring on each source,
 * both fully gone (opacity 0, hidden) ~1.45s after they appear, well before the answer text lands.
 * Cyan is reserved for these in-scene cues and the neon sign; all UI chrome is amber/grey. Plus the quack: the "Quack" shape key if the duck mesh has
 * one, otherwise a little squash-and-stretch bob. (The eyes' glow is a LightMixer group.)
 */
const CYAN = new THREE.Color('#38e8ff')
const GROW_MS = 250
const HOLD_MS = 800 // fully visible
const FADE_MS = 400 // then fade to 0 and hide: gone 1.45s after it appears
const STAGGER_MS = 150 // per extra source
const LINE_OPACITY = 0.4

/**
 * ?debug only: live state of every pointer cue (beam + ring), read by window.__desk3d.beams()
 * so QA can assert "rendered, then fully gone" without pixel guessing.
 */
export type CueDebug = { kind: 'beam' | 'ring'; points: THREE.Vector3[]; visible: () => boolean; opacity: () => number; maxOpacity: number; shownFrames: number; mounted: boolean }
export const cueDebug = new Set<CueDebug>()

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
        cited.map((t, i) => <Beam key={`${sources.at}-${t.key}`} from={origin} t={t} delay={i * STAGGER_MS} at={sources.at} />)}
      {cited.map((t, i) => (
        <Ring key={`r-${sources.at}-${t.key}`} t={t} delay={i * STAGGER_MS} at={sources.at} />
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

const SEGMENTS = 48
const RADIAL = 6
const TUBE_RADIUS = 0.0016 // metres: a ~2-3px line at the duck stop's framing

function Beam({ from, t, delay, at }: { from: THREE.Vector3; t: Target; delay: number; at: number }) {
  const ref = useRef<THREE.Mesh>(null)
  const { geometry, material, points } = useMemo(() => {
    const to = t.center
    const mid = from.clone().lerp(to, 0.5)
    mid.y = Math.max(from.y, to.y) + 0.04 + from.distanceTo(to) * 0.08
    const curve = new THREE.QuadraticBezierCurve3(from.clone(), mid, to.clone())
    const g = new THREE.TubeGeometry(curve, SEGMENTS, TUBE_RADIUS, RADIAL, false)
    g.setDrawRange(0, 0)
    const m = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
    return { geometry: g, material: m, points: curve.getPoints(24) }
  }, [from, t])
  const dbg = useCue('beam', points, ref, material)
  useEffect(() => () => (geometry.dispose(), material.dispose()), [geometry, material])
  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return
    const { grow, alpha } = life(at, delay)
    // Tube indices run segment by segment along the curve: drawing the first n segments grows it.
    const n = Math.round(SEGMENTS * grow)
    geometry.setDrawRange(0, n * RADIAL * 6)
    material.opacity = LINE_OPACITY * alpha
    mesh.visible = alpha > 0 && n > 0
    dbg.track()
  })
  return <mesh ref={ref} geometry={geometry} material={material} renderOrder={6} raycast={() => null} visible={false} frustumCulled={false} />
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
  const ringPts = useMemo(() => [center], [center])
  const dbg = useCue('ring', ringPts, ref, material)
  useEffect(() => () => (geometry.dispose(), material.dispose()), [geometry, material])
  useFrame(() => {
    const { alpha } = life(at, delay)
    const age = Math.max(0, performance.now() - at - delay)
    material.opacity = 0.5 * alpha * (0.7 + 0.3 * Math.cos(age / 120))
    if (ref.current) {
      ref.current.visible = alpha > 0
      ref.current.scale.setScalar(1 + 0.08 * Math.sin(age / 120))
    }
    dbg.track()
  })
  return (
    <Billboard position={center}>
      <mesh ref={ref} geometry={geometry} material={material} renderOrder={6} raycast={() => null} visible={false} />
    </Billboard>
  )
}

const DEBUG = new URLSearchParams(window.location.search).has('debug')

function useCue(kind: CueDebug['kind'], points: THREE.Vector3[], ref: RefObject<THREE.Mesh>, material: THREE.MeshBasicMaterial) {
  const cue = useMemo<CueDebug>(
    () => ({ kind, points, visible: () => !!ref.current?.visible, opacity: () => material.opacity, maxOpacity: 0, shownFrames: 0, mounted: true }),
    [kind, points, ref, material],
  )
  useEffect(() => {
    if (!DEBUG) return
    cueDebug.add(cue)
    // Keep unmounted cues (as gone) so QA can still see they rendered; cap the history.
    for (const old of [...cueDebug].slice(0, Math.max(0, cueDebug.size - 12))) cueDebug.delete(old)
    return () => {
      cue.mounted = false
      cue.visible = () => false
    }
  }, [cue])
  return {
    track: () => {
      if (!DEBUG || !ref.current?.visible) return
      cue.shownFrames++
      cue.maxOpacity = Math.max(cue.maxOpacity, material.opacity)
    },
  }
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
