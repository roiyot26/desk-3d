import { describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { content } from '../src/content'
import { noscriptHtml } from '../src/content/static'
import raw from '../src/content/content.json'

vi.mock('../src/actions', () => ({ setLights: () => {}, setRain: () => {}, startAgentic: () => {} }))
vi.mock('../src/audio', () => ({ audio: { unlock: () => {} } }))
const { setUI } = await import('../src/store')
const { Loader } = await import('../src/Loader')
const { ListView } = await import('../src/ListView')
const { CvLink, Experience } = await import('../src/CvLink')
const { Linked, peekText } = await import('../src/duck/DuckChat')
const { ScriptedIntentEngine } = await import('../src/duck/engine')
const { CV_LIVE_URL, CV_URL } = await import('../src/links')
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
// cv/experience.json (outside the repo), as copied into content.cv.experience: years and roles.
const XP = [
  ['2026 – now', 'Full-stack developer'],
  ['2022 – 2026', 'Full-stack developer and coding instructor'],
  ['2021 – 2022', 'Full-stack developer bootcamp'],
]
const cvLinks = (html: string) => html.match(/<a class="cv-link[^"]*" href="([^"]+)"[^>]*>/g) ?? []

describe('cv-public: the PDF ships', () => {
  it('public/Roi-Yotvat-CV.pdf is the 1-page CV', () => {
    expect(existsSync('public/Roi-Yotvat-CV.pdf')).toBe(true)
    const pdf = readFileSync('public/Roi-Yotvat-CV.pdf')
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(statSync('public/Roi-Yotvat-CV.pdf').size).toBe(202026)
    expect(pdf.toString('latin1')).toMatch(/\/Count 1\b/)
    expect(CV_URL).toBe('/desk-3d/Roi-Yotvat-CV.pdf')
  })
  it('keeps the wording "full-stack developer, AI-driven development"', () => {
    expect(content.cv.headline).toBe('Full-stack developer, AI-driven development')
  })
})

describe('cv-public: Download CV link', () => {
  it('opens the PDF in a new tab, 44px tap target, file note for screen readers', () => {
    const html = renderToStaticMarkup(<CvLink />)
    expect(html).toContain(`href="${CV_URL}"`)
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('Download CV')
    expect(html).toMatch(/class="sr-only"> \(PDF, 1 page, opens in a new tab\)/)
    const rule = css.match(/\.cv-link \{([^}]*)\}/)![1]
    expect(rule).toMatch(/min-height: 44px/)
    expect(rule).toMatch(/display: inline-flex/)
  })
  it('is on the first card, and hides with the rest of the block on Enter', () => {
    setUI({ entered: false, stage: 'download', progress: 0.2 })
    const html = renderToStaticMarkup(<Loader />)
    expect(cvLinks(html).length).toBe(1)
    expect(html).toMatch(/class="cv-link hero-cv"/)
    expect(css).toMatch(/\.loader\.entered \.hero-cv \{ opacity: 0; visibility: hidden;/)
  })
  it('is in the Quick version (header and contact list)', () => {
    const html = renderToStaticMarkup(<ListView webglOk={false} fallback={false} />)
    expect(cvLinks(html).length).toBe(1)
    expect(html).toMatch(/CV: <a href="\/desk-3d\/Roi-Yotvat-CV\.pdf" target="_blank"/)
  })
  it('is in the Contact and Career panels', () => {
    const src = readFileSync('src/Overlay.tsx', 'utf8')
    const contact = src.slice(src.indexOf("case 'contact':"), src.indexOf('default:', src.indexOf("case 'contact':")))
    expect(contact).toMatch(/<CvLink \/>/)
    const career = src.slice(src.indexOf("case 'career':"), src.indexOf("case 'duck':"))
    expect(career).toMatch(/<Experience \/>/)
    expect(career).toMatch(/<CvLink \/>/)
  })
  it('is in the no-JS page', () => {
    expect(noscriptHtml(raw)).toContain('<a href="Roi-Yotvat-CV.pdf">Download CV (PDF)</a>')
  })
})

describe('cv-public: year-by-year experience', () => {
  it('matches experience.json (years, role, summary only)', () => {
    expect(content.cv.experience.map((x) => [x.years, x.role])).toEqual(XP)
    for (const x of content.cv.experience) expect(x.summary.length).toBeGreaterThan(40)
    for (const x of content.cv.experience) expect(Object.keys(x).sort()).toEqual(['role', 'summary', 'years'])
  })
  it('renders every year, newest first, in the Career panel block and the Quick version', () => {
    const block = renderToStaticMarkup(<Experience />)
    const years = [...block.matchAll(/<span class="xp-years">([^<]+)<\/span>/g)].map((m) => m[1])
    expect(years).toEqual(['2026 – now', '2022 – 2026', '2021 – 2022'])
    const list = renderToStaticMarkup(<ListView webglOk={false} fallback={false} />)
    expect(list).toMatch(/<h2 id="xp-h2">Experience<\/h2>/)
    for (const [, role] of XP) expect(list).toContain(role)
  })
  it('names no employer anywhere in the site copy', () => {
    const all = JSON.stringify(raw) + noscriptHtml(raw)
    for (const n of [/moveo/i, /misterbit/i, /coding academy/i]) expect(all).not.toMatch(n)
  })
})

describe('cv-public: the duck links the PDF', () => {
  const reply = content.duck.intents.find((i) => i.id === 'resume')!.reply
  it('the résumé answer carries the CV URL and still names Quick version where it is', () => {
    expect(reply).toContain(CV_LIVE_URL)
    expect(reply).toContain(content.site.quickWhere)
  })
  it('renders as a "Download CV (PDF)" link to this deploy, without the sentence\'s full stop', () => {
    const html = renderToStaticMarkup(<Linked text={reply} />)
    expect(html).toContain(`<a class="duck-cv" href="${CV_URL}" target="_blank" rel="noopener noreferrer">Download CV (PDF)</a>.`)
    expect(html).not.toContain('pdf.')
  })
  it('the phone peek row shows the link label, not the raw PDF address', () => {
    expect(peekText(reply)).toMatch(/^Here's the CV as a PDF: Download CV \(PDF\)\./)
    expect(peekText(reply)).not.toContain('https://')
  })
  it('other URLs keep working, with trailing punctuation left outside the link', () => {
    const html = renderToStaticMarkup(<Linked text="On LinkedIn: https://www.linkedin.com/in/roi-yotvat-874ba9209/." />)
    expect(html).toContain('href="https://www.linkedin.com/in/roi-yotvat-874ba9209/"')
    expect(html.endsWith('</a>.')).toBe(true)
  })
  it('"cv", "download your cv" and "resume" route to it, and the answer carries the PDF', async () => {
    const eng = new ScriptedIntentEngine()
    for (const q of ['cv', 'can I download your cv', 'resume']) {
      const a = await eng.ask(q)
      expect(a.intent, q).toBe('resume')
      expect(a.reply, q).toContain(CV_LIVE_URL)
    }
  })
})
