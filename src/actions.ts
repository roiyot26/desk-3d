import { audio } from './audio'
import { content } from './content'
import { findSecret, getUI, momentHeld, setUI, toast, type LightGroup } from './store'
import type { TargetAction } from './targets'

// Things in the room you can switch: lights, the rain, agentic mode. Used by click targets
// (switch / lamps / latch), by the duck's tools and by the keyboard easter egg.

const T = content.toasts
const TS = content.toastShort
type ToastKey = keyof typeof T & string
/** Toast by content key: full line on desktop, the short form in the merged phone toast. */
const say = (k: ToastKey) => toast(T[k], TS[k])
const AGENTIC_MS = 9000

function click() {
  audio.play('key', { rate: 0.55, gain: 0.7 })
}

export function setLights(group: LightGroup | 'all', on: boolean | 'toggle' = 'toggle') {
  const l = getUI().lights
  if (group === 'all') {
    const next = on === 'toggle' ? !(l.desk || l.floor || l.ambient) : on
    setUI({ lights: { desk: next, floor: next, ambient: next } })
    say(next ? 'lightsOn' : 'lightsOff')
  } else {
    const next = on === 'toggle' ? !l[group] : on
    setUI({ lights: { ...l, [group]: next } })
    if (group === 'desk') say(next ? 'deskOn' : 'deskOff')
    if (group === 'floor') say(next ? 'floorOn' : 'floorOff')
  }
  click()
  findSecret('switch')
}

export function setRain(on: boolean | 'toggle' = 'toggle') {
  const next = on === 'toggle' ? !getUI().rain : on
  setUI({ rain: next })
  say(next ? 'rainOn' : 'rainOff')
  click()
  findSecret('latch')
}

export function startAgentic() {
  setUI({ agenticUntil: performance.now() + (momentHeld() ? 10 * 60 * 1000 : AGENTIC_MS) })
  say('agentic')
  findSecret('claude')
  window.setTimeout(() => setUI({}), AGENTIC_MS + 50) // nudge subscribers (HUD / audio) when it ends
}

export function isAgentic() {
  return getUI().agenticUntil > performance.now()
}

export function blinkNeon() {
  setUI({ neonUntil: performance.now() + 1600 })
  say('neon')
  click()
  findSecret('neon')
}

/** Art from the real room: just a tiny caption, no panel. */
export function caption() {
  say('realRoom')
}

export function runAction(a: TargetAction) {
  if (a === 'neon') blinkNeon()
  else if (a === 'caption') caption()
  else if (a === 'lights-all') setLights('all')
  else if (a === 'lamp-desk') setLights('desk')
  else if (a === 'lamp-floor') setLights('floor')
  else if (a === 'rain') setRain()
}
