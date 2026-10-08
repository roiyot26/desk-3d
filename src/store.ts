import { useSyncExternalStore } from 'react'
import type { Target } from './targets'

// Tiny UI store shared by the canvas (camera, markers) and the DOM overlays (panel, tour, loader).

export type Open = { id: string; project?: string; skill?: string } | null

export type UIState = {
  /** Loader stage: download -> compile -> ready. */
  stage: 'download' | 'compile' | 'ready'
  progress: number // 0..1 download progress
  /** Cold-open card visible until the visitor picks tour / free roam (or opens anything). */
  intro: boolean
  open: Open
  /** Hovered hit-target key (see targets.ts), shown as a label after a short idle. */
  hovered: string | null
  /** True when `hovered` came from a touch tap (second tap opens). */
  hoverTouch: boolean
  visited: string[]
  bonusFound: string[]
  finale: 'hidden' | 'open' | 'dismissed'
  /** Auto-quality step: 0 full, 1 post off, 2 rain particles off, 3 DPR 1. */
  degrade: number
  /** Project the monitor's ScreenSlot shows (follows the projects carousel). */
  slotProject: string
  targets: Map<string, Target>
}

let state: UIState = {
  stage: 'download',
  progress: 0,
  intro: true,
  open: null,
  hovered: null,
  hoverTouch: false,
  visited: [],
  bonusFound: [],
  finale: 'hidden',
  degrade: 0,
  slotProject: 'virtual-garden',
  targets: new Map(),
}

const listeners = new Set<() => void>()

export function getUI() {
  return state
}

export function setUI(patch: Partial<UIState> | ((s: UIState) => Partial<UIState>)) {
  const p = typeof patch === 'function' ? patch(state) : patch
  state = { ...state, ...p }
  listeners.forEach((l) => l())
}

export function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useUI<T>(sel: (s: UIState) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state), () => sel(state))
}
