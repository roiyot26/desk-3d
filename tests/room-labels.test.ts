import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { content } from '../src/content'
import { contrast, EDGE, GAP, layoutLabels, LEADER, NUDGES, over, overlaps, PHONE_MAX, type LabelFrame, type LabelIn } from '../src/labelLayout'
import { freeCentreNdc, poseFor, type Target } from '../src/targets'

const frame = (o: Partial<LabelFrame> = {}): LabelFrame => ({ w: 1440, h: 900, top: 0, bottom: 900, obstacles: [], phone: false, ...o })
const item = (id: string, priority: number, x: number, y: number, o: Partial<LabelIn> = {}): LabelIn => ({ id, priority, x, y, behind: false, dist: 3, w: 100, h: 28, ...o })
const shown = (out: ReturnType<typeof layoutLabels>) => out.filter((o) => o.shown).map((o) => o.id)

describe('B2: the eight labels (Vision recruiter look §3)', () => {
  it('are the guide rows in the spec priority order, sentence case', () => {
    expect(content.guide.rows.map((r) => r.label)).toEqual(['Ask the duck', 'Projects', '3D for the web', 'Stack', 'Contact', 'Career', 'Virtual Garden', 'Now building'])
    // sentence case: only the first word (and the product name Virtual Garden / 3D) is capitalised
    for (const r of content.guide.rows.filter((x) => x.label !== 'Virtual Garden')) expect(r.label.slice(1), r.label).toBe(r.label.slice(1).toLowerCase().replace(/^d/, 'D'))
  })
  it('no counters or scores in label copy', () => {
    for (const r of content.guide.rows) expect(r.label).not.toMatch(/\d+\s*\/\s*\d+|\bof\s+\d|★|found/i)
  })
})

describe('B2: label layout', () => {
  it('places a chip centred above its anchor on a 10 px leader', () => {
    const [o] = layoutLabels([item('a', 0, 500, 400)], frame())
    expect(o.shown).toBe(true)
    expect(o.rect).toEqual({ l: 450, t: 400 - LEADER - 28, r: 550, b: 400 - LEADER })
    expect(o.leader).toBe(LEADER)
  })
  it('on a collision the lower priority chip is nudged up, never stacked on top', () => {
    // b's anchor sits 20 px below a's: its chip would overlap; a 14 px nudge isn't enough for a 28 px chip, so it hides
    const out = layoutLabels([item('b', 3, 520, 420), item('a', 1, 500, 400)], frame())
    expect(shown(out)).toEqual(['a'])
    // anchors 36 px apart vertically: an 8–12 px nudge clears it (leader stretches)
    // b's chip bottom would sit 6 px inside a's top (plus the 2 px gap): an 8 px nudge clears it and the leader stretches to 18
    const out2 = layoutLabels([item('a', 1, 500, 400), item('b', 3, 520, 376)], frame())
    expect(shown(out2)).toEqual(['a', 'b'])
    const b = out2.find((o) => o.id === 'b')!
    expect(b.leader).toBe(18)
    expect(b.leader).toBeLessThanOrEqual(24)
  })
  it('priority decides who stays, regardless of input order', () => {
    const out = layoutLabels([item('stack', 3, 500, 400), item('duck', 0, 505, 402)], frame())
    expect(shown(out)).toEqual(['duck'])
  })
  it('hides labels whose anchor is near the frame edge, behind the camera or under the sheet', () => {
    const f = frame({ w: 390, h: 844, bottom: 407, phone: true })
    const out = layoutLabels(
      [item('edge', 1, EDGE - 1, 200), item('behind', 2, 200, 200, { behind: true }), item('sheet', 3, 200, 407 - EDGE + 1), item('ok', 4, 200, 200)],
      f,
    )
    expect(shown(out)).toEqual(['ok'])
  })
  it('keeps chips off UI obstacles (HUD, side panel)', () => {
    const out = layoutLabels([item('a', 1, 1300, 60)], frame({ obstacles: [{ l: 1200, t: 0, r: 1440, b: 60 }] }))
    expect(shown(out)).toEqual([])
  })
  it('hides the label of the open panel', () => {
    expect(shown(layoutLabels([item('a', 1, 500, 400, { hidden: true })], frame()))).toEqual([])
  })
  it('phones: at most 5, Ask the duck always among them, near objects ahead of far ones', () => {
    const items = Array.from({ length: 8 }, (_, i) => item(`p${i}`, i, 40 + (i % 4) * 90, 150 + Math.floor(i / 4) * 120, { w: 80, h: 26, dist: i === 7 ? 1.5 : 4 }))
    const out = layoutLabels(items, frame({ w: 390, h: 844, bottom: 600, phone: true }))
    const s = shown(out)
    expect(s.length).toBe(PHONE_MAX)
    expect(s).toContain('p0')
    expect(s).toContain('p7') // within 2.2 m: comes in on phones
    expect(s).not.toContain('p4')
  })
  it('desktop shows all 8 when there is room', () => {
    const items = Array.from({ length: 8 }, (_, i) => item(`d${i}`, i, 100 + i * 160, 300))
    expect(shown(layoutLabels(items, frame())).length).toBe(8)
  })
  it('never overlaps, in 500 random rooms', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let n = 0; n < 500; n++) {
      const phone = n % 2 === 1
      const f = frame(phone ? { w: 390, h: 844, bottom: 407, phone, obstacles: [{ l: 330, t: 8, r: 382, b: 52 }] } : { obstacles: [{ l: 955, t: 24, r: 1416, b: 876 }] })
      const items = Array.from({ length: 8 }, (_, i) => item(`r${i}`, i, rnd() * f.w, rnd() * f.h, { w: 60 + rnd() * 60, h: phone ? 26 : 28, dist: 1 + rnd() * 4 }))
      const out = layoutLabels(items, f).filter((o) => o.shown)
      if (phone) expect(out.length).toBeLessThanOrEqual(PHONE_MAX)
      for (let i = 0; i < out.length; i++) {
        expect(out[i].leader).toBeLessThanOrEqual(LEADER + NUDGES[NUDGES.length - 1])
        for (const ob of f.obstacles) expect(overlaps(out[i].rect, ob)).toBe(false)
        for (let j = i + 1; j < out.length; j++) expect(overlaps(out[i].rect, out[j].rect, GAP)).toBe(false)
      }
    }
  })
})

