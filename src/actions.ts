import { audio } from './audio'
import { content } from './content'
import { findSecret, getUI, setUI, toast, type LightGroup } from './store'
import type { TargetAction } from './targets'

// Things in the room you can switch: lights, the rain, agentic mode. Used by click targets
// (switch / lamps / latch), by the duck's tools and by the keyboard easter egg.

const T = content.toasts
const AGENTIC_MS = 9000

function click() {
  audio.play('key', { rate: 0.55, gain: 0.7 })
}

export function setLights(group: LightGroup | 'all', on: boolean | 'toggle' = 'toggle') {
  const l = getUI().lights
  if (group === 'all') {
    const next = on === 'toggle' ? !(l.desk || l.floor || l.ambient) : on
    setUI({ lights: { desk: next, floor: next, ambient: next } })
    toast(next ? T.lightsOn : T.lightsOff)
  } else {
    const next = on === 'toggle' ? !l[group] : on
    setUI({ lights: { ...l, [group]: next } })
    if (group === 'desk') toast(next ? T.deskOn : T.deskOff)
    if (group === 'floor') toast(next ? T.floorOn : T.floorOff)
  }
  click()
  findSecret('switch')
}

export function setRain(on: boolean | 'toggle' = 'toggle') {
  const next = on === 'toggle' ? !getUI().rain : on
  setUI({ rain: next })
  toast(next ? T.rainOn : T.rainOff)
  click()
  findSecret('latch')
}

export function startAgentic() {
  setUI({ agenticUntil: performance.now() + AGENTIC_MS })
  toast(T.agentic)
  findSecret('claude')
  window.setTimeout(() => setUI({}), AGENTIC_MS + 50) // nudge subscribers (HUD / audio) when it ends
}

export function isAgentic() {
  return getUI().agenticUntil > performance.now()
}

export function blinkNeon() {
  setUI({ neonUntil: performance.now() + 1600 })
  toast(T.neon)
  click()
  findSecret('neon')
}

/** Art from the real room: just a tiny caption, no panel. */
export function caption() {
  toast(T.realRoom)
}

export function runAction(a: TargetAction) {
  if (a === 'neon') blinkNeon()
  else if (a === 'caption') caption()
  else if (a === 'lights-all') setLights('all')
  else if (a === 'lamp-desk') setLights('desk')
  else if (a === 'lamp-floor') setLights('floor')
  else if (a === 'rain') setRain()
}
