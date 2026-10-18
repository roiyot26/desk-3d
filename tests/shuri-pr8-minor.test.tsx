import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../src/audio', () => ({ audio: { unlock: () => {} } }))
const { setUI } = await import('../src/store')
const { Loader } = await import('../src/Loader')
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')

describe('Shuri #52 (carried into panel v2): focus rings on the paper panel are never clipped by its scroll box', () => {
  // The carousel card is gone (Vision v2.1). The ring is now the paper spec's 2 px ink outline with a
  // 2 px offset, so the scroll region needs ≥4 px of its own padding on each side to keep it whole.
  const paper = css.slice(css.indexOf('panel look v2.3'))
  it('2 px ink ring, 2 px offset, no orange on paper', () => {
    const rule = paper.match(/\.panel\.paper :is\(a, button\):focus-visible \{([^}]*)\}/)![1]
    expect(rule).toMatch(/outline: 2px solid var\(--p-ink\)/)
    expect(rule).toMatch(/outline-offset: 2px/)
    expect(paper.slice(0, paper.indexOf('#60:'))).not.toMatch(/#f0b273/i)
  })
  it('the scroll region pads ≥ ring + offset on both sides', () => {
    const rule = paper.match(/\.panel\.paper \.panel-scroll \{([^}]*)\}/)![1]
    const pad = +rule.match(/padding: 0 (\d+)px/)![1]
    const margin = +rule.match(/margin: 0 -(\d+)px/)![1]
    expect(pad).toBeGreaterThanOrEqual(4)
    expect(margin).toBe(pad) // the text column stays where the spec puts it
  })
})

describe('Shuri #53: the slow-load note never reads a frozen 0%', () => {
  const visible = (html: string) => html.match(/<p class="hero-wait-line[^"]*" aria-hidden="true">(.*?)<\/p>/)![1].replace(/<[^>]+>/g, '')
  const sr = (html: string) => html.match(/<span class="sr-only" role="status">([^<]*)<\/span>/)![1]

  it('progress 0: "unpacking the room…" with no number, plus the shimmer', () => {
    setUI({ entered: true, stage: 'download', progress: 0 })
    const html = renderToStaticMarkup(<Loader fallback />)
    expect(visible(html)).toBe('unpacking the room…')
    expect(html.slice(0, html.indexOf('class="loader')).match(/\d%/)).toBeNull()
    expect(html).toContain('hero-wait-line waiting')
    expect(html).toContain('<span class="hero-wait-shimmer"></span>')
  })
  it('real progress shows the number and drops the shimmer', () => {
    setUI({ entered: true, stage: 'download', progress: 0.3 })
    const html = renderToStaticMarkup(<Loader />)
    expect(visible(html)).toMatch(/^unpacking the room \d+%$/)
    expect(html).not.toContain('hero-wait-shimmer')
  })
  it('screen readers: one status per line text, unchanged as the percent moves', () => {
    const at = (progress: number) => { setUI({ entered: true, stage: 'download', progress }); return sr(renderToStaticMarkup(<Loader />)) }
    expect(at(0)).toBe('unpacking the room…')
    expect(at(0.2)).toBe('unpacking the room…')
    expect(at(0.5)).toBe('unpacking the room…')
    expect(at(0.7)).toBe('loading the plants…')
    // only one live region in the note; the visible line is aria-hidden
    setUI({ entered: true, stage: 'download', progress: 0.3 })
    const html = renderToStaticMarkup(<Loader />)
    expect(html.slice(0, html.indexOf('class="loader')).match(/role="status"|aria-live/g)).toHaveLength(1)
  })
  it('the shimmer is slow and off for reduced motion', () => {
    expect(css).toMatch(/\.hero-wait-shimmer::after \{[^}]*animation: hero-wait-shimmer 2\.4s/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.hero-wait-shimmer::after \{ animation: none; display: none; \} \}/)
  })
})
