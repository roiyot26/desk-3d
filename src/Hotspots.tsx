import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Billboard, Html } from '@react-three/drei'
import { STOPS, content, labelFor } from './content'
import { proxyHandlers, tapKey } from './interact'
import { activate } from './nav'
import { getUI, setUI, useUI } from './store'
import { markerTargetFor, type Target } from './targets'

/** Numbered tour markers, big invisible hit boxes for small objects, and the hover label. */
export function Hotspots() {
  const targets = useUI((s) => s.targets)
  const ready = useUI((s) => s.stage === 'ready' && s.entered)
  const list = useMemo(() => [...targets.values()], [targets])
  if (!ready) return null
  return (
    <>
      {list.filter((t) => t.proxy).map((t) => <Proxy key={t.key} t={t} />)}
      {STOPS.map((s) => {
        const t = markerTargetFor(targets, s.id)
        return t ? <Marker key={s.id} t={t} n={s.n} id={s.id} label={s.label} /> : null
      })}
      <HoverLabel />
      <ScreenSlot targets={targets} />
      {DEBUG && <DebugHooks />}
    </>
  )
}

function Proxy({ t }: { t: Target }) {
  const box = t.proxy!
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  return (
    <mesh position={center} {...proxyHandlers(t.key)}>
      <boxGeometry args={[size.x, size.y, size.z]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  )
}

const RING_COLOR = new THREE.Color('#ffb46b').multiplyScalar(2.2) // HDR: blooms on high/medium tiers
const RING_DIM = new THREE.Color('#ffb46b').multiplyScalar(0.5)

function Marker({ t, n, id, label }: { t: Target; n: number; id: string; label: string }) {
  const visited = useUI((s) => s.visited.includes(id))
  const active = useUI((s) => s.open?.id === id)
  const hot = useUI((s) => s.hovered !== null && s.targets.get(s.hovered)?.id === id && !s.open)
  const anyOpen = useUI((s) => s.open !== null)
  const ring = useRef<THREE.Mesh>(null)
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: RING_COLOR, toneMapped: false, transparent: true, depthWrite: false }), [])
  useEffect(() => {
    mat.color.copy(visited && !active ? RING_DIM : RING_COLOR)
    mat.opacity = anyOpen && !active ? 0.25 : visited ? 0.55 : 0.9
  }, [mat, visited, active, anyOpen])
  useFrame(({ clock }) => {
    if (!ring.current) return
    const k = 1 + Math.sin(clock.elapsedTime * 2.4 + n) * 0.08
    ring.current.scale.setScalar(visited ? 1 : k)
  })
  return (
    <group position={t.anchor}>
      <Billboard>
        <mesh ref={ring} material={mat} renderOrder={5} visible={!active}>
          <ringGeometry args={[0.035, 0.045, 40]} />
        </mesh>
      </Billboard>
      <Html center zIndexRange={[30, 10]} wrapperClass="marker-wrap">
        <button
          type="button"
          className={`marker${visited ? ' visited' : ''}${active ? ' active' : ''}${hot ? ' hot' : ''}${anyOpen && !active ? ' muted' : ''}`}
          aria-label={`Stop ${n} of ${STOPS.length}: ${label}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => activate(id)}
          onMouseEnter={() => setUI({ hovered: t.key, hoverTouch: false })}
          onMouseLeave={() => setUI({ hovered: null })}
          onFocus={() => setUI({ hovered: t.key, hoverTouch: false })}
          onBlur={() => setUI({ hovered: null })}
        >
          <span className="marker-num">{n}</span>
          <span className="marker-label">{label}</span>
        </button>
      </Html>
    </group>
  )
}

/** Label for hit targets without a numbered marker (bonus objects, books, asides). */
function HoverLabel() {
  const hovered = useUI((s) => s.hovered)
  const touch = useUI((s) => s.hoverTouch)
  const open = useUI((s) => s.open)
  const targets = useUI((s) => s.targets)
  const t = hovered ? targets.get(hovered) : undefined
  if (!t || open) return null
  if (t.def.marker && !touch) return null // the marker shows its own label
  return (
    <Html position={[t.anchor.x, t.anchor.y + (t.def.marker ? 0.09 : 0), t.anchor.z]} center zIndexRange={[35, 30]}>
      <div key={t.key} className={`hover-label${touch ? ' touch' : ''}`} role="status">
        <span>{labelFor(t.id)}</span>
        {touch && (
          <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => tapKey(t.key, false)}>
            Open
          </button>
        )}
      </div>
    </Html>
  )
}

/**
 * ScreenSlot_Monitor (material under CLICK_Monitor_Projects) ships with Wanda's "Projects" grid.
 * While the stop-1 panel is open the screen shows the project the carousel is on; when it closes
 * the original texture comes back. No ScreenSlot material: nothing happens.
 * (ScreenSlot_Laptop and ScreenSlot_Frame3DRender keep their baked images.)
 */
function ScreenSlot({ targets }: { targets: Map<string, Target> }) {
  const open = useUI((s) => s.open)
  const project = useUI((s) => s.slotProject)
  const slots = useMemo(() => {
    const out: (THREE.MeshStandardMaterial | THREE.MeshLambertMaterial)[] = []
    for (const t of targets.values()) {
      if (t.id !== 'stop-1' || t.source !== 'click') continue
      for (const n of t.nodes)
        n.traverse((o) => {
          const m = o as THREE.Mesh
          if (!m.isMesh) return
          for (const mt of Array.isArray(m.material) ? m.material : [m.material])
            if (/screenslot_monitor/i.test(mt.name) && 'emissiveMap' in mt) out.push(mt as THREE.MeshStandardMaterial)
        })
    }
    return out
  }, [targets])
  const tex = useMemo(() => {
    if (!slots.length) return null
    const c = document.createElement('canvas')
    c.width = 1024
    c.height = 576
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    t.flipY = false // glTF UV convention
    return t
  }, [slots])
  const original = useMemo(() => slots.map((m) => ({ m, map: m.map, emissiveMap: m.emissiveMap, emissive: m.emissive.clone() })), [slots])
  useEffect(() => {
    if (!tex) return
    if (open?.id !== 'stop-1') {
      for (const o of original) {
        o.m.map = o.map
        o.m.emissiveMap = o.emissiveMap
        o.m.emissive.copy(o.emissive)
        o.m.needsUpdate = true
      }
      return
    }
    const p = content.projects.find((x) => x.slug === (open?.id === 'stop-1' ? open.project ?? project : project)) ?? content.projects[0]
    const c = tex.image as HTMLCanvasElement
    const g = c.getContext('2d')!
    g.fillStyle = '#0c0f16'
    g.fillRect(0, 0, c.width, c.height)
    g.fillStyle = '#f0b273'
    g.font = '600 64px system-ui, sans-serif'
    g.fillText(p.name, 64, 200)
    g.fillStyle = '#c9d2e3'
    g.font = '30px system-ui, sans-serif'
    g.fillText(p.tagline, 64, 270)
    g.fillStyle = '#7d8799'
    g.font = '28px ui-monospace, monospace'
    g.fillText(p.repo.replace('https://', ''), 64, 480)
    tex.needsUpdate = true
    for (const m of slots) {
      m.map = tex
      m.emissiveMap = tex
      m.emissive.set('#ffffff')
      m.needsUpdate = true
    }
  }, [tex, slots, original, open, project])
  return null
}

const DEBUG = new URLSearchParams(window.location.search).has('debug')

/** ?debug: window.__desk3d.screenOf(key) -> pixel position of a target (used by the e2e shots). */
function DebugHooks() {
  const { camera, size, controls } = useThree()
  const targets = useUI((s) => s.targets)
  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).__desk3d = {
      /** Camera + OrbitControls state, to check that GSAP owns the camera during flies. */
      cam: () => {
        const c = controls as unknown as { enabled: boolean; target: THREE.Vector3 } | null
        const r = (v: THREE.Vector3) => v.toArray().map((n) => +n.toFixed(3))
        return { pos: r(camera.position), target: c ? r(c.target) : null, controlsEnabled: c?.enabled ?? null, fov: +(camera as THREE.PerspectiveCamera).fov.toFixed(2) }
      },
      open: (id: string) => activate(id),
      ui: () => {
        const u = getUI()
        return { open: u.open, visited: u.visited, finale: u.finale, thinking: u.duckThinking, sources: u.sources.keys, secrets: u.secrets }
      },
      keys: () => [...targets.values()].map((t) => `${t.key}:${t.id}:${t.source}`),
      /** Duck rig state for the e2e check: Quack morph influence, MAT_DuckEyes emissive, beam origin. */
      duck: () => {
        const d = targets.get('duck')
        if (!d) return null
        let quack: number | null = null
        let eyes: number | null = null
        let beamOrigin = false
        for (const n of d.nodes)
          n.traverse((c) => {
            if (/DUCK_BeamOrigin/i.test(c.name)) beamOrigin = true
            const m = c as THREE.Mesh
            const i = m.morphTargetDictionary ? Object.entries(m.morphTargetDictionary).find(([k]) => /quack/i.test(k))?.[1] : undefined
            if (i !== undefined && m.morphTargetInfluences) quack = Math.max(quack ?? 0, m.morphTargetInfluences[i])
            const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : []
            for (const mt of mats) if (/DuckEyes/i.test(mt.name)) eyes = Math.max(eyes ?? 0, (mt as THREE.MeshStandardMaterial).emissiveIntensity ?? 0)
          })
        return { source: d.source, quack, eyes, beamOrigin }
      },
      screenOf: (key: string) => {
        const t = targets.get(key)
        if (!t) return null
        const v = t.center.clone().project(camera)
        return { x: Math.round(((v.x + 1) / 2) * size.width), y: Math.round(((1 - v.y) / 2) * size.height), z: v.z }
      },
    }
  }, [camera, size, targets, controls])
  return null
}
