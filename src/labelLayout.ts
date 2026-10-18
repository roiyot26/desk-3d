/**
 * Room labels (Vision recruiter look §3): pure placement, no DOM or three.js so it can be unit-tested.
 *
 * Each frame the driver projects the eight anchors and calls `layoutLabels`. Chips sit above their
 * anchor on a short leader. Collisions are resolved in priority order: a chip that overlaps one
 * already placed (or a UI obstacle like the chat sheet or the HUD) is nudged up, and if it still
 * overlaps it is hidden (the DOM fades it). Chips never stack.
 */

export type Rect = { l: number; t: number; r: number; b: number }

export type LabelIn = {
  id: string
  /** 0 = highest (Ask the duck). */
  priority: number
  /** Anchor in CSS px. */
  x: number
  y: number
  /** Anchor is behind the camera (projected z > 1). */
  behind: boolean
  /** Camera to anchor, metres. */
  dist: number
  /** Chip size in CSS px. */
  w: number
  h: number
  /** Hidden by state (its panel is open). */
  hidden?: boolean
}

export type LabelFrame = {
  w: number
  h: number
  /** Usable frame (the chat sheet on phones raises the bottom). */
  top: number
  bottom: number
  /** UI rects chips must not cover (HUD, side panels, popovers). */
  obstacles: Rect[]
  /** Projected rects that only block labels at or below `minPriority` (Shuri #51: the monitor and laptop screens, so Contact never reads as the laptop's label). */
  screens?: { rect: Rect; minPriority: number }[]
  phone: boolean
}

export type LabelOut = {
  id: string
  shown: boolean
  /** Chip rect (CSS px). */
  rect: Rect
  /** Leader length from the chip's bottom edge to the anchor. */
  leader: number
  x: number
  y: number
}

/** Leader at rest (Vision: 10–24 px). */
export const LEADER = 10
/** Upward nudges tried on a collision. Capped at 14 so the leader stays within the spec's 24 px. */
export const NUDGES = [0, 4, 8, 12, 14]
/** Anchors closer than this to the frame edge hide their label. */
export const EDGE = 24
/** Chips keep this much air between them (stricter than the spec's 4 px tolerance: no touching). */
export const GAP = 2
/** Chips stay this far inside the viewport sides. */
export const SIDE = 8
export const PHONE_MAX = 5
/** Phones: labels beyond the top 5 come in when the camera is this close (metres). */
export const NEAR_M = 2.2
/** Screens block labels from Stack (priority 3) down; Ask the duck, Projects and 3D for the web may sit over them. */
export const SCREEN_MIN_PRIORITY = 3

export function overlaps(a: Rect, b: Rect, gap = 0): boolean {
  return a.l < b.r + gap && b.l < a.r + gap && a.t < b.b + gap && b.t < a.b + gap
}

/** Overlap area width × height in px (0 when apart); used by the shot metrics. */
export function overlapPx(a: Rect, b: Rect): { w: number; h: number } {
  return { w: Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)), h: Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t)) }
}

function inFrame(i: LabelIn, f: LabelFrame) {
  return !i.behind && i.x >= EDGE && i.x <= f.w - EDGE && i.y >= f.top + EDGE && i.y <= f.bottom - EDGE
}

/** Order used for placement: priority; on phones, labels near the camera move ahead of far ones (the duck stays first). */
export function placementOrder(items: LabelIn[], phone: boolean): LabelIn[] {
  const near = (i: LabelIn) => (phone && i.priority > 0 && i.dist > NEAR_M ? 1 : 0)
  return [...items].sort((a, b) => near(a) - near(b) || a.priority - b.priority)
}

function chipRect(i: LabelIn, f: LabelFrame, nudge: number): Rect {
  let l = Math.round(i.x - i.w / 2)
  l = Math.max(SIDE, Math.min(f.w - SIDE - i.w, l))
  const b = Math.round(i.y - LEADER - nudge)
  return { l, t: b - i.h, r: l + i.w, b }
}

export function layoutLabels(items: LabelIn[], f: LabelFrame): LabelOut[] {
  const placed: Rect[] = []
  const out = new Map<string, LabelOut>()
  let count = 0
  for (const i of placementOrder(items, f.phone)) {
    const res: LabelOut = { id: i.id, shown: false, rect: chipRect(i, f, 0), leader: LEADER, x: i.x, y: i.y }
    out.set(i.id, res)
    if (i.hidden || !inFrame(i, f)) continue
    if (f.phone && count >= PHONE_MAX) continue
    for (const n of NUDGES) {
      const r = chipRect(i, f, n)
      if (r.t < f.top + 4) break
      if (placed.some((p) => overlaps(r, p, GAP)) || f.obstacles.some((o) => overlaps(r, o))) continue
      if (f.screens?.some((x) => i.priority >= x.minPriority && overlaps(r, x.rect))) continue
      res.rect = r
      res.leader = LEADER + n
      res.shown = true
      placed.push(r)
      count++
      break
    }
  }
  return items.map((i) => out.get(i.id)!)
}

/** WCAG contrast ratio of two sRGB colours (0–255). */
export function contrast(a: [number, number, number], b: [number, number, number]): number {
  const lum = (c: [number, number, number]) => {
    const f = (v: number) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
  }
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** `fg` at `alpha` composited over `bg`. */
export function over(fg: [number, number, number], alpha: number, bg: [number, number, number]): [number, number, number] {
  return [0, 1, 2].map((k) => Math.round(fg[k] * alpha + bg[k] * (1 - alpha))) as [number, number, number]
}
