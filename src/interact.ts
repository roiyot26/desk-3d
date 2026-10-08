import type { ThreeEvent } from '@react-three/fiber'
import { runAction } from './actions'
import { activate } from './nav'
import { getUI, setUI } from './store'
import { keyForObject } from './targets'

// Pointer behaviour for 3D hit targets.
// Mouse: hover shows the label (after a short idle, see .hover-label) and a pointer cursor; click opens.
// Touch: the first tap shows the label, a second tap (or the label's Open button) opens the panel.

let canvasEl: HTMLElement | null = null
export function setCanvasElement(el: HTMLElement | null) {
  canvasEl = el
  el?.addEventListener('pointerleave', () => hoverKey(null))
}

function setCursor(pointer: boolean) {
  if (canvasEl) canvasEl.style.cursor = pointer ? 'pointer' : 'grab'
}

export function hoverKey(key: string | null) {
  const s = getUI()
  setCursor(!!key && !s.open)
  if (s.hoverTouch) return
  if (s.hovered !== key) setUI({ hovered: key, hoverTouch: false })
}

export function tapKey(key: string | null, touch: boolean) {
  const s = getUI()
  const t = key ? s.targets.get(key) : undefined
  if (!t) {
    if (s.hoverTouch) setUI({ hovered: null, hoverTouch: false })
    return
  }
  if (touch && !(s.hovered === key && s.hoverTouch)) {
    setUI({ hovered: key, hoverTouch: true })
    return
  }
  if (t.def.action) {
    if (s.hoverTouch) setUI({ hovered: null, hoverTouch: false })
    runAction(t.def.action)
    return
  }
  activate(t.id, { ...(t.def.skill ? { skill: t.def.skill } : {}), ...(t.def.project ? { project: t.def.project } : {}) })
}

const CLICK_SLOP = 6 // px: a drag that ends on an object is not a click

export const sceneHandlers = {
  onPointerMove(e: ThreeEvent<PointerEvent>) {
    e.stopPropagation()
    if (e.pointerType === 'touch') return
    hoverKey(keyForObject(e.object))
  },
  onClick(e: ThreeEvent<MouseEvent>) {
    e.stopPropagation()
    if (e.delta > CLICK_SLOP) return
    const touch = (e.nativeEvent as PointerEvent).pointerType === 'touch'
    tapKey(keyForObject(e.object), touch)
  },
}

export function proxyHandlers(key: string) {
  return {
    onPointerMove(e: ThreeEvent<PointerEvent>) {
      e.stopPropagation()
      if (e.pointerType !== 'touch') hoverKey(key)
    },
    onClick(e: ThreeEvent<MouseEvent>) {
      e.stopPropagation()
      if (e.delta > CLICK_SLOP) return
      tapKey(key, (e.nativeEvent as PointerEvent).pointerType === 'touch')
    },
  }
}
