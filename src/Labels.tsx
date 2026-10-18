import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { content } from './content'
import { rigFlags } from './CameraRig'
import { tapKey } from './interact'
import { layoutLabels, type LabelFrame, type LabelIn, type LabelOut, type Rect } from './labelLayout'
import { getUI, useUI } from './store'
import { markerTargetFor, type Target } from './targets'
import { SHEET_QUERY } from './useMedia'

/**
 * Eight always-visible labels in the room (Vision recruiter look §3).
 * <RoomLabels /> is plain DOM (outside the canvas); <LabelDriver /> runs inside the canvas, projects
 * the anchors every frame, runs the collision layout and writes positions straight to the chips.
 * Priority = the guide row order: Ask the duck > Projects > 3D for the web > Stack > Contact >
 * Career > Virtual Garden > Now building.
 */
export const LABELS = content.guide.rows.map((r, priority) => ({ id: r.id, label: r.label, priority }))

/** Camera speed above which labels fade out (m/s), and the equivalent turn rate (rad/s) for look-drags. */
export const MOVE_MS = 0.6
export const TURN_RS = 0.6
/** Labels come back this long after the camera settles. */
export const SETTLE_MS = 250

const els = new Map<string, HTMLButtonElement>()
let root: HTMLDivElement | null = null
/** Ids whose chip is on screen (the hover label skips them: the chip already names the object). */
export const shownLabels = new Set<string>()
/** ?debug read-out for the shot metrics. */
export const labelDebug: { last: LabelOut[]; moving: boolean; frame: LabelFrame | null } = { last: [], moving: false, frame: null }

