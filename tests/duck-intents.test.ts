import { describe, expect, it } from 'vitest'
import { content } from '../src/content'
import { ScriptedIntentEngine, scoreIntent } from '../src/duck/engine'

// Loki's duck intents v2 test list (docs/duck-intents-v2.md §3), run against the real engine.ts,
// plus the recruiter concept's three opening chips (docs/recruiter-concept-brief.md).
const CASES: [string, string][] = [
  ["What would I hire Roi for?", "hire-for"],
  ["why should I hire roi", "hire-for"],
  ["Show me how he builds with AI", "build-with-ai"],
  ["what's his ai workflow", "build-with-ai"],
  ["Show me 3D for the web", "3d-web"],
  ["Show me your best AI project", "best-ai"],
  ["what are embeddings good for", "best-ai"],
  ["what's your stack", "stack"],
  ["do you know raect", "stack"],
  ["can you add 3d to my website", "3d"],
  ["how do I hire you", "hire"],
  ["are you open to work", "hire"],
  ["why a duck", "why-duck"],
  ["what have you built", "projects"],
  ["tell me about the plant", "garden"],
  ["what is your background", "career"],
  ["do you use claude code", "claude"],
  ["turn the lights off", "lights"],
  ["make it stop raining", "rain"],
  ["my code has a bug", "bug"],
  ["play some music", "music"],
  ["how old are you", "personal"],
  ["who is roi", "about-roi"],
  ["how does retrieval tracer work", "retrieval-tracer"],
  ["the chord wheel thing", "chord-cycle"],
  ["how was this room built", "this-room"],
  ["do you use blender", "blender"],
  ["is it fast on mobile", "performance"],
  ["what is rag over mcp", "rag-mcp"],
  ["what are you building now", "now-building"],
  ["do you teach", "teaching"],
  ["can I get your cv", "resume"],
  ["where is the source code", "github"],
  ["give me a tour", "roam"],
  ["where should I go next", "roam"],
  ["I want to explore", "roam"],
  ["what next", "roam"],
  ["lets go", "roam"],
  ["do you use next js", "stack"],
  ["what are you building next", "now-building"],
  ["any easter eggs", "room-features"],
  ["what can I do here", "room-features"],
  ["what's interactive", "room-features"],
  ["show me some tricks", "room-features"],
  ["list the features", "room-features"],
  ["any secrets", "room-features"],
  ["what's that neon sign", "neon"],
  ["turn on the desk lamp", "desk-lamp"],
  ["floor lamp please", "floor-lamp"],
  ["make it rain", "rain-on"],
  ["mute the music", "mute"],
  ["hello", "hello"],
  ["whats your email", "hire"],
  ["rain", "rain"],
  ["music", "music"],
  ["lights", "lights"],
  ["show me the chords", "chord-cycle"],
  ["hi duck", "hello"],
  ["what are you working on", "now-building"],
  ["rag", "rag-mcp"],
  ["what is the score in the garden", "garden"],
]

const engine = new ScriptedIntentEngine()

describe('duck intents v2: phrase → intent', () => {
  it.each(CASES)('%s → %s', async (q, want) => {
    expect((await engine.ask(q)).intent).toBe(want)
  })
})

