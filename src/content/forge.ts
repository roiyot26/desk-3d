/** Wanda's Blender export inventory. Missing names are fine: callers stay tolerant. */
import raw from './forge_manifest.json'

export type ForgeManifest = {
  glb: string
  click: string[]
  stops: string[]
  markers: string[]
  screen_slots: string[]
  keys: string[]
  other: string[]
  morph_targets: Record<string, string[]>
  stop_cam_note?: string
}

export const forge = raw as ForgeManifest

export const FORGE_CLICKS = new Set(forge.click)
export const FORGE_KEYS = new Set(forge.keys)
export const FORGE_MARKERS = new Set(forge.markers)

/** STOP_1..STOP_7 → panel id. STOP_8+ (art) ignored. Duck is stop 7. */
const STOP_PANEL: Record<number, string> = {
  1: 'stop-1',
  2: 'stop-2',
  3: 'stop-3',
  4: 'stop-4',
  5: 'stop-5',
  6: 'stop-6',
  7: 'bonus-duck',
}

export function stopCamsFromManifest(): Record<number, string> {
  const out: Record<number, string> = {}
  for (const name of forge.stops) {
    const m = name.match(/^STOP_(\d+)_/)
    if (!m) continue
    const n = Number(m[1])
    if (n >= 8) continue
    const id = STOP_PANEL[n]
    if (id) out[n] = id
  }
  return out
}
