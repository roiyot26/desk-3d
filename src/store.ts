import { useSyncExternalStore } from 'react'
import type { StopCam, Target } from './targets'

// Tiny UI store shared by the canvas (camera, markers, lights, duck) and the DOM overlays.

export type Open = { id: string; project?: string; skill?: string } | null
export type DuckEntry = { id: number; question: string; steps: string[]; shown: number; reply: string | null; matched: boolean }
export type LightGroup = 'desk' | 'floor' | 'ambient'

export type UIState = {
  /** Loader stage: download -> compile -> ready. */
  stage: 'download' | 'compile' | 'ready'
  progress: number // 0..1 download progress
  /** Visitor pressed Enter on the loader (this is also the audio unlock gesture). */
  entered: boolean
  /** Cold-open card visible until the visitor picks tour / free roam (or opens anything). */
  intro: boolean
  open: Open
  /** Phones: the bottom sheet is snapped to full height (default 50%). */
  sheetFull: boolean
  /** The visitor has dragged the camera at least once (the bottom caption fades out). */
  dragged: boolean
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
  /** Blender tour cameras by panel id (STOP_*_Cam). */
  stopCams: Map<string, StopCam>
  // --- room state
  lights: Record<LightGroup, boolean>
  rain: boolean
  /** performance.now() ms until which agentic mode runs (0 = off). */
  agenticUntil: number
  /** performance.now() ms until which the clicked neon sign blinks. */
  neonUntil: number
  // --- duck
  duckThinking: boolean
  quackAt: number
  /** Target keys the duck is citing: beams + glow boxes. */
  sources: { keys: string[]; at: number; fadeAt?: number }
  duckReply: { question: string; reply: string; at: number } | null
  /** Chat transcript (kept while the page is open). `shown` = ticker steps revealed so far. */
  duckLog: DuckEntry[]
  // --- HUD
  toast: { text: string; at: number } | null
  /** Last newly found secret (HUD flash). */
  secretFlash: { id: string; at: number } | null
  secrets: string[]
  secretsCard: 'hidden' | 'open' | 'dismissed'
  muted: boolean
  music: boolean
}

const SECRETS_KEY = 'desk3d-secrets'
const MUTE_KEY = 'desk3d-muted'

function loadSecrets(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(SECRETS_KEY) ?? '[]')
  } catch {
    return []
  }
}

let state: UIState = {
  stage: 'download',
  progress: 0,
  entered: false,
  intro: true,
  open: null,
  sheetFull: false,
  dragged: false,
  hovered: null,
  hoverTouch: false,
  visited: [],
  bonusFound: [],
  finale: 'hidden',
  degrade: 0,
  slotProject: 'virtual-garden',
  targets: new Map(),
  stopCams: new Map(),
  lights: { desk: true, floor: true, ambient: true },
  rain: true,
  agenticUntil: 0,
  neonUntil: 0,
  duckThinking: false,
  quackAt: 0,
  sources: { keys: [], at: 0 },
  duckReply: null,
  duckLog: [],
  toast: null,
  secretFlash: null,
  secrets: loadSecrets(),
  secretsCard: 'hidden',
  muted: (() => {
    try {
      return localStorage.getItem(MUTE_KEY) === '1'
    } catch {
      return false
    }
  })(),
  music: true,
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

export function toast(text: string) {
  setUI({ toast: { text, at: performance.now() } })
}

export function setMuted(muted: boolean) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
  } catch {
    /* private mode */
  }
  setUI({ muted })
}

export const SECRET_COUNT = 6

/**
 * Test hook for screenshots on very slow (software-GL) machines: with `?debug`, setting
 * `window.__desk3dHoldMoment = true` keeps toasts and agentic mode on until it is cleared.
 */
export function momentHeld(): boolean {
  return DEBUG_FLAG && !!(window as unknown as { __desk3dHoldMoment?: boolean }).__desk3dHoldMoment
}
const DEBUG_FLAG = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')

/** Mark a secret as found (persists for the session). Returns true when it was new. */
export function findSecret(id: string): boolean {
  if (state.secrets.includes(id)) return false
  const secrets = [...state.secrets, id]
  try {
    sessionStorage.setItem(SECRETS_KEY, JSON.stringify(secrets))
  } catch {
    /* private mode */
  }
  setUI({ secrets, secretFlash: { id, at: performance.now() }, secretsCard: secrets.length >= SECRET_COUNT && state.secretsCard === 'hidden' ? 'open' : state.secretsCard })
  return true
}
