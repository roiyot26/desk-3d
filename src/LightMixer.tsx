import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { getUI } from './store'

/**
 * Switchable light groups. Lights and emissive materials register with a group and their base
 * intensity; LightMixer eases every group toward its target each frame:
 *   desk / floor / ambient  follow the switch, the lamps and the duck's set_lights tool
 *   neon                    always on; pulses in agentic mode (typing "claude"), blinks when clicked
 *   eyes                    the duck's eyes: glow while it thinks and in agentic mode
 * In agentic mode the room lights dim to 35%.
 * Bake names in Blender (lights are not exported; these groups mirror them for the baked GLB):
 *   desk = LGT_DeskLamp_* / LGT_Key_Lamp*, floor = LGT_FloorLamp_*, neon = LGT_Neon_*,
 *   ambient = LGT_Fill_* + LGT_Window_* + LGT_Picture_*.
 */
export type MixGroup = 'desk' | 'floor' | 'ambient' | 'neon' | 'eyes'

type Entry =
  | { kind: 'light'; obj: THREE.Light; group: MixGroup; base: number }
  | { kind: 'mat'; obj: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial; group: MixGroup; base: number }

const entries = new Set<Entry>()
const level: Record<MixGroup, number> = { desk: 1, floor: 1, ambient: 1, neon: 1, eyes: 0 }

/** Ref callback for a JSX light: <pointLight ref={mixRef('desk')} />. */
const refCache = new Map<MixGroup, (l: THREE.Light | null) => void>()
export function mixRef(group: MixGroup) {
  let f = refCache.get(group)
  if (!f) {
    const owned = new Map<THREE.Light, Entry>()
    f = (l: THREE.Light | null) => {
      // React calls ref(null) on unmount; drop entries whose light left the scene.
      for (const [light, e] of owned) if (!light.parent) (entries.delete(e), owned.delete(light))
      if (l && !owned.has(l)) {
        const e: Entry = { kind: 'light', obj: l, group, base: l.intensity }
        entries.add(e)
        owned.set(l, e)
      }
    }
    refCache.set(group, f)
  }
  return f
}

export function registerLight(obj: THREE.Light, group: MixGroup) {
  const e: Entry = { kind: 'light', obj, group, base: obj.intensity }
  entries.add(e)
  return () => void entries.delete(e)
}

export function registerMaterial(obj: THREE.Material, group: MixGroup, base?: number) {
  const m = obj as THREE.MeshStandardMaterial
  if (!('emissiveIntensity' in m)) return () => {}
  const e: Entry = { kind: 'mat', obj: m, group, base: base ?? m.emissiveIntensity }
  entries.add(e)
  return () => void entries.delete(e)
}

export function clearMaterials() {
  for (const e of entries) if (e.kind === 'mat') entries.delete(e)
}

export function LightMixer() {
  useFrame(({ clock }, delta) => {
    const s = getUI()
    const now = performance.now()
    const agentic = s.agenticUntil > now
    const dim = agentic ? 0.35 : 1
    const t = clock.elapsedTime
    const target: Record<MixGroup, number> = {
      desk: (s.lights.desk ? 1 : 0) * dim,
      floor: (s.lights.floor ? 1 : 0) * dim,
      ambient: (s.lights.ambient ? 1 : 0.25) * dim,
      neon: agentic ? 1.4 + 0.9 * Math.sin(t * 7) : s.neonUntil > now ? (Math.sin(t * 22) > 0 ? 1.8 : 0.25) : 1,
      eyes: s.duckThinking || agentic ? 3 + 1.5 * Math.sin(t * 10) : 0.03,
    }
    const k = Math.min(1, delta * 5)
    for (const g of Object.keys(level) as MixGroup[]) {
      // Pulses follow immediately; switches ease.
      level[g] = g === 'neon' || g === 'eyes' ? target[g] : level[g] + (target[g] - level[g]) * k
    }
    for (const e of entries) {
      const v = e.base * level[e.group]
      if (e.kind === 'light') e.obj.intensity = v
      else e.obj.emissiveIntensity = v
    }
  })
  return null
}
