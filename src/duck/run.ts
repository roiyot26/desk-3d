import { setLights, setRain, startAgentic } from '../actions'
import { audio } from '../audio'
import type { DuckTool } from '../content'
import { openPanel } from '../nav'
import { findSecret, getUI, momentHeld, setMuted, setUI, type DuckEntry, type Open } from '../store'
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

export async function askDuck(question: string) {
  const q = question.trim()
  if (busy || !q) return
  busy = true
  try {
    findSecret('duck')
    const answer = await duckEngine.ask(q)
    const id = nextId++
    setUI((s) => ({
      duckLog: [...s.duckLog.slice(-5), { id, question: answer.question, steps: answer.steps.map((x) => x.text), shown: 0, reply: null, matched: !!answer.intent }],
      duckThinking: true,
    }))
    quack()
    await sleep(500)
    const nav: { flyTo?: string; open?: string } = {}
    for (let i = 0; i < answer.steps.length; i++) {
      patchEntry(id, { shown: i + 1 })
      const tool = answer.steps[i].tool
      if (tool) perform(tool, nav)
      await sleep(tool?.sources?.length ? 1100 : 650)
    }
    patchEntry(id, { shown: answer.steps.length + 1, reply: answer.reply })
    setUI({ duckThinking: false })
    const dest = destination(nav.flyTo, nav.open)
    // The source cues (thin line + ring) fade on their own ~1.5s after they appear (DuckRig.tsx).
    if (dest) {
      await sleep(1800)
      await hold()
      setUI({ duckReply: { question: answer.question, reply: answer.reply, at: performance.now() } })
      openPanel(dest)
    }
    // Drop the finished cues so nothing lingers in the scene (they have faded out by now).
    const cued = getUI().sources.at
    window.setTimeout(() => {
      if (getUI().sources.at === cued && !momentHeld()) setUI({ sources: { keys: [], at: 0 } })
    }, 1600)
  } finally {
    busy = false
    if (getUI().duckThinking) setUI({ duckThinking: false })
  }
}

export function duckBusy() {
  return busy
}
