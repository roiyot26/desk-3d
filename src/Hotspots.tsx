import { useEffect, useMemo } from 'react'
import { bakeWeights } from './bake/BakedLighting'
import { roomScene } from './Room'
import { debugPose } from './debugPose'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { content, labelFor } from './content'
import { proxyHandlers, tapKey } from './interact'
import { activate } from './nav'
import { getUI, useUI } from './store'
import { type Target } from './targets'
import { cueDebug } from './duck/DuckRig'
import { sharpenTextTexture, snapToPixel } from './sharp'

/** Big invisible hit boxes for small objects and the hover label. No tour markers (stations get hint rims in a later PR). */
export function Hotspots() {
  const targets = useUI((s) => s.targets)
  const ready = useUI((s) => s.stage === 'ready' && s.entered)
  const list = useMemo(() => [...targets.values()], [targets])
  if (!ready) return null
  return (
    <>
      {list.filter((t) => t.proxy).map((t) => <Proxy key={t.key} t={t} />)}
      <HoverLabel />
      <ScreenSlot targets={targets} />
      <SwitchRocker targets={targets} />
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

/** Hover label for every hit target (desktop hover; phones: first tap shows it, "Open" opens). */
function HoverLabel() {
  const hovered = useUI((s) => s.hovered)
  const touch = useUI((s) => s.hoverTouch)
  const open = useUI((s) => s.open)
  const targets = useUI((s) => s.targets)
  const t = hovered ? targets.get(hovered) : undefined
  if (!t || open) return null
  return (
    <Html position={[t.anchor.x, t.anchor.y + (t.def.marker ? 0.09 : 0), t.anchor.z]} center zIndexRange={[35, 30]} calculatePosition={snapToPixel}>
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
  const gl = useThree((s) => s.gl)
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
    // Drawn at 2× (2048×1152) and sampled without mipmaps (+ max anisotropy): crisp text on the
    // monitor instead of a blurred mip level.
    const c = document.createElement('canvas')
    c.width = 2048
    c.height = 1152
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    t.flipY = false // glTF UV convention
    sharpenTextTexture(t, gl)
    return t
  }, [slots, gl])
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
    g.setTransform(2, 0, 0, 2, 0, 0) // layout below is in 1024×576 units
    g.fillStyle = '#0c0f16'
    g.fillRect(0, 0, 1024, 576)
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

/**
 * The wall switch's rocker shows the room-lights state, whichever control flipped it (the switch
 * itself, the HUD bulb or the duck): one shared `lights.ambient` flag drives both. The rocker
 * tilts ~9° about the horizontal axis along the wall, around its own centre. No Switch_Rocker
 * in the GLB: nothing happens.
 */
function SwitchRocker({ targets }: { targets: Map<string, Target> }) {
  const on = useUI((s) => s.lights.ambient)
  const rig = useMemo(() => {
    const t = targets.get('switch')
    if (!t) return null
    let rocker: THREE.Object3D | undefined
    let plate: THREE.Object3D | undefined
    for (const n of t.nodes)
      n.traverse((o) => {
        if (!rocker && /rocker/i.test(o.name)) rocker = o
        if (!plate && /plate/i.test(o.name)) plate = o
      })
    if (!rocker || !rocker.parent) return null
    rocker.updateWorldMatrix(true, true)
    const box = new THREE.Box3().setFromObject(rocker)
    const ref = plate ? new THREE.Box3().setFromObject(plate) : box
    const size = ref.getSize(new THREE.Vector3())
    // Wall normal = the plate's thinnest axis; tilt about the horizontal axis lying in the wall.
    const normal = size.x <= size.z ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1)
    const axisWorld = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), normal).normalize()
    const parent = rocker.parent
    const parentQ = parent.getWorldQuaternion(new THREE.Quaternion())
    const axis = axisWorld.applyQuaternion(parentQ.invert()).normalize()
    const pivot = parent.worldToLocal(box.getCenter(new THREE.Vector3()))
    return { rocker, axis, pivot, p0: rocker.position.clone(), q0: rocker.quaternion.clone() }
  }, [targets])
  useEffect(() => {
    if (!rig) return
    const r = new THREE.Quaternion().setFromAxisAngle(rig.axis, on ? 0.16 : -0.16)
    rig.rocker.quaternion.copy(r).multiply(rig.q0)
    rig.rocker.position.copy(rig.p0).sub(rig.pivot).applyQuaternion(r).add(rig.pivot)
  }, [rig, on])
  useEffect(
    () => () => {
      if (!rig) return
      rig.rocker.quaternion.copy(rig.q0)
      rig.rocker.position.copy(rig.p0)
    },
    [rig],
  )
  return null
}

const DEBUG = new URLSearchParams(window.location.search).has('debug')

