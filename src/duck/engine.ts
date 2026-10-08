import { content, type DuckIntent, type DuckTool } from '../content'

/**
 * Ask the Duck: the answer-engine interface. v1 is scripted (no model, no network): a fuzzy
 * intent matcher over the presets in content.json. A later engine (real LLM behind a server,
 * same tool whitelist) only has to implement `ask`.
 */
export type DuckStep = { text: string; tool?: DuckTool }
export type DuckAnswer = {
  question: string
  /** Matched preset id, null when nothing matched (fallback reply, no tools). */
  intent: string | null
  steps: DuckStep[]
  reply: string
  tools: DuckTool[]
}

export interface AnswerEngine {
  ask(question: string): Promise<DuckAnswer>
}

/** Tools the duck may call. Anything else in content.json is ignored (guardrail). */
export const TOOL_WHITELIST = new Set([
  'search_portfolio',
  'fly_to',
  'open',
  'show_contact',
  'quack',
  'set_mode',
  'set_lights',
  'set_weather',
  'set_audio',
])

const STOP = new Set('a an the i you your me my to of is are do does can could would what whats how why who where when it its in on for and or with about this that please tell show some any be'.split(' '))

export function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(s: string) {
  return normalize(s).split(' ').filter(Boolean)
}

/** Levenshtein distance with an early exit above `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      best = Math.min(best, cur[j])
    }
    if (best > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

function fuzzyEq(word: string, kw: string) {
  if (word === kw) return true
  if (kw.length >= 4 && word.length >= 4 && (word.startsWith(kw) || kw.startsWith(word))) return true
  const allowed = kw.length >= 7 ? 2 : kw.length >= 5 ? 1 : 0
  return allowed > 0 && editDistance(word, kw, allowed) <= allowed
}

/** Score of one preset for a question: keywords count most, then words shared with the chip. */
export function scoreIntent(q: string, intent: DuckIntent): number {
  const nq = ` ${normalize(q)} `
  const qt = tokens(q)
  let score = 0
  for (const kw of intent.keywords) {
    const nk = normalize(kw)
    if (!nk) continue
    if (nk.includes(' ')) {
      if (nq.includes(` ${nk} `)) score += 4
    } else if (qt.includes(nk)) score += 3
    else if (qt.some((w) => fuzzyEq(w, nk))) score += 2
  }
  if (intent.chip) {
    if (normalize(intent.chip) === normalize(q)) score += 10
    const ct = new Set(tokens(intent.chip).filter((w) => !STOP.has(w)))
    for (const w of new Set(qt)) if (!STOP.has(w) && ct.has(w)) score += 1
  }
  return score
}

export function formatTool(t: DuckTool): string {
  const args = t.args.map((a) => JSON.stringify(a)).join(', ')
  const n = t.sources?.length
  return `${t.name}(${args})${n !== undefined ? ` → ${n} source${n === 1 ? '' : 's'}` : ''}`
}

export class ScriptedIntentEngine implements AnswerEngine {
  constructor(
    private intents: DuckIntent[] = content.duck.intents,
    private threshold = 2,
  ) {}

  match(question: string): { intent: DuckIntent | null; score: number } {
    let best: DuckIntent | null = null
    let top = 0
    for (const it of this.intents) {
      const s = scoreIntent(question, it)
      if (s > top) {
        top = s
        best = it
      }
    }
    return top >= this.threshold ? { intent: best, score: top } : { intent: null, score: top }
  }

  async ask(question: string): Promise<DuckAnswer> {
    const q = question.trim().slice(0, 200)
    const { intent } = this.match(q)
    if (!intent) {
      const fb = content.duck.fallback
      return {
        question: q,
        intent: null,
        steps: fb.steps.map((s) => ({ text: s.replace('{q}', q.slice(0, 40)) })),
        reply: fb.reply,
        tools: [],
      }
    }
    const tools = intent.tools.filter((t) => TOOL_WHITELIST.has(t.name))
    return {
      question: q,
      intent: intent.id,
      steps: tools.map((t) => ({ text: formatTool(t), tool: t })),
      reply: intent.reply,
      tools,
    }
  }
}

export const duckEngine: AnswerEngine = new ScriptedIntentEngine()
