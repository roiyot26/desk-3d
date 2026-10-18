import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { DESKTOP_MAX, GAP, HIT, hitRect, layoutLabels, LEADER, PHONE_MAX, overlaps, type LabelFrame, type LabelIn, type Rect } from '../src/labelLayout'

vi.mock('../src/CameraRig', () => ({ rigFlags: { flying: false } }))
vi.mock('../src/interact', () => ({ tapKey: () => {} }))
vi.mock('../src/Room', () => ({ roomScene: null }))
const { trackLabelGesture, labelClickAllowed, labelGesture, GESTURE_CLICK_GUARD_MS } = await import('../src/Labels')

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
const rig = readFileSync(new URL('../src/CameraRig.tsx', import.meta.url), 'utf8')
const frame = (o: Partial<LabelFrame> = {}): LabelFrame => ({ w: 1440, h: 900, top: 0, bottom: 900, obstacles: [], phone: false, ...o })
const phoneFrame = (o: Partial<LabelFrame> = {}) => frame({ w: 390, h: 844, bottom: 407, phone: true, obstacles: [{ l: 330, t: 8, r: 382, b: 52 }], ...o })
const item = (id: string, priority: number, x: number, y: number, o: Partial<LabelIn> = {}): LabelIn => ({ id, priority, x, y, behind: false, dist: 3, w: 100, h: 28, ...o })
const shown = (out: ReturnType<typeof layoutLabels>) => out.filter((o) => o.shown)
let seed = 11
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const rooms = (n: number, cb: (f: LabelFrame, out: ReturnType<typeof shown>, items: LabelIn[]) => void) => {
  for (let k = 0; k < n; k++) {
    const phone = k % 2 === 1
    const f = phone ? phoneFrame() : frame({ obstacles: [{ l: 955, t: 24, r: 1416, b: 876 }, { l: 420, t: 12, r: 940, b: 50 }] })
    const items = Array.from({ length: 8 }, (_, i) => item(`r${i}`, i, rnd() * f.w, rnd() * f.h, { w: 60 + rnd() * 60, h: phone ? 26 : 28, dist: 1 + rnd() * 4 }))
    cb(f, shown(layoutLabels(items, f)), items)
  }
}

describe('Hawkeye #8 F1 + WARN-3: label caps', () => {
  it('3 on phones, 5 on desktop', () => {
    expect(PHONE_MAX).toBe(3)
    expect(DESKTOP_MAX).toBe(5)
  })
  it('never more, in 1000 random rooms; a wide-open desk view stops at the cap', () => {
    rooms(1000, (f, out) => expect(out.length).toBeLessThanOrEqual(f.phone ? PHONE_MAX : DESKTOP_MAX))
    const spread = (f: LabelFrame, step: number) => Array.from({ length: 8 }, (_, i) => item(`s${i}`, i, 40 + (i % 4) * step, 150 + Math.floor(i / 4) * 120, { w: 60, h: 26 }))
    expect(shown(layoutLabels(spread(phoneFrame(), 95), phoneFrame())).length).toBe(3)
    expect(shown(layoutLabels(spread(frame(), 300), frame())).length).toBe(5)
  })
})

describe('Hawkeye #8 F2: every keep-out reserves the whole 44 px tap area', () => {
  it('the tap area is 44 px tall around a 26 px chip, and never smaller than the chip', () => {
    expect(hitRect({ l: 10, t: 100, r: 82, b: 126 })).toEqual({ l: 10, t: 91, r: 82, b: 135 })
    expect(hitRect({ l: 10, t: 100, r: 30, b: 150 })).toEqual({ l: -2, t: 100, r: 42, b: 150 })
    expect(HIT).toBe(44)
  })
  it("Hawkeye's repro: a chip that would sit at y 5–31 at 360 is not placed with a clipped tap area", () => {
    const out = layoutLabels([item('stop-1', 1, 120, 41, { w: 72, h: 26 })], phoneFrame({ w: 360, h: 780, bottom: 351 }))
    for (const o of shown(out)) expect(hitRect(o.rect).t).toBeGreaterThanOrEqual(0)
    expect(shown(out)).toEqual([])
    // 4 px lower (chip top at 9) and the whole tap area fits exactly
    const ok = shown(layoutLabels([item('stop-1', 1, 120, 45, { w: 72, h: 26 })], phoneFrame({ w: 360, h: 780, bottom: 351 })))
    expect(ok.length).toBe(1)
    expect(hitRect(ok[0].rect).t).toBe(0)
  })
  it('sides, sheet top and the top-bar/HUD obstacles all apply to the tap area', () => {
    // sheet: tap area may not reach under the sheet top
    const f = phoneFrame({ bottom: 300 })
    const near = shown(layoutLabels([item('a', 1, 200, 300 - 24, { w: 80, h: 26 })], f))
    for (const o of near) expect(hitRect(o.rect).b).toBeLessThanOrEqual(300)
    // HUD ⋯ obstacle (330–382 × 8–52): a chip whose tap area would touch it is not placed there
    const hud = shown(layoutLabels([item('a', 1, 300, 75, { w: 80, h: 26 })], phoneFrame()))
    for (const o of hud) expect(overlaps(hitRect(o.rect), { l: 330, t: 8, r: 382, b: 52 })).toBe(false)
    // narrow chip at the left edge: its 44 px tap area stays on screen
    const narrow = shown(layoutLabels([item('a', 1, 25, 200, { w: 30, h: 26 })], phoneFrame()))
    for (const o of narrow) expect(hitRect(o.rect).l).toBeGreaterThanOrEqual(0)
  })
  it('in 1000 random rooms every shown tap area is inside the frame and off every obstacle', () => {
    rooms(1000, (f, out) => {
      for (const o of out) {
        const h = hitRect(o.rect)
        expect(h.t).toBeGreaterThanOrEqual(f.top)
        expect(h.b).toBeLessThanOrEqual(f.bottom)
        expect(h.l).toBeGreaterThanOrEqual(0)
        expect(h.r).toBeLessThanOrEqual(f.w)
        for (const ob of f.obstacles) expect(overlaps(h, ob)).toBe(false)
      }
    })
  })
})

