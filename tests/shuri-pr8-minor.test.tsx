import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../src/audio', () => ({ audio: { unlock: () => {} } }))
const { setUI } = await import('../src/store')
const { Loader } = await import('../src/Loader')
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')

describe('Shuri #52: the project card focus ring is inset, so .panel-body cannot clip it', () => {
  it('inset box-shadow ring, no outset outline', () => {
    const rule = css.match(/\.carousel \.card:focus-visible \{([^}]*)\}/)![1]
    expect(rule).toMatch(/box-shadow: inset 0 0 0 2px #f0b273/)
    expect(rule).toMatch(/outline: none/)
    expect(rule).not.toMatch(/outline-offset: [1-9]/)
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
    expect(at(0.7)).toBe('watering the plants…')
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