describe('B2: chip legibility', () => {
  it('ink on the 0.88 panel chip stays ≥9:1 over the brightest lamp pixel (#FFB46B)', () => {
    const chip = over([0x1c, 0x17, 0x16], 0.88, [0xff, 0xb4, 0x6b])
    expect(contrast([0xec, 0xe6, 0xdd], chip)).toBeGreaterThanOrEqual(9)
  })
})

describe('B2 (Fury): Claude Code book centred in the free area on desktop', () => {
  const box = new THREE.Box3(new THREE.Vector3(-0.02, 1.0, -0.1), new THREE.Vector3(0.02, 1.25, 0.1))
  const t = { key: 'book-claude-code', id: 'stop-3', def: { key: 'book-claude-code', id: 'stop-3', click: [], view: [1, 0.1, 0.2] }, source: 'click', nodes: [], box, center: box.getCenter(new THREE.Vector3()), anchor: new THREE.Vector3(), proxy: null } as unknown as Target
  const ctx = { home: { position: new THREE.Vector3(2, 1.4, 2), target: new THREE.Vector3() }, safe: new THREE.Box3(new THREE.Vector3(-9, -9, -9), new THREE.Vector3(9, 9, 9)), info: {} as never }
  const ndcX = (W: number, H: number, fov: number, xc?: number) => {
    const pose = poseFor(t, { ...ctx, aspect: W / H, fov, xc })
    const cam = new THREE.PerspectiveCamera(fov, W / H, 0.01, 50)
    cam.position.copy(pose.position)
    cam.lookAt(pose.target)
    cam.updateMatrixWorld()
    return t.center.clone().project(cam).x
  }
  it('lands on the free-area centre (1440, chat docked, 254 px projection shift)', () => {
    const W = 1440
    const xc = freeCentreNdc(W, 473 + 24, 254, { l: 12, r: 955 })
    const px = ((ndcX(W, 900, 46.8, xc) + 1) / 2) * W - 254 // after the rig's view offset
    expect(Math.abs(px - (12 + 955) / 2) / 955).toBeLessThan(0.02)
  })
  it('the generic desktop offset is unchanged for other objects', () => {
    expect(ndcX(1440, 900, 46.8)).toBeCloseTo(-0.32, 2)
  })
  it('phones keep the book-above-the-sheet framing (xc ignored in portrait)', () => {
    const a = poseFor(t, { ...ctx, aspect: 390 / 844, fov: 72, above: 0.4 })
    const b = poseFor(t, { ...ctx, aspect: 390 / 844, fov: 72, above: 0.4, xc: 0.5 })
    expect(b.target.toArray()).toEqual(a.target.toArray())
  })
})

describe('B2 (Fury): poster dips to dark, never blends over the live room', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  it('image fades first (250 ms), then the dark layer lifts (300 ms after a 250 ms delay)', () => {
    expect(html).toMatch(/#poster img \{[^}]*transition: opacity 250ms ease/)
    expect(html).toMatch(/#poster \{[^}]*transition: opacity 300ms ease 250ms/)
    expect(html).toMatch(/#poster\.out, #poster\.out img \{ opacity: 0; \}/)
    expect(html).not.toMatch(/transition: opacity 1s ease/)
  })
})

describe('Shuri #51: the monitor and laptop screens block lower-priority labels', () => {
  const screen = { rect: { l: 400, t: 300, r: 700, b: 520 }, minPriority: 3 }
  it('Contact (priority 4) never sits on a screen', () => {
    expect(shown(layoutLabels([item('stop-6', 4, 660, 480)], frame({ screens: [screen] })))).toEqual([])
  })
  it('Ask the duck, Projects and 3D for the web may', () => {
    expect(shown(layoutLabels([item('stop-7', 0, 500, 480), item('stop-2', 2, 640, 420)], frame({ screens: [screen] })))).toEqual(['stop-7', 'stop-2'])
  })
  it('off the screen, Contact shows as before', () => {
    expect(shown(layoutLabels([item('stop-6', 4, 900, 480)], frame({ screens: [screen] })))).toEqual(['stop-6'])
  })
})
