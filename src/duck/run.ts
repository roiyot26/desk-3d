import { setLights, setRain, startAgentic } from '../actions'
import { audio } from '../audio'
import type { DuckTool } from '../content'
import { getUI, setMuted, setUI, type DuckCard, type DuckEntry, type Open } from '../store'
import { TARGET_DEFS, targetByKey } from '../targets'
import { content } from '../content'
import { duckEngine, type DuckStep } from './engine'

/**
 * Runs a duck answer: reveals the tool-call ticker step by step, performs each whitelisted tool
 * (beams to sources, lights, rain, mode, audio), then flies the camera and opens the panel.
 */
const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms))
let busy = false
let nextId = 1

export function quack() {
  setUI({ quackAt: performance.now() })
  audio.play('quack', { rate: 0.95 + Math.random() * 0.1, gain: 0.55 })
}

function patchEntry(id: number, p: Partial<DuckEntry>) {
  setUI((s) => ({ duckLog: s.duckLog.map((e) => (e.id === id ? { ...e, ...p } : e)) }))
}

const onOff = (v: string | undefined): boolean | 'toggle' => (v === 'on' ? true : v === 'off' ? false : 'toggle')

/**
 * Where fly_to / open lead. `open` wins (project slug or panel id); else fly_to's target panel.
 * A fly_to target that carries a skill (a book: `book-claude-code`) keeps it when it lands on
 * the same panel, so the stack panel highlights that skill and the camera frames that book.
 */
export function destination(flyTo?: string, open?: string): Open {
  const def = flyTo ? (targetByKey(getUI().targets, flyTo)?.def ?? TARGET_DEFS.find((d) => d.key === flyTo)) : undefined
  // Only a key that names the book itself carries its skill ("bookshelf" aliases to the marker book).
  const skill = def && def.key === flyTo ? def.skill : undefined
  if (open) {
    if (content.projects.some((p) => p.slug === open)) return { id: 'stop-1', project: open }
    if (content.stops.some((s) => s.id === open) || content.bonus.some((b) => b.id === open))
      return skill && def?.id === open ? { id: open, skill } : { id: open }
  }
  if (def && !def.id.startsWith('action-')) return skill ? { id: def.id, skill } : { id: def.id }
  return null
}

/** `fly_to("unvisited")` (the roam intent): the first station the visitor hasn't opened yet. */
const ROAM_ORDER = ['terrarium', 'laptop', 'bookshelf', 'career', 'sticky', 'mug', 'monitor']
export function pickUnvisited(visited: string[]): string {
  return ROAM_ORDER.find((k) => { const d = destination(k); return !!d && !visited.includes(d.id) }) ?? ROAM_ORDER[0]
}

function perform(t: DuckTool, nav: { flyTo?: string; open?: string }) {
  switch (t.name) {
    case 'search_portfolio':
    case 'show_contact':
      if (t.sources?.length) setUI({ sources: { keys: t.sources, at: performance.now() } })
      break
    case 'fly_to':
      nav.flyTo = t.args[0] === 'unvisited' ? pickUnvisited(getUI().visited) : t.args[0]
      break
    case 'open':
      nav.open = t.args[0]
      break
    case 'quack':
      quack()
      break
    case 'set_lights': {
      const g = t.args[0]
      setLights(g === 'desk' || g === 'floor' || g === 'ambient' ? g : 'all', onOff(t.args[1]))
      break
    }
    case 'set_weather':
      setRain(onOff(t.args[0]))
      break
    case 'set_mode':
      startAgentic()
      break
    case 'set_audio': {
      const on = onOff(t.args[0])
      const next = on === 'toggle' ? !getUI().music || getUI().muted : on
      audio.unlock()
      setUI({ music: next })
      if (next) setMuted(false)
      break
    }
  }
}

/** Test hook: with `?debug`, `window.__desk3dHoldDuck = true` pauses before the camera flies. */
async function hold() {
  const w = window as unknown as { __desk3dHoldDuck?: boolean }
  while (w.__desk3dHoldDuck) await sleep(200)
}

/** Test hook: with `?debug`, `window.__desk3dHoldTicker = n` freezes the ticker on step n (stills). */
async function holdTicker(k: number) {
  const w = window as unknown as { __desk3dHoldTicker?: number }
  while (w.__desk3dHoldTicker === k) await sleep(100)
}

