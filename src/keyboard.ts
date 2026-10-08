import * as THREE from 'three'
import { useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { startAgentic } from './actions'
import { audio } from './audio'
import { roomScene } from './Room'
import { getUI } from './store'

/**
 * The visitor's keystrokes press the matching key on the 3D keyboard (desktop).
 *
 * Lookup per typed key, first hit wins:
 *   1. KEY_<Name> meshes (Wanda's GLB: 65 keys, KEY_A..KEY_Z, KEY_0..KEY_9, KEY_Space, KEY_Enter,
 *      KEY_Comma, KEY_Shift / KEY_ShiftR, KEY_Up ...; shifted symbols press their base key)
 *   2. a grid keyboard KB_<row>_<col> (older GLB) via a QWERTY map (row 0 = number row)
 *   3. nothing: no mesh moves, but we still listen (sound + the "claude" easter egg)
 * Typing "claude" anywhere (outside text inputs) starts agentic mode.
 */
const ROWS = ['`1234567890-=', '\tqwertyuiop[]\\', "\u0000asdfghjkl;'\n", '\u0000zxcvbnm,./']
const SHIFTED = '~!@#$%^&*()_+{}|:"<>?'
const UNSHIFTED = "`1234567890-=[]\\;',./"
const PUNCT: Record<string, string> = {
  '`': 'Grave', '-': 'Minus', '=': 'Equal', '[': 'LBracket', ']': 'RBracket', '\\': 'Backslash',
  ';': 'Semicolon', "'": 'Quote', ',': 'Comma', '.': 'Period', '/': 'Slash',
}
const SPECIAL: Record<string, string[]> = {
  ' ': ['KEY_Space', 'KB_Space'],
  Enter: ['KEY_Enter', 'KB_2_12'],
  Backspace: ['KEY_Backspace', 'KB_0_13'],
  Delete: ['KEY_Delete'],
  Tab: ['KEY_Tab', 'KB_1_0'],
  Shift: ['KEY_Shift', 'KB_3_0'],
  ShiftRight: ['KEY_ShiftR', 'KB_3_11'],
  CapsLock: ['KEY_Caps', 'KEY_CapsLock', 'KB_2_0'],
  Control: ['KEY_Ctrl'],
  Alt: ['KEY_Alt'],
  Meta: ['KEY_Cmd'],
  MetaRight: ['KEY_CmdR'],
  Fn: ['KEY_Fn'],
  End: ['KEY_End'],
  ArrowUp: ['KEY_Up'],
  ArrowDown: ['KEY_Down'],
  ArrowLeft: ['KEY_Left'],
  ArrowRight: ['KEY_Right'],
}
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'Fn'])

function namesFor(key: string, code = ''): string[] {
  if (key === 'Shift' && code === 'ShiftRight') return SPECIAL.ShiftRight
  if (key === 'Meta' && code === 'MetaRight') return SPECIAL.MetaRight
  if (SPECIAL[key]) return SPECIAL[key]
  if (key.length !== 1) return []
  let c = key.toLowerCase()
  const si = SHIFTED.indexOf(c)
  if (si >= 0) c = UNSHIFTED[si]
  const out = PUNCT[c] ? [`KEY_${PUNCT[c]}`] : [`KEY_${c.toUpperCase()}`]
  ROWS.forEach((row, r) => {
    const i = row.indexOf(c)
    if (i >= 0) out.push(`KB_${r}_${i}`)
  })
  return out
}

const TRAVEL = 0.0035 // metres a key goes down
const HOLD = 90 // ms
type Pressed = { node: THREE.Object3D; baseY: number; until: number }
const pressed = new Map<THREE.Object3D, Pressed>()

function press(key: string, code = '') {
  if (!roomScene) return
  for (const name of namesFor(key, code)) {
    const node = roomScene.getObjectByName(name)
    if (!node) continue
    const p = pressed.get(node)
    pressed.set(node, { node, baseY: p ? p.baseY : node.position.y, until: performance.now() + HOLD })
    return
  }
}

/** Canvas side: ease pressed keys down and back up. */
export function KeyPresser() {
  useFrame((_, delta) => {
    const now = performance.now()
    const k = Math.min(1, delta * 30)
    for (const p of pressed.values()) {
      const down = now < p.until
      const target = down ? p.baseY - TRAVEL : p.baseY
      p.node.position.y += (target - p.node.position.y) * (down ? 1 : k)
      if (!down && Math.abs(p.node.position.y - p.baseY) < 1e-5) {
        p.node.position.y = p.baseY
        pressed.delete(p.node)
      }
    }
  })
  return null
}

const WORD = 'claude'

/** DOM side: global listener (ignores text fields and shortcuts). */
export function useTyping() {
  useEffect(() => {
    let buf = ''
    const on = (e: KeyboardEvent) => {
      const s = getUI()
      if (!s.entered) return
      // Shortcuts (Ctrl/Cmd/Alt + key) are the browser's; a bare modifier still presses its key.
      if ((e.ctrlKey || e.metaKey || e.altKey) && !MODIFIERS.has(e.key)) return
      const el = e.target as HTMLElement | null
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return
      const k = e.key
      if (k.length !== 1 && !SPECIAL[k]) return
      press(k, e.code)
      audio.play('key', { rate: 0.9 + Math.random() * 0.25, gain: 0.45 })
      if (k.length === 1) {
        buf = (buf + k.toLowerCase()).slice(-WORD.length)
        if (buf === WORD) {
          buf = ''
          startAgentic()
        }
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])
}