describe('Hawkeye #8 WARN-5: collisions use the 44 px tap areas', () => {
  it('two chips 20 px apart vertically: the chips alone would clear with a 14 px nudge, the tap areas do not, so b hides', () => {
    const out = layoutLabels([item('a', 1, 500, 400), item('b', 3, 520, 370)], frame())
    expect(shown(out).map((o) => o.id)).toEqual(['a'])
  })
  it('in 1000 random rooms no two tap areas overlap', () => {
    rooms(1000, (_, out) => {
      for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) expect(overlaps(hitRect(out[i].rect), hitRect(out[j].rect), GAP)).toBe(false)
    })
  })
})

describe('Hawkeye #8 WARN-1: Ask the duck clears the duck and, where it can, the screens', () => {
  const duck: Rect = { l: 470, t: 380, r: 540, b: 470 }
  it('chip and leader end above the duck box, even when the anchor point sits inside it', () => {
    const [o] = layoutLabels([item('stop-7', 0, 505, 398, { own: duck, softScreens: true })], frame())
    expect(o.shown).toBe(true)
    expect(o.rect.b).toBeLessThanOrEqual(duck.t - LEADER)
    expect(o.y).toBe(duck.t)
    expect(o.rect.b + o.leader).toBe(duck.t)
  })
  it('shifts sideways off a screen when that clears it', () => {
    const screen = { rect: { l: 380, t: 300, r: 480, b: 380 }, minPriority: 3 }
    const [o] = layoutLabels([item('stop-7', 0, 505, 398, { own: duck, softScreens: true })], frame({ screens: [screen] }))
    expect(o.shown).toBe(true)
    expect(overlaps(o.rect, screen.rect)).toBe(false)
    expect(o.x).toBeGreaterThanOrEqual(o.rect.l + 6) // the leader still drops from under the chip
    expect(o.x).toBeLessThanOrEqual(o.rect.r - 6)
  })
  it('still shows over a screen when nothing else fits (it is the lead label)', () => {
    const screen = { rect: { l: 0, t: 0, r: 1440, b: 380 }, minPriority: 3 }
    const [o] = layoutLabels([item('stop-7', 0, 505, 398, { own: duck, softScreens: true })], frame({ screens: [screen] }))
    expect(o.shown).toBe(true)
  })
})

describe('Hawkeye #8 F3: labels never take part in multi-touch', () => {
  const touch = (type: string, pointerId: number) => Object.assign(new Event(type), { pointerType: 'touch', pointerId })
  const touches = (type: string, n: number) => Object.assign(new Event(type), { touches: { length: n } })
  it('a second finger turns the layer off until every finger is up; a single tap is untouched', () => {
    const doc = new EventTarget() as unknown as Document
    const seen: boolean[] = []
    const stop = trackLabelGesture(doc, (on) => seen.push(on))
    doc.dispatchEvent(touch('pointerdown', 1))
    expect(labelGesture.active).toBe(false)
    doc.dispatchEvent(touch('pointerup', 1))
    expect(seen).toEqual([])
    doc.dispatchEvent(touch('pointerdown', 1))
    doc.dispatchEvent(touch('pointerdown', 2))
    expect(labelGesture.active).toBe(true)
    expect(labelClickAllowed()).toBe(false)
    doc.dispatchEvent(touch('pointerup', 2))
    expect(labelGesture.active).toBe(true) // one finger still down: still the gesture
    doc.dispatchEvent(touch('pointerup', 1))
    expect(labelGesture.active).toBe(false)
    expect(seen).toEqual([true, false])
    // the click that can follow the gesture is swallowed; a later single tap opens
    expect(labelClickAllowed()).toBe(false)
    expect(labelClickAllowed(performance.now() + GESTURE_CLICK_GUARD_MS + 1)).toBe(true)
    // touch events alone (touches.length > 1) do the same
    doc.dispatchEvent(touches('touchstart', 2))
    expect(labelGesture.active).toBe(true)
    doc.dispatchEvent(touches('touchend', 0))
    expect(labelGesture.active).toBe(false)
    stop()
  })
  it('the gesture class drops pointer events on every chip', () => {
    expect(css).toMatch(/\.room-labels\.gesture \.room-label \{ pointer-events: none; \}/)
    expect(css).toMatch(/\.room-label \{ touch-action: none; \}/)
  })
  it('the pinch reads touches from the document, accepting fingers on the canvas or the label layer only', () => {
    expect(rig).toMatch(/doc\.addEventListener\('touchmove', onTouchMove, \{ passive: false \}\)/)
    expect(rig).toMatch(/closest\('\.room-labels'\)/)
    expect(rig).toMatch(/\[\.\.\.e\.touches\]\.every\(onRoom\)/)
  })
})
