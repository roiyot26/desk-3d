import { setLights, setRain, startAgentic } from '../actions'
import { audio } from '../audio'
import type { DuckTool } from '../content'
import { findSecret, getUI, setMuted, setUI, type DuckCard, type DuckEntry, type Open } from '../store'
import { TARGET_DEFS, targetByKey } from '../targets'
import { content } from '../content'
import { duckEngine } from './engine'

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

/** Where fly_to / open lead. `open` wins (project slug or panel id); else fly_to's target panel. */
export function destination(flyTo?: string, open?: string): Open {
  if (open) {
    if (content.projects.some((p) => p.slug === open)) return { id: 'stop-1', project: open }
    if (content.stops.some((s) => s.id === open) || content.bonus.some((b) => b.id === open)) return { id: open }
  }
  if (flyTo) {
    const t = targetByKey(getUI().targets, flyTo)
    const id = t?.id ?? TARGET_DEFS.find((d) => d.key === flyTo)?.id
    if (id && !id.startsWith('action-')) return { id }
  }
  return null
}

function perform(t: DuckTool, nav: { flyTo?: string; open?: string }) {
  switch (t.name) {
    case 'search_portfolio':
    case 'show_contact':
      if (t.sources?.length) setUI({ sources: { keys: t.sources, at: performance.now() } })
      break
    case 'fly_to':
      nav.flyTo = t.args[0]
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

/** Ticker lines the visitor sees: navigation calls (fly_to / open) only happen on "Take me there". */
const NAV_TOOLS = new Set(['fly_to', 'open'])

export async function askDuck(question: string) {
  const q = question.trim()
  if (busy || !q) return
  busy = true
  let id = -1
  try {
    findSecret('duck')
    id = nextId++
    setUI((s) => ({
      duckLog: [...s.duckLog.filter((e) => e.greet), ...s.duckLog.filter((e) => !e.greet).slice(-5), { id, question: q, steps: [], shown: 0, reply: null, matched: true }],
      duckThinking: true,
      duckPointing: null,
    }))
    const w = window as unknown as { __desk3dFailDuck?: boolean }
    if (w.__desk3dFailDuck) throw new Error('test: duck failure')
    const answer = await duckEngine.ask(q)
    const shown = answer.steps.filter((x) => !(x.tool && NAV_TOOLS.has(x.tool.name)))
    patchEntry(id, { question: answer.question, steps: shown.map((x) => x.text), matched: !!answer.intent })
    quack()
    await sleep(500)
    const nav: { flyTo?: string; open?: string } = {}
    let k = 0
    for (const step of answer.steps) {
      const tool = step.tool
      if (tool) perform(tool, nav)
      if (tool && NAV_TOOLS.has(tool.name)) continue
      patchEntry(id, { shown: ++k })
      await sleep(tool?.sources?.length ? 1100 : 650)
    }
    patchEntry(id, { shown: shown.length + 1, reply: answer.reply })
    setUI({ duckThinking: false })
    const dest = destination(nav.flyTo, nav.open)
    // The duck doesn't drag you along: it posts a station card ("Take me there") in the chat.
    if (dest && dest.id !== 'stop-7') {
      await hold()
      const card = cardFor(dest)
      if (card) {
        patchEntry(id, { card })
        setUI({ duckPointing: card.label.toLowerCase() })
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
  const title = proj?.name ?? stop?.title ?? note?.title
  if (!title) return null
  return { open: o, title, label: (stop?.label ?? note?.title ?? title).split(' · ')[0] }
}

export function duckBusy() {
  return busy
}