export function RoomLabels() {
  const ready = useUI((s) => s.stage === 'ready' && s.entered)
  const targets = useUI((s) => s.targets)
  const keys = useMemo(() => new Map(LABELS.map((l) => [l.id, markerTargetFor(targets, l.id)?.key])), [targets])
  if (!ready) return null
  return (
    <div
      className="room-labels moving"
      ref={(el) => {
        root = el
      }}
      role="group"
      aria-label={content.guide.title}
    >
      {LABELS.filter((l) => keys.get(l.id)).map((l) => (
        <button
          key={l.id}
          type="button"
          className={`room-label${l.priority === 0 ? ' lead' : ''}`}
          data-id={l.id}
          ref={(el) => {
            if (el) els.set(l.id, el)
            else els.delete(l.id)
          }}
          onClick={() => tapKey(keys.get(l.id) ?? null)}
        >
          <span className="room-label-chip">
            {l.priority === 0 && <span className="room-label-dot" aria-hidden="true" />}
            <span className="room-label-text">{l.label}</span>
          </span>
          <span className="room-label-leader" aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}

/** Rects of UI the chips must stay clear of. A full-width sheet in the lower part of the screen raises the frame's bottom instead. */
function uiFrame(w: number, h: number, phone: boolean): LabelFrame {
  const obstacles: Rect[] = []
  let bottom = h
  for (const el of document.querySelectorAll<HTMLElement>('.chat, .panel, .hud, .guide')) {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1 || getComputedStyle(el).visibility === 'hidden') continue
    // Full-width sheets in the lower part of the screen (the chat sheet, a station sheet stacked above the chat peek) end the frame.
    if (r.width >= w * 0.9 && r.top > h * 0.3) bottom = Math.min(bottom, r.top)
    else obstacles.push({ l: r.left, t: r.top, r: r.right, b: r.bottom })
  }
  return { w, h, top: 0, bottom, obstacles, phone }
}

/** Chips hang just above the object (the 3D hover label's anchor sits 7 cm up; a chip on a 10 px leader reads better at 1.5 cm). */
export const LABEL_LIFT_M = 0.015

/** One anchor per label: the stop's marker target, except Stack, which spans the whole shelf of books. */
export function labelAnchors(targets: Map<string, Target>) {
  return LABELS.flatMap((l) => {
    const t = markerTargetFor(targets, l.id)
    if (!t) return []
    const box = t.box.clone()
    if (l.id === 'stop-3') for (const o of targets.values()) if (o.id === l.id) box.union(o.box)
    const c = box.getCenter(new THREE.Vector3())
    return [{ ...l, anchor: new THREE.Vector3(c.x, box.max.y + LABEL_LIFT_M, c.z) }]
  })
}

/** True once #poster is out and its opacity has reached 0 (or there is no poster). */
export function posterLifted(): boolean {
  const p = document.getElementById('poster')
  if (!p || !p.isConnected) return true
  const cs = getComputedStyle(p)
  return cs.display === 'none' || (p.classList.contains('out') && +cs.opacity === 0)
}

const v = new THREE.Vector3()
const lastPos = new THREE.Vector3()
const lastQ = new THREE.Quaternion()

export function LabelDriver() {
  const { camera, size } = useThree()
  const targets = useUI((s) => s.targets)
  const anchors = useMemo(() => labelAnchors(targets), [targets])
  const st = useRef({ sizes: new Map<string, [number, number]>(), settleAt: 0, moving: true, primed: false, frame: null as LabelFrame | null, frameAt: 0, posterGone: false })
  useEffect(() => {
    const s = st.current
    const remeasure = () => s.sizes.clear()
    window.addEventListener('resize', remeasure)
    return () => window.removeEventListener('resize', remeasure)
  }, [])
  useFrame((_, dt) => {
    const s = st.current
    if (!root || !els.size) return
    // Camera motion: translation speed, turn rate, or a GSAP fly.
    const now = performance.now()
    const speed = s.primed && dt > 0 ? camera.position.distanceTo(lastPos) / dt : 0
    const turn = s.primed && dt > 0 ? lastQ.angleTo(camera.quaternion) / dt : 0
    lastPos.copy(camera.position)
    lastQ.copy(camera.quaternion)
    s.primed = true
    // No chips until the poster's dark layer has fully lifted off the room (index.html dip-to-dark).
    if (!s.posterGone) s.posterGone = posterLifted()
    const fast = !s.posterGone || rigFlags.flying || speed > MOVE_MS || turn > TURN_RS
    if (fast) s.settleAt = now + SETTLE_MS
    const moving = fast || now < s.settleAt
    if (moving !== s.moving) {
      s.moving = moving
      root.classList.toggle('moving', moving)
    }
    labelDebug.moving = moving
    if (moving) return
    // Measure chips once per size (cached; re-measured on resize).
    for (const [id, el] of els)
      if (!s.sizes.has(id)) {
        const chip = el.firstElementChild as HTMLElement
        s.sizes.set(id, [chip.offsetWidth, chip.offsetHeight])
      }
    // UI rects (sheets, panels, HUD) change rarely; re-read them at most every 100 ms.
    if (!s.frame || now - s.frameAt > 100) {
      s.frame = uiFrame(size.width, size.height, window.matchMedia(SHEET_QUERY).matches)
      s.frameAt = now
    }
    const ui = getUI()
    const openId = ui.open?.id
    const hotId = ui.hovered ? ui.targets.get(ui.hovered)?.id : undefined
    const items: LabelIn[] = []
    for (const a of anchors) {
      if (!els.has(a.id)) continue
      v.copy(a.anchor).project(camera)
      const [w, h] = s.sizes.get(a.id) ?? [0, 0]
      items.push({
        id: a.id,
        priority: a.priority,
        x: (v.x + 1) * 0.5 * size.width,
        y: (1 - v.y) * 0.5 * size.height,
        behind: v.z > 1 || v.z < -1,
        dist: camera.position.distanceTo(a.anchor),
        w,
        h,
        hidden: openId === a.id,
      })
    }
    const out = layoutLabels(items, s.frame)
    labelDebug.last = out
    labelDebug.frame = s.frame
    shownLabels.clear()
    for (const o of out) {
      const el = els.get(o.id)
      if (!el) continue
      if (o.shown) shownLabels.add(o.id)
      el.classList.toggle('on', o.shown)
      el.classList.toggle('hot', o.id === hotId)
      // The button is the 44 px hit area centred on the chip; the leader hangs from the chip to the anchor.
      el.style.transform = `translate(${o.rect.l}px, ${o.rect.t}px)`
      el.style.setProperty('--leader', `${o.leader}px`)
      el.style.setProperty('--lead-x', `${Math.round(o.x - o.rect.l)}px`)
    }
  })
  return null
}
