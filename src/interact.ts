import { audio } from './audio'
import type { ThreeEvent } from '@react-three/fiber'
import { runAction } from './actions'
import { activate, closePanel } from './nav'
import { getUI, setUI } from './store'
import { keyForObject } from './targets'

// Pointer behaviour for 3D hit targets.
// Mouse: hover shows the label; click opens. Touch: one tap opens (parity). Empty-room tap closes an open panel
// (backdrop is pointer-events: none so two-finger pinch reaches the canvas on framed stations).

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

export function tapKey(key: string | null, _touch = false) {
  const s = getUI()
  const t = key ? s.targets.get(key) : undefined
  if (!t) {
    if (s.hoverTouch) setUI({ hovered: null, hoverTouch: false })
    // Single tap on empty room closes the station (backdrop is pointer-events: none so pinches reach the canvas).
    else if (s.open) closePanel()
    return
  }
  // Touch ↔ desktop parity: one tap / click opens (or flips an action). A drag that ends on a
  // mesh is filtered by CLICK_SLOP in the handlers — free look never requires a precise hit to
  // keep orbiting; opening only happens on a true tap.
  if (s.hoverTouch) setUI({ hovered: null, hoverTouch: false })
  audio.unlock()
  if (t.def.action) {
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