describe('duck intents v2: content rules', () => {
  const byId = Object.fromEntries(content.duck.intents.map((i) => [i.id, i]))
  it('has 36 intents with unique ids', () => {
    expect(content.duck.intents).toHaveLength(36)
    expect(new Set(Object.keys(byId)).size).toBe(36)
  })
  it("keeps 'rag' out of best-ai", () => expect(byId['best-ai'].keywords).not.toContain('rag'))
  it("lights has no bare 'on'/'off' keywords", () => {
    expect(byId.lights.keywords).not.toContain('on')
    expect(byId.lights.keywords).not.toContain('off')
  })
  it("bare 'on'/'off' would hijack questions (why they were dropped)", () => {
    const withOnOff = { ...byId.lights, keywords: [...byId.lights.keywords, 'on', 'off'] }
    const hijack = new ScriptedIntentEngine(content.duck.intents.map((i) => (i.id === 'lights' ? withOnOff : i)))
    // With them, these off-topic questions would silently toggle the room lights; without, they get the fallback.
    for (const q of ['tell me more on that', 'carry on', 'what runs on the monitor', 'take a day off']) {
      expect(hijack.match(q).intent?.id, q).toBe('lights')
      expect(engine.match(q).intent, q).toBeNull()
    }
    expect(scoreIntent('carry on', withOnOff)).toBeGreaterThan(scoreIntent('carry on', byId.lights))
  })
  it('chips are sentence case and include Who is Roi? and What are you building now?', () => {
    expect(content.duck.chips).toEqual(expect.arrayContaining(['about-roi', 'now-building']))
    expect(byId['about-roi'].chip).toBe('Who is Roi?')
    expect(byId['now-building'].chip).toBe('What are you building now?')
    for (const id of content.duck.chips) {
      expect(byId[id], id).toBeDefined()
      expect(byId[id].chip[0], id).toMatch(/[A-Z0-9]/)
    }
  })
  // The three opening chips' replies are verbatim from the recruiter brief.
  const BRIEF = new Set(['hire-for', 'build-with-ai', '3d-web'])
  it("station replies ask 'Want to see …?' instead of announcing a flight", () => {
    for (const i of content.duck.intents) {
      if (BRIEF.has(i.id)) continue
      if (!i.tools.some((t) => t.name === 'fly_to' || t.name === 'open')) continue
      expect(i.reply, i.id).toMatch(/Want to see [^?]*\?$/)
      expect(i.reply, i.id).not.toMatch(/Flying you|Opening it|I'll put/)
    }
  })
  it('room-features lists the room without numbers or a counter', () => {
    const r = byId['room-features'].reply
    expect(r).not.toMatch(/\d(?!D)/) // no counts ("3D" is a name, not a number)
    expect(r).not.toMatch(/counter|tour|secret|dots|visit every/i)
    expect(r).toMatch(/Also in the room/)
    expect(content).not.toHaveProperty('secrets')
  })
  it('greeting is short, states the role, and offers the three brief chips', () => {
    const g = content.duck.greet.line
    expect(g.length).toBeLessThanOrEqual(160)
    expect(g).toMatch(/^Quack\. Roi Yotvat is a full-stack developer/)
    // The three-project pitch lives in the hire answer now (Shuri PR #6 fix 2).
    expect(byId['hire-for'].reply).toMatch(/Chrome extension that grows a garden/)
    expect(byId['hire-for'].reply).toMatch(/retrieval tracer/)
    expect(byId['hire-for'].reply).toMatch(/chord wheel/)
    // B1 ships the tool ticker, so the brief's line is back.
    expect(byId['build-with-ai'].reply).toMatch(/Watch the ticker\.$/)
    expect(content.duck.greet.chips.map((c) => c.label)).toEqual(['What would I hire Roi for?', 'Show me how he builds with AI', 'Show me 3D for the web'])
  })
  it('opening chips run the brief tools', () => {
    expect(byId['hire-for'].tools.find((t) => t.name === 'open')?.args).toEqual(['stop-1'])
    expect(byId['build-with-ai'].tools.find((t) => t.name === 'fly_to')?.args).toEqual(['book-claude-code'])
    expect(byId['3d-web'].tools.find((t) => t.name === 'open')?.args).toEqual(['stop-2'])
  })
  it('LinkedIn is the new profile URL, and the duck links it', () => {
    const LI = 'https://www.linkedin.com/in/roi-yotvat-874ba9209/'
    expect(content.contact.linkedin.url).toBe(LI)
    expect(JSON.stringify(content)).not.toMatch(/linkedin\.com\/in\/roi-yotvat(?!-874ba9209)/)
    for (const i of content.duck.intents) if (/LinkedIn/.test(i.reply)) expect(i.reply, i.id).toContain(LI)
  })
  it('panel kickers drop the "Stop n ·" prefix', () => {
    for (const s of content.stops) expect(s.kicker, s.id).not.toMatch(/^Stop \d/)
  })
})
