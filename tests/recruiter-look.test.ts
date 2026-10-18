import { describe, expect, it, vi } from 'vitest'
import { content } from '../src/content'

// run.ts pulls in the scene modules; the ticker label is pure, so stub the heavy imports.
vi.mock('../src/actions', () => ({ setLights: () => {}, setRain: () => {}, startAgentic: () => {} }))
vi.mock('../src/audio', () => ({ audio: {} }))
vi.mock('../src/targets', () => ({ TARGET_DEFS: [], targetByKey: () => undefined }))
const { tickerLabel, cardFor } = await import('../src/duck/run')

describe('B1: tool ticker labels (Vision §2, sans, not the mono call syntax)', () => {
  const by = Object.fromEntries(content.duck.intents.map((i) => [i.id, i]))
  const line = (id: string) => by[id].tools.map((t) => tickerLabel({ text: '', tool: t })).join(' · ')
  it('reads like the spec example', () => {
    expect(line('hire-for')).toBe('search_portfolio · fly_to monitor · open projects')
    expect(line('build-with-ai')).toBe('search_portfolio · fly_to book-claude-code · open stack')
    expect(line('3d-web')).toBe('fly_to laptop · open 3d')
  })
  it('never uses the old mono syntax', () => {
    for (const i of content.duck.intents)
      for (const t of i.tools) expect(tickerLabel({ text: '', tool: t }), i.id).not.toMatch(/[()"→]/)
    expect(tickerLabel({ text: 'search_portfolio("x") → 0 sources' })).toBe('search_portfolio')
  })
})

describe("B1: first screen and What's here copy", () => {
  it('first screen copy is the brief', () => {
    expect(content.hero.headline).toBe("Roi Yotvat's portfolio")
    expect(content.hero.sub).toBe("I'm a full-stack developer working in AI-driven development. Now I'm adding 3D for the web, and this room is a sample of it.")
    expect(content.hero.enter).toBe('Enter the room')
    expect(content.site.resume).toBe('Quick version (1 page)')
  })
  it("What's here lists the eight objects in label priority order, with no count or score", () => {
    expect(content.guide.rows.map((r) => r.label)).toEqual(['Ask the duck', 'Projects', '3D for the web', 'Stack', 'Contact', 'Career', 'Virtual Garden', 'Now building'])
    const { _note, ...shown } = content.guide as typeof content.guide & { _note?: string }
    void _note
    const all = JSON.stringify(shown)
    expect(all).not.toMatch(/\d+\s*\/\s*\d+|score|progress|found/i)
    expect(content.guide.alsoItems).toHaveLength(4)
  })
  it('the menu label has no "features" word', () => expect(content.site.more).not.toMatch(/feature/i))
})

describe('B1 fixes (Shuri #7)', () => {
  it('station cards use the object label, not the panel headline', () => {
    expect(cardFor({ id: 'stop-1' })?.title).toBe('Projects')
    expect(cardFor({ id: 'stop-2' })?.title).toBe('3D for the web')
    expect(cardFor({ id: 'stop-3', skill: 'claude-code' })?.title).toBe('Stack')
    // A specific project keeps its own name.
    expect(cardFor({ id: 'stop-1', project: content.projects[0].slug })?.title).toBe(content.projects[0].name)
  })
  it('the hire answer points at "Projects"', () => {
    const hire = content.duck.intents.find((i) => i.id === 'hire-for')!
    expect(hire.tools.find((t) => t.name === 'open')?.args).toEqual(['stop-1'])
    expect(cardFor({ id: 'stop-1' })?.title).toBe(content.guide.rows.find((r) => r.id === 'stop-1')?.label)
  })
  it('Enter says it turns on sound (mute is hidden before Enter)', () => expect(content.hero.enterHint).toBe('Turns on sound'))
  it('the collapsed tool line has a spoken label', () => {
    expect(content.duck.showSteps.replace('{n}', '3')).toBe('Show 3 steps')
    expect(content.duck.hideSteps).toBeTruthy()
  })
})
