import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import * as THREE from 'three'

vi.mock('../src/audio', () => ({ audio: { unlock: () => {}, play: () => {}, quack: () => {} } }))
const { content, STOPS } = await import('../src/content')
const { StopBody, shouldPublish } = await import('../src/Overlay')
const { headClamp, sentences } = await import('../src/duck/headClamp')
const targets = await import('../src/targets')
const { checkPortrait, fitPortrait, phoneBasePose, poseFromStopCam, PHONE_POSES, TARGET_DEFS } = targets
const { setUI } = await import('../src/store')
const { SHEET_CAPS, CAP_FLOOR, CAP_STEP, sheetCap, widthBucket } = await import('../src/sheetCaps')
const { Loader } = await import('../src/Loader')

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
const css = src('index.css')
const paper = css.slice(css.indexOf('panel look v2.3'))
const rule = (sel: string) => {
  const i = paper.indexOf(`${sel} {`)
  expect(i, sel).toBeGreaterThan(-1)
  return paper.slice(i, paper.indexOf('}', i))
}
const stop = (id: string) => STOPS.find((s) => s.id === id)!

describe('panel v2.1–v2.3: paper card tokens and type (Vision A2)', () => {
  it('paper #E4D8C2, ink #2A211B, radius 4, the card shadow, Literata only', () => {
    expect(paper).toMatch(/--paper: #E4D8C2/)
    expect(paper).toMatch(/--p-ink: #2A211B/)
    const card = rule('html .panel.paper')
    expect(card).toMatch(/border-radius: 4px/)
    expect(card).toMatch(/box-shadow: 0 18px 40px rgba\(0, 0, 0, 0\.45\)/)
    expect(card).toMatch(/font-family: var\(--font-duck\)/)
    expect(card).toMatch(/backdrop-filter: none/)
    expect(rule('.panel.paper h2')).toMatch(/font: 600 28px\/1\.15 var\(--font-duck\)/)
  })
  it('desktop: hugged (height auto) at top/right 24, width clamp(380px, 32vw, 520px), gap above the note', () => {
    const card = rule('html .panel.paper')
    expect(card).toMatch(/height: auto/)
    expect(card).toMatch(/top: 24px/)
    expect(card).toMatch(/width: clamp\(380px, 32vw, 520px\)/)
    expect(rule('html.chat-note .panel.paper')).toMatch(/max-height: calc\(100dvh - 48px - var\(--note-h\) - 12px\)/)
  })
  it('#66 phone sheet: height auto, max-height 400px, scroll body flex 0 1 auto', () => {
    const phone = paper.slice(paper.indexOf('/* Phones: the half sheet'))
    const sheet = phone.slice(phone.indexOf('html .panel.paper {'), phone.indexOf('}', phone.indexOf('html .panel.paper {')))
    expect(sheet).toMatch(/height: auto/)
    expect(sheet).toMatch(/max-height: var\(--sheet-cap, 400px\)/)
    expect(rule('.panel.paper .panel-scroll')).toMatch(/flex: 0 1 auto/)
    expect(phone).toMatch(/width: 96px;\s*height: 44px/)
  })
  it('banned on paper: orange, italics, uppercase, glow/blur; links 44 px; 12 px fade', () => {
    const block = paper.slice(0, paper.indexOf('#60:'))
    expect(block).not.toMatch(/#f0b273|var\(--accent\)|font-style: italic|text-transform: uppercase|blur\(/i)
    expect(rule('.panel.paper a.lk')).toMatch(/min-height: 44px/)
    expect(rule('.panel.paper .btn-ink')).toMatch(/min-height: 48px/)
    expect(rule('.panel.paper .panel-fade')).toMatch(/height: 12px/)
  })
  it('0 CLS on open: the slide-in is a composited CSS transform, not a JS tween; off for reduced motion', () => {
    expect(paper).toMatch(/@keyframes panel-in-y \{ from \{ transform: translateY\(24px\); \} \}/)
    expect(paper).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ html \.panel\.paper \{ animation: none; \} \}/)
    const o = src('Overlay.tsx')
    expect(o.slice(o.indexOf('function Panel()'), o.indexOf('let fontsGate'))).not.toMatch(/gsap/)
  })
  it('Shuri #64: deep-linked rows keep 28 px above them', () => {
    expect(paper).toMatch(/\.panel\.paper \.proj,\s*\.panel\.paper \.skills li \{[^}]*scroll-margin-top: 28px/)
  })
})

describe('panel v2: markup (Loki copy)', () => {
  it('Projects: h2 is the title, one bio line, rule, a plain list; no carousel, numbers, ↗', () => {
    expect(stop('stop-1').title).toBe('Projects')
    const html = renderToStaticMarkup(<StopBody stop={stop('stop-1')} />)
    expect(html.match(/<p class="bio">/g)).toHaveLength(1)
    expect(html).toContain('<hr class="rule"/>')
    expect(html.match(/<li [^>]*class="proj/g)).toHaveLength(content.projects.length)
    expect(html).not.toMatch(/carousel|aria-live|↗|class="dot/)
    expect(html).toContain('<span class="sr-only"> (opens in a new tab)</span>')
    // @about.ai (the RAG sentence) is for the no-JS page only
    expect(html).not.toContain(content.about.ai)
  })
  it('a deep-linked project is highlighted', () => {
    const html = renderToStaticMarkup(<StopBody stop={stop('stop-1')} project={content.projects[2].slug} />)
    expect(html).toContain(`id="project-${content.projects[2].slug}" class="proj hl"`)
  })
  it('Contact: GitHub and LinkedIn only; the LinkedIn button, then the GitHub text link', () => {
    const html = renderToStaticMarkup(<StopBody stop={stop('stop-6')} />)
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])
    expect(hrefs).toEqual([content.contact.linkedin.url, content.contact.github.url])
    expect(html).toMatch(/class="btn-ink"[^>]*>Message me on LinkedIn/)
    expect(html).toContain('GitHub · roiyot26')
  })
  it('Stack: Claude Code first, styled like the rest; Career: plain ol + teaching line, no 📌', () => {
    const skills = renderToStaticMarkup(<StopBody stop={stop('stop-3')} />)
    expect(skills.indexOf(content.skills.featured.name)).toBeLessThan(skills.indexOf(content.skills.items[0].name))
    expect(skills).not.toMatch(/featured/)
    const career = renderToStaticMarkup(<StopBody stop={stop('stop-5')} />)
    expect(career).toContain('<ol class="career">')
    expect(career).toContain(`<p class="body teaching">${content.career.teaching.replace(/'/g, '&#x27;')}</p>`)
    expect(career).not.toContain('📌')
  })
  it('the panel shell: one exit "← chat", no kicker, no ×, no chevron, no joke line', () => {
    const o = src('Overlay.tsx')
    const panel = o.slice(o.indexOf('function Panel()'), o.indexOf('let fontsGate'))
    expect(panel).toContain('content.duck.backShort')
    expect(panel).not.toMatch(/panel-kicker|panel-close|scroll-more|className="joke"|tour\.close/)
    expect(content.duck.backShort).toBe('Chat')
  })
})

describe('Fury: the Icosahedron is cut, and the dry-joke note is gone', () => {
  it('no bonus panel, no sculpture target, no fifth What\'s here tick', () => {
    expect(content.bonus).toEqual([])
    expect(TARGET_DEFS.some((d) => d.id === 'bonus-sculpture')).toBe(false)
    expect(src('Guide.tsx')).not.toMatch(/sculpture/)
    expect((content.guide as Record<string, unknown>).sculpture).toBeUndefined()
  })
  it('content.json _note carries no "one dry joke per panel"', () => {
    expect(JSON.stringify(content)).not.toMatch(/dry joke|joke per panel/i)
    expect(content.stops.every((s) => !s.joke)).toBe(true)
  })
})

describe('#67: the note line is clamped from the start', () => {
  // A fake 2-line measure: ≤ 90 characters fit.
  const fits = (s: string) => s.length <= 90
  it('drops whole leading sentences and keeps the closing question', () => {
    const t = 'Roi builds web apps end to end. He has three projects on the monitor. All his code is on GitHub. Want to see both on the mug?'
    const out = headClamp(t, fits)
    expect(out.startsWith('…')).toBe(true)
    expect(out.endsWith('Want to see both on the mug?')).toBe(true)
    expect(out).toBe('…All his code is on GitHub. Want to see both on the mug?')
    // the longest whole-sentence tail that fits: one more sentence would not
    expect(fits('…He has three projects on the monitor. All his code is on GitHub. Want to see both on the mug?')).toBe(false)
  })
  it('a short line is untouched; a too-long last sentence is cut at a word boundary', () => {
    expect(headClamp('Quack. Hi.', fits)).toBe('Quack. Hi.')
    const long = `${'word '.repeat(40)}end?`
    const out = headClamp(long, fits)
    expect(out.startsWith('…word')).toBe(true)
    expect(out.endsWith('end?')).toBe(true)
    expect(fits(out)).toBe(true)
  })
  it('a URL inside a sentence is never split, and the result is an exact tail of the text', () => {
    const t = 'Roi is looking for work on products that use AI and on 3D for the web. LinkedIn is the fastest way to reach him: linkedin.com/in/roi-yotvat-874ba9209/. All his code is on GitHub. Want to see both on the mug?'
    const out = headClamp(t, (c) => c.length <= 140)
    expect(out).toBe('…LinkedIn is the fastest way to reach him: linkedin.com/in/roi-yotvat-874ba9209/. All his code is on GitHub. Want to see both on the mug?')
    expect(t.endsWith(out.slice(1))).toBe(true)
    expect(headClamp(t, (c) => c.length <= 80)).toBe('…All his code is on GitHub. Want to see both on the mug?')
  })
  it('sentences keep their punctuation', () => {
    expect(sentences('A b. C d? E!')).toEqual(['A b.', 'C d?', 'E!'])
  })
  it('the note line is a <button> named "Show the whole chat: {text}", ≥44 px, 2 px #ECE2D2 ring at offset 2', () => {
    const d = src('duck/DuckChat.tsx')
    expect(d).toMatch(/<button type="button" className="last"[^>]*aria-label=\{`\$\{content\.duck\.showWholeChat\}: \$\{shown\}`\}/)
    expect(content.duck.showWholeChat).toBe('Show the whole chat')
    const last = paper.slice(paper.indexOf('.chatnote .last {'))
    expect(last.slice(0, last.indexOf('}'))).toMatch(/min-height: 44px/)
    expect(paper).toMatch(/\.chatnote \.last:focus-visible \{ outline: 2px solid #ECE2D2; outline-offset: 2px; \}/)
    const note = rule('html .chat.docked.chatnote')
    expect(note).toMatch(/border-radius: 4px/)
    expect(note).toMatch(/box-shadow: inset 0 1px 0 #B08D57, 0 18px 40px rgba\(0, 0, 0, 0\.45\)/)
    expect(note).toMatch(/z-index: 44/)
    expect(+rule('html .panel.paper').match(/z-index: (\d+)/)![1]).toBeLessThan(44)
  })
})

describe('0 CLS on desktop: the note is its own element', () => {
  it('the note and the column carry different keys, so the column is replaced, not moved', () => {
    const d = src('duck/DuckChat.tsx')
    expect(d).toMatch(/<section key="note" ref=\{box\} className="chat docked chatnote"/)
    expect(d).toMatch(/<section\s+key="column"/)
  })
})

describe('#66: the camera frames for the measured sheet', () => {
  it('re-measure publishes only on a ≥2 px change (or a new station)', () => {
    expect(shouldPublish(null, 'stop-6', 466)).toBe(true)
    expect(shouldPublish({ id: 'stop-6', top: 466 }, 'stop-6', 467)).toBe(false)
    expect(shouldPublish({ id: 'stop-6', top: 466 }, 'stop-6', 468)).toBe(true)
    expect(shouldPublish({ id: 'stop-6', top: 466 }, 'stop-1', 466)).toBe(true)
  })
  it('the sheet observer skips drags and the full sheet, coalesces to one rAF, waits for fonts.ready', () => {
    const o = src('Overlay.tsx')
    const hook = o.slice(o.indexOf('function useSheetHeight'), o.indexOf('function useScrollMore'))
    expect(hook).toMatch(/sheetDrag\.active/)
    expect(hook).toMatch(/classList\.contains\('full'\)/)
    expect(hook).toMatch(/if \(!raf\) raf = requestAnimationFrame\(measure\)/)
    expect(hook).toMatch(/document\.fonts\?\.ready/)
  })
  it('no literal 400 for the sheet in the camera code', () => {
    for (const f of ['CameraRig.tsx', 'targets.ts']) for (const line of src(f).split('\n')) if (/\b400\b/.test(line)) expect(line, f).not.toMatch(/sheet|panel|cap/i)
  })
  it('portrait aim follows sheetFrac: a shorter sheet raises the look-at less', () => {
    const c = { position: new THREE.Vector3(1, 1.2, 1), target: new THREE.Vector3(0, 0.5, 0), hfov: 1.2 }
    const tall = poseFromStopCam(c as never, { width: 390, height: 844 }, (400 + 88) / 844)
    const short = poseFromStopCam(c as never, { width: 390, height: 844 }, (174 + 88) / 844)
    expect(tall.target.y).toBeLessThan(short.target.y)
  })
  it('Vision poses: stop-2 front pose, Contact and Now building from poses3', () => {
    expect(phoneBasePose('stop-6', 390)!.target.toArray()).toEqual([0.654, 0.479, 0.324])
    expect(phoneBasePose('aside-now-building', 360)!.target.toArray()).toEqual([0.151, 0.985, -0.123])
    expect(phoneBasePose('stop-2', 360)!.position.toArray()).toEqual([0.199, 1.117, 1.04])
    expect(Object.keys(PHONE_POSES).sort()).toEqual(['aside-now-building', 'stop-2', 'stop-6'])
  })
})

describe('#61 solver', () => {
  const W = 390
  const H = 844
  const base = { position: new THREE.Vector3(0, 1.5, 2), target: new THREE.Vector3(0, 0.8, 0), fov: 78 }
  const box = (cx: number, cy: number, cz: number, r = 0.08) => new THREE.Box3(new THREE.Vector3(cx - r, cy - r, cz - r), new THREE.Vector3(cx + r, cy + r, cz + r))
  it('a subject under the sheet is lifted into the free area by the aim step', () => {
    const subject = box(0, 0.45, 0)
    const sheetTop = 466
    expect(checkPortrait(base, subject, undefined, W, H, sheetTop).subject).toBe(false)
    const fit = fitPortrait(base, { subject }, W, H, sheetTop)
    expect(fit.fit.ok).toBe(true)
    expect(fit.fit.elev).toBe(0)
    expect(fit.fit.k).toBe(1)
    expect(checkPortrait(fit, subject, undefined, W, H, sheetTop).subject).toBe(true)
  })
  it('the duck is never sliced: above with 24 px, out of frame, or ≥24 px under the sheet', () => {
    const subject = box(0, 0.8, 0)
    const sheetTop = 500
    const fit = fitPortrait(base, { subject, duck: box(0.05, 0.66, 0.3) }, W, H, sheetTop)
    expect(fit.fit.ok).toBe(true)
    const c = checkPortrait(fit, subject, box(0.05, 0.66, 0.3), W, H, sheetTop)
    expect(['above', 'out', 'under']).toContain(c.duck)
  })
  it('a panel with no target only nudges the aim, within ±0.25', () => {
    const fit = fitPortrait(base, { duck: box(0, 0.62, 0.4) }, W, H, 520, { aimOnly: true })
    expect(Math.abs(fit.fit.s)).toBeLessThanOrEqual(0.25)
    expect(fit.position.toArray()).toEqual(base.position.toArray())
  })
})

describe('Shuri #65: the download stage at 100% never shows a stuck number', () => {
  it('download at progress 1: the line has no percent', () => {
    setUI({ entered: true, stage: 'download', progress: 1 })
    const html = renderToStaticMarkup(<Loader />)
    const line = html.match(/<p class="hero-wait-line[^"]*" aria-hidden="true">(.*?)<\/p>/)![1].replace(/<[^>]+>/g, '')
    expect(line).not.toMatch(/\d+%/)
    expect(src('Loader.tsx')).toContain("const counting = pct !== null && pct > 0 && !(stage === 'download' && progress >= 1)")
  })
})

describe('Vision v2.3.1 (a): per-station, per-width phone caps for the 0.46 frame limit', () => {
  it('stop-5 caps at 384 (390) and 368 (360), stop-2 at 384 (360); every other station keeps the CSS default', () => {
    expect(sheetCap('stop-5', 390)).toBe(384)
    expect(sheetCap('stop-5', 360)).toBe(368)
    expect(sheetCap('stop-2', 360)).toBe(384)
    expect(sheetCap('stop-2', 390)).toBeUndefined()
    for (const id of ['stop-1', 'stop-3', 'stop-4', 'stop-6', 'aside-now-building']) for (const w of [390, 360]) expect(sheetCap(id, w), `${id}@${w}`).toBeUndefined()
  })
  it('caps are 8 px steps down from 400 with a 360 floor', () => {
    for (const per of Object.values(SHEET_CAPS))
      for (const cap of Object.values(per)) {
        expect((400 - cap!) % CAP_STEP).toBe(0)
        expect(cap!).toBeGreaterThanOrEqual(CAP_FLOOR)
        expect(cap!).toBeLessThan(400)
      }
  })
  it('width buckets: under 375 px is the 360 phone', () => {
    expect(widthBucket(360)).toBe('360')
    expect(widthBucket(374)).toBe('360')
    expect(widthBucket(390)).toBe('390')
    expect(widthBucket(430)).toBe('390')
  })
  it('the panel passes the cap as --sheet-cap on phones only; the camera reads the computed max-height', () => {
    const o = src('Overlay.tsx')
    expect(o).toMatch(/const cap = phone \? sheetCap\(open\.id, window\.innerWidth\) : undefined/)
    expect(o).toMatch(/'--sheet-cap': `\$\{cap\}px`/)
    expect(src('CameraRig.tsx')).toMatch(/parseFloat\(cs\.maxHeight\)/)
  })
})

describe('Vision v2.3.1: the duck stays ≥24 px clear above the sheet (Monitor/Projects)', () => {
  const W = 390
  const H = 844
  const base = { position: new THREE.Vector3(0, 1.5, 2), target: new THREE.Vector3(0, 0.8, 0), fov: 78 }
  const duck = new THREE.Box3(new THREE.Vector3(-0.05, 0.62, 0.3), new THREE.Vector3(0.05, 0.72, 0.4))
  it('a duck 7 px above the sheet fails; the solver moves it to ≥24 px clear, out of frame or under', () => {
    const { projectBox } = targets
    const r = projectBox(duck, base, W, H) as { b: number }
    const sheetTop = Math.round(r.b + 7)
    expect(checkPortrait(base, undefined, duck, W, H, sheetTop).duck).toBe(false)
    const fit = fitPortrait(base, { duck }, W, H, sheetTop)
    expect(fit.fit.ok).toBe(true)
    const after = projectBox(duck, fit, W, H)
    const state = checkPortrait(fit, undefined, duck, W, H, sheetTop).duck
    expect(state).not.toBe(false)
    if (state === 'above') expect(sheetTop - (after as { b: number }).b).toBeGreaterThanOrEqual(24)
  })
})