/** Navigation calls: shown in the ticker, but the camera only moves on "Take me there". */
const NAV_TOOLS = new Set(['fly_to', 'open'])

/** Panel ids read as their deep-link words in the ticker ("open projects", not "open stop-1"). */
const OPEN_WORD: Record<string, string> = { 'stop-1': 'projects', 'stop-2': '3d', 'stop-3': 'stack', 'stop-4': 'garden', 'stop-5': 'career', 'stop-6': 'contact', 'stop-7': 'duck' }

/**
 * One quiet ticker step (Vision recruiter look §2): "search_portfolio", "fly_to monitor",
 * "open projects". Sans, not the old mono `name("arg") → n sources` line.
 */
export function tickerLabel(step: DuckStep): string {
  const t = step.tool
  if (!t) return step.text.split('(')[0]
  if (t.name === 'search_portfolio') return t.name
  if (t.name === 'open') return `open ${OPEN_WORD[t.args[0]] ?? t.args[0].replace(/^aside-/, '')}`
  if (t.name === 'fly_to' && t.args[0] === 'unvisited') return 'fly_to next'
  return [t.name, ...t.args].join(' ')
}

export async function askDuck(question: string) {
  const q = question.trim()
  if (busy || !q) return
  busy = true
  let id = -1
  try {
    id = nextId++
    setUI((s) => ({
      duckLog: [...s.duckLog.filter((e) => e.greet), ...s.duckLog.filter((e) => !e.greet).slice(-5), { id, question: q, steps: [], shown: 0, reply: null, matched: true }],
      duckThinking: true,
      duckPointing: null,
    }))
    const w = window as unknown as { __desk3dFailDuck?: boolean }
    if (w.__desk3dFailDuck) throw new Error('test: duck failure')
    const answer = await duckEngine.ask(q)
    const steps = answer.steps.map(tickerLabel)
    patchEntry(id, { question: answer.question, steps, matched: !!answer.intent })
    quack()
    await sleep(400)
    const nav: { flyTo?: string; open?: string } = {}
    let k = 0
    for (const step of answer.steps) {
      const tool = step.tool
      if (tool) perform(tool, nav)
      patchEntry(id, { shown: ++k })
      await holdTicker(k)
      await sleep(tool?.sources?.length ? 1000 : tool && NAV_TOOLS.has(tool.name) ? 450 : 600)
    }
    patchEntry(id, { shown: steps.length + 1, reply: answer.reply })
    setUI({ duckThinking: false })
    const dest = destination(nav.flyTo, nav.open)
    // The duck doesn't drag you along: it posts a station card ("Take me there") in the chat.
    if (dest && dest.id !== 'stop-7') {
      await hold()
      const card = cardFor(dest)
      if (card) {
        patchEntry(id, { card })
        setUI({ duckPointing: card.label.toLowerCase(), duckPointed: true })
      }
    }
    if (!getUI().chatOpen) setUI({ chatUnread: true })
  } catch (err) {
    console.info('[desk-3d] duck answer failed', err)
    if (id >= 0) patchEntry(id, { reply: content.duck.error, matched: false, error: q, shown: 0, steps: [] })
    if (!getUI().chatOpen) setUI({ chatUnread: true })
  } finally {
    busy = false
    if (getUI().duckThinking) setUI({ duckThinking: false })
  }
}

/** Card for a station / project / bonus panel the duck is pointing at. */
export function cardFor(o: NonNullable<Open>): DuckCard | null {
  const stop = content.stops.find((x) => x.id === o.id)
  const note = stop ? undefined : content.bonus.find((b) => b.id === o.id) ?? content.asides.find((a) => a.id === o.id)
  const proj = o.project ? content.projects.find((p) => p.slug === o.project) : undefined
  // Cards name the object the way its label and What's here row do ("Projects"), not the panel headline.
  const label = content.guide.rows.find((r) => r.id === o.id)?.label
  const title = proj?.name ?? label ?? stop?.title ?? note?.title
  if (!title) return null
  return { open: o, title, label: (stop?.label ?? note?.title ?? title).split(' · ')[0] }
}

export function duckBusy() {
  return busy
}