/** ?debug: window.__desk3d.screenOf(key) -> pixel position of a target (used by the e2e shots). */
function DebugHooks() {
  const { camera, size, controls, gl } = useThree()
  const targets = useUI((s) => s.targets)
  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).__desk3d = {
      /** Camera + OrbitControls state, to check that GSAP owns the camera during flies. */
      cam: () => {
        const c = controls as unknown as { enabled: boolean; target: THREE.Vector3 } | null
        const r = (v: THREE.Vector3) => v.toArray().map((n) => +n.toFixed(3))
        return { pos: r(camera.position), target: c ? r(c.target) : null, controlsEnabled: c?.enabled ?? null, fov: +(camera as THREE.PerspectiveCamera).fov.toFixed(2), viewOffsetX: (camera as THREE.PerspectiveCamera).view?.enabled ? (camera as THREE.PerspectiveCamera).view!.offsetX : 0 }
      },
      open: (id: string) => activate(id),
      /** Free roam: face a compass heading (0 = N = -Z window wall, 90 = E = +X door wall, 180 = S, 270 = W) and pitch. */
      look: (yawDeg: number, pitchDeg = 0) => {
        const c = controls as unknown as { enableDamping: boolean; setAzimuthalAngle: (a: number) => void; setPolarAngle: (a: number) => void; update: () => void } | null
        if (!c) return
        window.dispatchEvent(new Event('desk3d:look'))
        // Snap (no damping tail), so slow headless frames can't leave it half-way when the drift starts.
        const damping = c.enableDamping
        c.enableDamping = false
        c.setAzimuthalAngle(-THREE.MathUtils.degToRad(yawDeg))
        c.setPolarAngle(THREE.MathUtils.degToRad(90 + pitchDeg))
        c.update()
        c.enableDamping = damping
      },
      /** Fixed camera at a glTF position looking at a target, vertical fov in degrees; pose(null) releases it. */
      pose: (position: number[] | null, target?: number[], fov?: number) => {
        debugPose.current = position && target ? { position, target, fov: fov ?? 50 } : null
        if (!position) {
          const c = controls as unknown as { enabled: boolean } | null
          if (c) c.enabled = true
        }
      },
      /** Renderer tone mapping (three constant) + exposure. */
      tone: () => ({ toneMapping: gl.toneMapping, exposure: gl.toneMappingExposure }),
      /** Swap a material's base-colour texture for its mean colour (artifact bisecting). */
      flatMap: (name: string, hex: string) => {
        let n = 0
        roomScene?.traverse((o) => {
          const m = o as THREE.Mesh
          if (!m.isMesh) return
          for (const mt of ([] as THREE.Material[]).concat(m.material)) {
            const s = mt as THREE.MeshStandardMaterial
            if (mt.name.replace(/_clone$/, '') === name && s.map) {
              s.map = null
              s.color.set(hex)
              s.needsUpdate = true
              n++
            }
          }
        })
        return n
      },
      /** Bake blend weights + emissive levels of the switchable materials (lights e2e check). */
      mix: () => {
        const em: Record<string, number> = {}
        roomScene?.traverse((o) => {
          const m = o as THREE.Mesh
          if (!m.isMesh) return
          for (const mt of ([] as THREE.Material[]).concat(m.material)) {
            const n = mt.name.replace(/_clone$/, '')
            if (/^(ShelfLEDCyan|NeonCyan|NeonMagenta|RimMagenta|MAT_Linen_Shade|Bulb)$/.test(n)) {
              const k = n === 'Bulb' ? `Bulb@${m.name}` : n
              em[k] = Math.max(em[k] ?? 0, +((mt as THREE.MeshStandardMaterial).emissiveIntensity ?? 0).toFixed(3))
            }
          }
        })
        return { weights: { ...bakeWeights }, emissive: em }
      },
      /** Same path as a real click on a hit target (e.g. 'switch' = CLICK_Switch_Lights). */
      tap: (key: string) => tapKey(key, false),
      ui: () => {
        const u = getUI()
        return { open: u.open, visited: u.visited, finale: u.finale, thinking: u.duckThinking, sources: u.sources.keys, secrets: u.secrets, lights: u.lights }
      },
      /** World box of a hit target (centre + size, glTF metres). */
      box: (key: string) => {
        const t = targets.get(key)
        if (!t) return null
        return { c: t.box.getCenter(new THREE.Vector3()).toArray(), s: t.box.getSize(new THREE.Vector3()).toArray() }
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
      /** Duck pointer cues (beam tube + ring): live visibility/opacity, peak seen, screen path. */
      beams: () =>
        [...cueDebug].map((c) => ({
          kind: c.kind,
          mounted: c.mounted,
          visible: c.visible(),
          opacity: +c.opacity().toFixed(3),
          maxOpacity: +c.maxOpacity.toFixed(3),
          shownFrames: c.shownFrames,
          path: c.points.map((p) => {
            const v = p.clone().project(camera)
            return [Math.round(((v.x + 1) / 2) * size.width), Math.round(((1 - v.y) / 2) * size.height), +v.z.toFixed(3)]
          }),
        })),
      screenOf: (key: string) => {
        const t = targets.get(key)
        if (!t) return null
        const v = t.center.clone().project(camera)
        return { x: Math.round(((v.x + 1) / 2) * size.width), y: Math.round(((1 - v.y) / 2) * size.height), z: v.z }
      },
    }
  }, [camera, size, targets, controls, gl])
  return null
}
