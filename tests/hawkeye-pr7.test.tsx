import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { content } from '../src/content'

vi.mock('../src/actions', () => ({ setLights: () => {}, setRain: () => {}, startAgentic: () => {} }))
vi.mock('../src/audio', () => ({ audio: { unlock: () => {} } }))
vi.mock('../src/targets', () => ({ TARGET_DEFS: [], targetByKey: () => undefined }))
const { placeReply } = await import('../src/duck/run')
const { setUI } = await import('../src/store')
const { Loader } = await import('../src/Loader')
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')

describe('Hawkeye #7 F1/F3: the ⋯ fold', () => {
  it('folds under 430px only (429.98px), never at 430', () => {
    expect(css).not.toMatch(/max-width:\s*430px/)
    expect(css).toMatch(/@media \(max-width: 429\.98px\) \{\s*\.hud-more \{ display: inline-flex/)
  })
  it('⋯ is a 44×44 target in the narrow block', () => {
    const block = css.slice(css.indexOf('@media (max-width: 429.98px)'))
    expect(block.slice(0, block.indexOf('\n}'))).toMatch(/\.hud-btn\.icon\.hud-more \{ width: 44px; height: 44px; min-height: 44px; \}/)
  })
})

describe('Hawkeye #7 F2: the "3 steps" toggle never overlaps the next answer', () => {
  it('44px box, negative margins no larger than the 12px turn gap', () => {
    const rule = css.slice(css.indexOf('.duck-ticker.toggle {'), css.indexOf('}', css.indexOf('.duck-ticker.toggle {')))
    expect(rule).toMatch(/min-height: 44px/)
    const m = rule.match(/margin: (-?\d+)px 0 (-?\d+)px/)!
    expect(+m[1]).toBeGreaterThanOrEqual(-12)
    expect(+m[2]).toBeGreaterThanOrEqual(-12)
    expect(css).toMatch(/\.chat \.duck-turn \{ display: flex; flex-direction: column; gap: 12px;/)
  })
})

describe('Hawkeye #7 WARN-4 / Fury: the résumé answer says where Quick version is', () => {
  const reply = content.duck.intents.find((i) => i.id === 'resume')!.reply
  it('desktop keeps "top-right corner"', () => {
    expect(placeReply(reply, false)).toContain('Hit Quick version (1 page) in the top-right corner.')
  })
  it('phones (folded HUD) say "Quick version in the ⋯ menu"', () => {
    const r = placeReply(reply, true)
    expect(r).toContain('Hit Quick version in the ⋯ menu.')
    expect(r).not.toContain('top-right')
  })
  it('other replies are untouched', () => {
    for (const i of content.duck.intents.filter((x) => x.id !== 'resume')) expect(placeReply(i.reply, true)).toBe(i.reply)
  })
})

describe('Hawkeye #7 WARN-1: after Enter on a slow load', () => {
  it('fallback (room code still loading): quiet note plus Quick version', () => {
    setUI({ entered: true, stage: 'download', progress: 0 })
    const html = renderToStaticMarkup(<Loader fallback />)
    expect(html).toMatch(/<div class="hero-wait"><span class="sr-only" role="status">[^<]+<\/span><p class="hero-wait-line[^"]*" aria-hidden="true">.+?<\/p><a class="hero-wait-link" href="[^"]*view=list[^"]*">Quick version \(1 page\)<\/a><\/div>/)
  })
  it('room code loaded, room still loading: the note only (the HUD has Quick version)', () => {
    setUI({ entered: true, stage: 'compile' })
    const html = renderToStaticMarkup(<Loader />)
    expect(html).toContain('class="hero-wait"')
    expect(html).not.toContain('hero-wait-link')
  })
  it('gone the moment the room is ready', () => {
    setUI({ entered: true, stage: 'ready' })
    expect(renderToStaticMarkup(<Loader fallback />)).not.toContain('hero-wait')
  })
  it('never before Enter', () => {
    setUI({ entered: false, stage: 'download' })
    expect(renderToStaticMarkup(<Loader fallback />)).not.toContain('hero-wait')
  })
})
