import { describe, expect, it } from 'vitest'
import { content } from '../src/content'
import { ScriptedIntentEngine, scoreIntent } from '../src/duck/engine'

// Loki's duck intents v2 test list (docs/duck-intents-v2.md §3), run against the real engine.ts.
const CASES: [string, string][] = [
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
  it('has 33 intents with unique ids', () => {
    expect(content.duck.intents).toHaveLength(33)
    expect(new Set(Object.keys(byId)).size).toBe(33)
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
  it('chips include Who is Roi? and What are you building now?', () => {
    expect(content.duck.chips).toEqual(expect.arrayContaining(['about-roi', 'now-building']))
    expect(byId['about-roi'].chip).toBe('Who is Roi?')
    expect(byId['now-building'].chip).toBe('What are you building now?')
    for (const id of content.duck.chips) expect(byId[id], id).toBeDefined()
  })
  it("station replies ask 'Want to see …?' instead of announcing a flight", () => {
    for (const i of content.duck.intents) {
      if (!i.tools.some((t) => t.name === 'fly_to' || t.name === 'open')) continue
      expect(i.reply, i.id).toMatch(/Want to see [^?]*\?$/)
      expect(i.reply, i.id).not.toMatch(/Flying you|Opening it|I'll put/)
    }
  })
  it('room-features lists the same six features as the counter', () => {
    expect(byId['room-features'].reply).toMatch(/^Six things/)
    expect(byId['room-features'].reply).toMatch(/6\) Visit every station/)
    expect(byId['room-features'].reply).not.toMatch(/tour|secret|dots/i)
    expect(content.secrets.items).toHaveLength(6)
  })
})
