import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { debugPose } from './debugPose'
import * as THREE from 'three'
import { TOUCH } from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { RoomInfo } from './analyze'
import type { Quality } from './quality'
import { getUI, setUI, subscribe, useUI } from './store'
import { gsap, useGSAP } from './gsap'
import { DUCK_CLEAR, fitPortrait, freeCentreNdc, markerTargetFor, phoneBasePose, poseFor, poseFromStopCam, type Pose, type Target } from './targets'
import { STOPS, content } from './content'
import { CHAT_INSET, CHAT_SHEET_QUERY, chatWidth } from './duck/DuckChat'
import { audio } from './audio'

/** Read-only for other modules (room labels hide while a GSAP fly runs). */
export const rigFlags = {
  flying: false,
  /** Last phone station framing (panel v2.3 #66): the sheet top it framed for, and the #61 solver's step. Read by __desk3d.cam(). */
  frame: null as null | { id: string; sheetTop: number; measured: boolean; sheetFrac: number; s: number; elev: number; k: number; ok: boolean; reframes: number },
}

/**
 * Desktop: the docked duck chat covers the right of the canvas (station panels open beside it;
 * poseFromStopCam aims the subject into the panel's free area).
 * Shift the projection so the look-at point lands in the middle of the free area on the left
 * (camera.setViewOffset), eased. Phones: the chat is a bottom sheet, no shift.
 */
let chatShift = 0
const fitCache = { key: '', shift: 0 }
/** Stations that must stay clear of the docked chat at the default view (the career board is behind you). */
const FIT_KEYS = ['monitor', 'laptop', 'terrarium', 'mug', 'duck']
const _probe = new THREE.PerspectiveCamera()
const _v = new THREE.Vector3()
/**
 * How far to shift: at least half the column (Vision §2), more if a station at the home view
 * would still sit under the column (the desk is right of centre on desktop). Never so far that
 * the leftmost station leaves the frame.
 */
function fitShift(w: number, h: number, left: number, home: Pose, fov: number) {
  const key = `${w}x${h}:${left}`
  if (fitCache.key === key) return fitCache.shift
  const half = (w - left) / 2
  _probe.fov = fov
  _probe.aspect = w / h
  _probe.near = 0.03
  _probe.far = 100
  _probe.position.copy(home.position)
  _probe.lookAt(home.target)
  _probe.updateProjectionMatrix()
  _probe.updateMatrixWorld()
  let lo = Infinity
  let hi = -Infinity
  const targets = getUI().targets
  for (const k of FIT_KEYS) {
    const t = targets.get(k)
    if (!t) continue
    _v.copy(t.center).project(_probe)
    if (_v.z > 1 || Math.abs(_v.x) > 1.2) continue
    const x = ((_v.x + 1) / 2) * w
    lo = Math.min(lo, x)
    hi = Math.max(hi, x)
  }
  if (!targets.size) return half
  let shift = half
  // Keep clear of the idle drift too (±DRIFT_AZ sways the view sideways).
  const drift = (DRIFT_AZ / (2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * (w / h)))) * w
  if (hi > -Infinity) shift = Math.max(half, Math.min(hi - (left - 48 - drift), lo - 32))
  fitCache.key = key
  fitCache.shift = shift
  return shift
}
function shiftForChat(cam: THREE.PerspectiveCamera, w: number, h: number, reduced: boolean, home: Pose, dt: number) {
  const root = document.documentElement
  let want = 0
  if (root.classList.contains('chat-docked')) {
    const chat = document.querySelector('.chat.docked')?.getBoundingClientRect()
    if (chat && chat.left < w) want = fitShift(w, h, Math.round(chat.left), home, fovFor(w / h) * ((home as Pose & { zoom?: number }).zoom ?? 1))
  }
  // Time-based ease (~0.5 s), so slow frames don't drag it out.
  chatShift = reduced ? want : chatShift + (want - chatShift) * (1 - Math.exp(-Math.min(dt, 0.25) * 7))
  if (Math.abs(chatShift - want) < 0.5) chatShift = want
  const cur = cam.view?.enabled ? cam.view.offsetX : 0
  if (Math.abs(cur - chatShift) < 0.25 && (!cam.view || (cam.view.fullWidth === w && cam.view.fullHeight === h))) return
  if (chatShift < 0.25) cam.clearViewOffset()
  else cam.setViewOffset(w, h, Math.round(chatShift * 2) / 2, 0, w, h)
}
export const chatShiftPx = () => chatShift

/**
 * Desktop, chat docked: the station panel is anchored left (index.css .chat-docked .panel), so a
 * framed station sits between the panel and the chat column.
 */
function dockedLayout(w: number): [number, number | undefined, { l: number; r: number } | undefined] {
  if (!document.documentElement.classList.contains('chat-docked')) return [0, undefined, undefined]
  const chat = chatWidth(w) + CHAT_INSET
  // The station panel overlays the chat column, so the station frames in the canvas area.
  return [chat, fitCache.key ? fitCache.shift : chat / 2, { l: 12, r: w - chat - 12 }]
}

/**
 * Phones, before the station sheet's first measure: its top from the CSS cap (the panel's computed
 * max-height above the chat peek). Read from CSS so the camera never hard-codes the sheet height.
 */
function capSheetTop(h: number): number {
  const root = document.documentElement
  const peek = parseFloat(getComputedStyle(root).getPropertyValue('--chat-h')) || 0
  const el = document.querySelector<HTMLElement>('.panel')
  const cap = el ? parseFloat(getComputedStyle(el).maxHeight) : NaN
  return Math.round(h - peek - (Number.isFinite(cap) ? cap : h * 0.5))
}

/** The station subject the #61 rules check: the marker object; the books station checks every book. */
function subjectBox(targets: Map<string, Target>, id: string, t: Target | undefined): THREE.Box3 | undefined {
  if (id === 'stop-3') {
    const books = [...targets.values()].filter((x) => x.id === id)
    if (books.length) return books.reduce((b, x) => b.union(x.box), new THREE.Box3())
  }
  return t?.box
}

/** The duck's bottom sheet opens at 65% on phones (index.css .panel.duck); frame above it. */
const DUCK_SHEET = 0.65
/** Phones: the Claude Code book is framed in the top 40% of the screen, above the station sheet. */
const BOOK_ABOVE = 0.4

/**
 * Lens: a 26 mm full-frame lens has a 69.4° horizontal field of view (2·atan(18/26)).
 * three.js `fov` is vertical, so we keep that horizontal FOV on landscape screens and derive the
 * vertical one from the aspect ratio (≈42.6° at 16:9, ≈46.9° at 16:10). Portrait screens get up
 * to 72° vertical so phones still see the desk and the window.
 */
const HFOV_26MM = 2 * Math.atan(18 / 26)
export function fovFor(aspect: number) {
  const v = 2 * Math.atan(Math.tan(HFOV_26MM / 2) / Math.max(aspect, 0.01))
  return THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(v), 40, aspect < 0.85 ? 72 : 60)
}

export const EYE_HEIGHT = 1.4

/**
 * Initial interior view. Landscape: standing in the front-right corner at eye height, looking at
 * the desk and the window. Portrait (phones): step left toward the middle of the room and aim
 * between the desk and the window so both stay in a narrow frame.
 */
export function homeView(info: RoomInfo, portrait: boolean, aspect = 1): Pose & { zoom?: number } {
  const r = info.room
  const floor = r.min.y
  if (aspect < TALL_ASPECT && info.deskBox) return tallHome(info, aspect)
  if (portrait) {
    const win = info.glass?.center ?? info.focus
    const position = new THREE.Vector3(THREE.MathUtils.lerp(r.min.x, r.max.x, 0.6), floor + EYE_HEIGHT, r.max.z - 0.7)
    const target = new THREE.Vector3((info.focus.x + win.x) / 2, floor + 1.1, info.focus.z - 0.4)
    return { position, target }
  }
  const position = new THREE.Vector3(r.max.x - 0.7, floor + EYE_HEIGHT, r.max.z - 0.65)
  const target = new THREE.Vector3(info.focus.x - 0.15, floor + 1.08, info.focus.z - 0.35)
  return { position, target }
}

/** Tall phones (aspect < 0.8): desk-centred home, see tallHome. */
const TALL_ASPECT = 0.8
const TALL_PITCH = THREE.MathUtils.degToRad(-8)
const TALL_FILL = 0.7

/**
 * Tall phone home: yaw aimed straight at the desk centre, tilted ~8° down, standing on the line
 * from the desk toward the front-right corner (the old portrait spot) at the distance where the
 * desk top's projected width is ~70% of the frame (solved by projecting its box with the real
 * phone lens). Clamped to stay ≥0.35 m inside the walls.
 */
function tallHome(info: RoomInfo, aspect: number): Pose & { zoom?: number } {
  const r = info.room
  const floor = r.min.y
  const desk = info.deskBox!
  const c = desk.getCenter(new THREE.Vector3())
  const eyeY = floor + EYE_HEIGHT
  // Direction from the desk toward the old portrait standpoint (front-right of the desk).
  const old = new THREE.Vector3(THREE.MathUtils.lerp(r.min.x, r.max.x, 0.6), eyeY, r.max.z - 0.7)
  const out = new THREE.Vector3(old.x - c.x, 0, old.z - c.z).normalize()
  const cam = new THREE.PerspectiveCamera(fovFor(aspect), aspect, 0.03, 100)
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(
    (i) => new THREE.Vector3(i & 1 ? desk.max.x : desk.min.x, i & 2 ? desk.max.y : desk.min.y, i & 4 ? desk.max.z : desk.min.z),
  )
  const pose = (d: number): Pose => {
    const position = new THREE.Vector3(c.x + out.x * d, eyeY, c.z + out.z * d)
    const yaw = new THREE.Vector3(c.x - position.x, 0, c.z - position.z).normalize()
    const dir = yaw.multiplyScalar(Math.cos(TALL_PITCH)).setY(Math.sin(TALL_PITCH))
    return { position, target: position.clone().addScaledVector(dir, d) }
  }
  const fill = (d: number, zoom = 1) => {
    const p = pose(d)
    cam.fov = fovFor(aspect) * zoom
    cam.updateProjectionMatrix()
    cam.position.copy(p.position)
    cam.lookAt(p.target)
    cam.updateMatrixWorld()
    let lo = Infinity
    let hi = -Infinity
    for (const k of corners) {
      const x = k.clone().project(cam).x
      lo = Math.min(lo, x)
      hi = Math.max(hi, x)
    }
    return (hi - lo) / 2
  }
  // Farthest spot still 0.35 m inside the walls along that line.
  const m = 0.35
  const maxX = out.x > 0 ? (r.max.x - m - c.x) / out.x : out.x < 0 ? (c.x - (r.min.x + m)) / -out.x : Infinity
  const maxZ = out.z > 0 ? (r.max.z - m - c.z) / out.z : out.z < 0 ? (c.z - (r.min.z + m)) / -out.z : Infinity
  let lo = 0.9
  let hi = Math.max(lo, Math.min(maxX, maxZ))
  if (fill(hi) > TALL_FILL) {
    // Can't step back far enough inside the room: open the lens a little instead (within the
    // free-roam zoom range) so the desk still lands near 70% of the width.
    let zl = 1
    let zh = ZOOM_MAX
    for (let i = 0; i < 20; i++) {
      const z = (zl + zh) / 2
      if (fill(hi, z) > TALL_FILL) zl = z
      else zh = z
    }
    return { ...pose(hi), zoom: (zl + zh) / 2 }
  }
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (fill(mid) > TALL_FILL) lo = mid
    else hi = mid
  }
  return pose((lo + hi) / 2)
}

/** The duck leads: at arrival it fills at least this share of the frame height (Shuri spec lock #1: ≥6%). */
const DUCK_FILL = 0.07
const DUCK_MIN_DIST = 0.75
/** Desktop with the docked chat: ~10% tighter lens so the desk and duck own the free area. */
const DOCKED_ZOOM = 0.9
const _lp = new THREE.PerspectiveCamera()
const _lv = new THREE.Vector3()

function duckFill(pose: Pose, box: THREE.Box3, fov: number, aspect: number) {
  _lp.fov = fov
  _lp.aspect = aspect
  _lp.near = 0.03
  _lp.far = 100
  _lp.position.copy(pose.position)
  _lp.lookAt(pose.target)
  _lp.updateProjectionMatrix()
  _lp.updateMatrixWorld()
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < 8; i++) {
    _lv.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(_lp)
    lo = Math.min(lo, _lv.y)
    hi = Math.max(hi, _lv.y)
  }
  return (hi - lo) / 2
}

/** Duck height share of the frame from its real mesh vertices (the hit box overstates it ~1.6×). */
function meshFill(pose: Pose, nodes: THREE.Object3D[], fov: number, aspect: number) {
  _lp.fov = fov
  _lp.aspect = aspect
  _lp.near = 0.03
  _lp.far = 100
  _lp.position.copy(pose.position)
  _lp.lookAt(pose.target)
  _lp.updateProjectionMatrix()
  _lp.updateMatrixWorld()
  let lo = Infinity
  let hi = -Infinity
  for (const n of nodes)
    n.traverse((o) => {
      const g = (o as THREE.Mesh).isMesh ? (o as THREE.Mesh).geometry : null
      const pos = g?.attributes.position
      if (!pos) return
      const step = Math.max(1, Math.floor(pos.count / 400))
      for (let i = 0; i < pos.count; i += step) {
        _lv.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).project(_lp)
        lo = Math.min(lo, _lv.y)
        hi = Math.max(hi, _lv.y)
      }
    })
  return hi > lo ? (hi - lo) / 2 : 0
}

/** CAM_DuckIntro: arrival uses a tighter lens on the duck + desk; the first input eases it out to the room view. */
export const INTRO_FILL = 0.08
function introOf(home: Pose & { zoom?: number }, duck: Target | undefined, aspect: number): Pose & { zoom?: number; roomZoom?: number } {
  const roomZoom = home.zoom ?? 1
  if (!duck) return home
  const c = duck.box.getCenter(new THREE.Vector3())
  // Aim between the room view's look point and the duck: the duck sits a little below centre with the desk around it.
  const target = home.target.clone().lerp(c, 0.8)
  const pose = { position: home.position.clone(), target }
  const base = fovFor(aspect)
  const fill = (z: number) => meshFill(pose, duck.nodes, base * z, aspect)
  if (fill(roomZoom) >= INTRO_FILL) return { ...pose, zoom: roomZoom, roomZoom }
  let lo = 0.2
  let hi = roomZoom
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2
    if (fill(m) >= INTRO_FILL) lo = m
    else hi = m
  }
  return { ...pose, zoom: lo, roomZoom }
}

/**
 * Phones open with the duck sheet at half (~45–52% of the frame), so the arrival look-at is lowered
 * (the camera tilts down) until the duck sits in the free band above the sheet: its centre at
 * PHONE_DUCK_NDC on the arrival lens (about a quarter from the top), and never lower than
 * PHONE_DUCK_NDC_ROOM on the wider room lens the first input eases to, so it stays clear of the
 * sheet after the intro too. Desktop is untouched.
 */
export const PHONE_DUCK_NDC = 0.5
export const PHONE_DUCK_NDC_ROOM = 0.35
function phoneLift<P extends Pose & { zoom?: number; roomZoom?: number }>(pose: P, duck: Target | undefined, aspect: number): P {
  if (!duck) return pose
  const c = duck.box.getCenter(new THREE.Vector3())
  const cam = new THREE.PerspectiveCamera(50, aspect, 0.01, 100)
  const ndcY = (zoom: number, drop: number) => {
    cam.fov = fovFor(aspect) * zoom
    cam.updateProjectionMatrix()
    cam.position.copy(pose.position)
    cam.lookAt(pose.target.clone().add(new THREE.Vector3(0, -drop, 0)))
    cam.updateMatrixWorld()
    return c.clone().project(cam).y
  }
  // Smallest drop that puts the duck at or above `ndc` with this lens.
  const dropFor = (zoom: number, ndc: number) => {
    if (ndcY(zoom, 0) >= ndc) return 0
    let lo = 0
    let hi = 3
    for (let i = 0; i < 28; i++) {
      const m = (lo + hi) / 2
      if (ndcY(zoom, m) >= ndc) hi = m
      else lo = m
    }
    return hi
  }
  const drop = Math.max(dropFor(pose.zoom ?? 1, PHONE_DUCK_NDC), dropFor(pose.roomZoom ?? pose.zoom ?? 1, PHONE_DUCK_NDC_ROOM))
  return drop ? { ...pose, target: pose.target.clone().add(new THREE.Vector3(0, -drop, 0)) } : pose
}

/**
 * Arrival framing: step from the room's home spot toward the duck (same heading, look-at lowered
 * halfway to the duck) until the duck is DUCK_FILL of the frame height. Free roam then looks
 * around from there.
 */
function leadHome(home: Pose & { zoom?: number }, duck: Target | undefined, aspect: number, docked: boolean): Pose & { zoom?: number } {
  const zoom = (home.zoom ?? 1) * (docked ? DOCKED_ZOOM : 1)
  if (!duck) return { ...home, zoom }
  const c = duck.box.getCenter(new THREE.Vector3())
  const fov = fovFor(aspect) * zoom
  const at = (k: number): Pose => {
    const position = home.position.clone().lerp(c, k)
    position.y = home.position.y - (home.position.y - c.y) * k * 0.35
    const target = home.target.clone().lerp(c, 0.5)
    return { position, target }
  }
  const full = home.position.distanceTo(c)
  const kMax = Math.max(0, 1 - DUCK_MIN_DIST / full)
  if (duckFill(at(0), duck.box, fov, aspect) >= DUCK_FILL) return { ...at(0), zoom }
  let lo = 0
  let hi = kMax
  if (duckFill(at(hi), duck.box, fov, aspect) < DUCK_FILL) return { ...at(hi), zoom }
  for (let i = 0; i < 20; i++) {
    const m = (lo + hi) / 2
    if (duckFill(at(m), duck.box, fov, aspect) >= DUCK_FILL) hi = m
    else lo = m
  }
  return { ...at(hi), zoom }
}

/**
 * Free roam = 360° look-around from where you stand (first-person feel): OrbitControls pivots on a
 * point LOOK_EPS in front of the eye, so dragging turns your head instead of circling the desk.
 * The eye never moves, so it can never leave the room or clip a wall. Zoom = field of view
 * (wheel / pinch), eased and clamped.
 */
const LOOK_EPS = 0.06
const PITCH_DOWN = THREE.MathUtils.degToRad(58) // max look down below the horizon
const PITCH_UP = THREE.MathUtils.degToRad(50) // max look up
export const ZOOM_MIN = 0.55 // fov × 0.55 = zoomed in
export const ZOOM_MAX = 1.15 // fov × 1.15 = a bit wider than the lens
/** Drag sweep: a full-width drag turns ~180° on desktop, ~130° on a phone (then keep going). */
const SWEEP_LANDSCAPE = THREE.MathUtils.degToRad(95)
const SWEEP_PORTRAIT = THREE.MathUtils.degToRad(70)

const IDLE_AFTER = 3.5 // seconds without input before the drift starts
const DRIFT_AZ = THREE.MathUtils.degToRad(6)
const DRIFT_POLAR = THREE.MathUtils.degToRad(0.8)
const DRIFT_PERIOD = 38 // seconds per sway
const EASE_TIME = 1.65 // seconds per camera move between stops (voice: controllable, not whippy)
const FLY_EASE = 'power3.inOut' // same curve as the old hand-rolled cubic easeInOut

/**
 * Camera ownership (one system at a time):
 *   - free roam: OrbitControls as a 360° look-around (+ the idle drift and the FOV zoom below)
 *   - flies (tour stops, marker clicks, duck answers, closing a panel): ONE GSAP tween.
 * Tour and duck both go through `ui.open`, so this rig is the only thing that moves the camera.
 * OrbitControls is disabled for the whole fly and while a panel holds the framed view, then
 * re-enabled (and re-synced) once the camera is back in free roam.
 */

export function CameraRig({ info, quality }: { info: RoomInfo; quality: Quality }) {
  const { camera, size } = useThree()
  const controls = useRef<OrbitControlsImpl>(null)
  const portrait = size.width / size.height < 0.85
  const tall = size.width / size.height < TALL_ASPECT
  // Aspect read only when portrait/tall flips (a phone's URL bar resizing the view must not
  // re-home the camera mid-look).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const duck = useUI((s) => s.targets.get('duck'))
  const home = useMemo(
    () => {
      const aspect = size.width / size.height
      const sheet = !!window.matchMedia?.(CHAT_SHEET_QUERY).matches
      const intro = introOf(leadHome(homeView(info, portrait, aspect), duck, aspect, !sheet), duck, aspect)
      return sheet && portrait ? phoneLift(intro, duck, aspect) : intro
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [info, portrait, tall, duck],
  )

  // Look-around: pivot just in front of the eye; azimuth free (360°), pitch clamped.
  const look = useMemo(() => {
    const dir = home.target.clone().sub(home.position).normalize()
    return { pivot: home.position.clone().addScaledVector(dir, LOOK_EPS) }
  }, [home])
  // OrbitControls' angle per pixel is 2π·speed/height. Negative = "grab the world" (the room
  // follows the finger / cursor, like Street View).
  const rotateSpeed = -(portrait ? SWEEP_PORTRAIT : SWEEP_LANDSCAPE) / (2 * Math.PI * (size.width / size.height))

  // Safe volume for framed object views (poseFor): inside the walls, below the ceiling.
  const safe = useMemo(() => {
    const b = info.room.clone()
    b.min.x += 0.4
    b.max.x -= 0.4
    b.min.z += 0.4
    b.max.z -= 0.35
    b.min.y = info.room.min.y + 0.9
    b.max.y = info.room.min.y + 2.05
    return b
  }, [info])

  // Layout effect: placed before the first frame, so the idle drift never starts from a stale pose.
  useLayoutEffect(() => {
    const cam = camera as THREE.PerspectiveCamera
    cam.position.copy(home.position)
    cam.near = 0.03
    cam.far = 400
    cam.lookAt(home.target)
    controls.current?.target.copy(look.pivot)
    controls.current?.update()
    state.current.zoom = home.zoom ?? 1
    cam.fov = fovFor(size.width / size.height) * state.current.zoom
    cam.updateProjectionMatrix()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, home, look])

  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera
    cam.fov = fovFor(size.width / size.height)
    cam.updateProjectionMatrix()
  }, [camera, size])

  const state = useRef({
    /** FOV zoom factor (wheel / pinch), eased toward each frame in free roam. */
    zoom: 1,
    interacting: false,
    lastInput: -100,
    driftStart: -1,
    driftAz: 0,
    driftPolar: 0,
    // Focus (panel / tour) state.
    openKey: '',
    /** Phones: when the open station started waiting for its first sheet measure (s). */
    waitId: '',
    waitAt: 0,
    saved: null as Pose | null,
    /** Destination of the running fly (so a panel opened mid-fly can still return to it). */
    flyTo: null as Pose | null,
    flyRelease: false,
    flying: false,
    focused: false,
    /** CAM_DuckIntro is on until the first input (drag, wheel, pinch, a question, a station). */
    intro: true,
  })
  // First input releases the intro lens to the room view (eased by the free-roam FOV ease).
  const release = useRef(() => {})
  release.current = () => {
    const st = state.current
    if (!st.intro) return
    st.intro = false
    st.zoom = (home as { roomZoom?: number }).roomZoom ?? st.zoom
    st.lastInput = performance.now() / 1000
  }
  useEffect(() => {
    const ui0 = getUI()
    const n0 = ui0.duckLog.filter((e) => !e.greet).length
    const off = subscribe(() => {
      const u = getUI()
      if (u.open || u.duckLog.filter((e) => !e.greet).length > n0) release.current()
    })
    return () => void off()
  }, [])

  useEffect(() => {
    const c = controls.current
    if (!c) return
    const st = state.current
    const start = () => {
      release.current()
      audio.unlock()
      st.interacting = true
      st.driftStart = -1
      if (!getUI().dragged) setUI({ dragged: true })
    }
    const end = () => {
      st.interacting = false
      st.lastInput = performance.now() / 1000
    }
    // ?debug look(): a programmatic re-aim restarts the idle drift around the new heading.
    const reaim = () => {
      st.driftStart = -1
      st.lastInput = performance.now() / 1000
    }
    c.addEventListener('start', start)
    c.addEventListener('end', end)
    window.addEventListener('desk3d:look', reaim)
    return () => {
      c.removeEventListener('start', start)
      c.removeEventListener('end', end)
      window.removeEventListener('desk3d:look', reaim)
    }
  }, [])

  // --- FOV zoom: mouse wheel and two-finger pinch (OrbitControls' own dolly is off: the eye
  // stays put). Only in free roam; panels hold their framed view.
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    const el = gl.domElement
    const st = state.current
    const clampZ = (z: number) => THREE.MathUtils.clamp(z, ZOOM_MIN, ZOOM_MAX)
    // Free-roam OR framed station: FOV zoom (pinch / wheel). Never during a fly.
    const free = () => !st.flying
    const onWheel = (e: WheelEvent) => {
      if (!free()) return
      e.preventDefault()
      release.current()
      st.zoom = clampZ(st.zoom * Math.exp(e.deltaY * 0.0007))
      st.lastInput = performance.now() / 1000
    }
    let d0 = 0
    let z0 = 1
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    // Pinch is read from the whole document so a finger that started on a room label still counts
    // (Hawkeye #8 F3); only fingers on the canvas or the label layer take part, never one on the UI.
    const onRoom = (t: Touch) => t.target === el || (t.target instanceof Element && !!t.target.closest('.room-labels'))
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2 && [...e.touches].every(onRoom)) {
        d0 = dist(e.touches)
        z0 = st.zoom
      }
    }
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !d0 || !free()) return
      e.preventDefault()
      release.current()
      st.zoom = clampZ(z0 * (d0 / Math.max(1, dist(e.touches))))
      st.lastInput = performance.now() / 1000
      st.driftStart = -1
    }
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) d0 = 0
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    const doc = el.ownerDocument
    doc.addEventListener('touchstart', onTouchStart, { passive: true })
    doc.addEventListener('touchmove', onTouchMove, { passive: false })
    doc.addEventListener('touchend', onTouchEnd)
    doc.addEventListener('touchcancel', onTouchEnd)
    return () => {
      el.removeEventListener('wheel', onWheel)
      doc.removeEventListener('touchstart', onTouchStart)
      doc.removeEventListener('touchmove', onTouchMove)
      doc.removeEventListener('touchend', onTouchEnd)
      doc.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [gl])

  // --- GSAP camera controller. `contextSafe` keeps tweens created later (from useFrame) inside
  // this component's GSAP context, so they are killed on unmount.
  const tween = useRef<gsap.core.Tween | null>(null)
  const { contextSafe } = useGSAP(() => () => void tween.current?.kill(), { dependencies: [] })
  const fly = useMemo(
    () =>
      contextSafe((from: Pose, to: Pose, dur: number, release: boolean) => {
        const c = controls.current
        if (!c) return
        const st = state.current
        const cam = camera as THREE.PerspectiveCamera
        tween.current?.kill()
        c.enabled = false
        st.flying = true
        rigFlags.flying = true
        st.flyTo = to
        st.flyRelease = release
        const p0 = from.position.clone()
        const f0 = from.fov ?? cam.fov
        // Interpolate the view direction as yaw/pitch (no roll, shortest turn) and the look
        // distance separately: free roam looks at a point 6 cm ahead, stops at objects metres away.
        const v0 = from.target.clone().sub(p0)
        const v1 = to.target.clone().sub(to.position)
        const s0 = new THREE.Spherical().setFromVector3(v0)
        const s1 = new THREE.Spherical().setFromVector3(v1)
        let dTheta = s1.theta - s0.theta
        dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta))
        const sph = new THREE.Spherical()
        const dir = new THREE.Vector3()
        const proxy = { k: 0 }
        const apply = () => {
          const e = proxy.k
          cam.position.lerpVectors(p0, to.position, e)
          sph.set(THREE.MathUtils.lerp(s0.radius, s1.radius, e), THREE.MathUtils.lerp(s0.phi, s1.phi, e), s0.theta + dTheta * e)
          dir.setFromSpherical(sph)
          c.target.copy(cam.position).add(dir)
          if (to.fov !== undefined) {
            cam.fov = THREE.MathUtils.lerp(f0, to.fov, e)
            cam.updateProjectionMatrix()
          }
          cam.lookAt(c.target)
        }
        const done = () => {
          tween.current = null
          st.flying = false
          rigFlags.flying = false
          st.flyTo = null
          if (release) {
            st.focused = false
            st.driftStart = -1
            st.lastInput = performance.now() / 1000
            c.update() // re-sync OrbitControls' spherical state to the pose GSAP left behind
            c.enabled = true
          }
        }
        // prefers-reduced-motion (or a 0 s move): hard cut.
        tween.current = gsap.to(proxy, { k: 1, duration: dur, ease: FLY_EASE, onUpdate: apply, onComplete: done, overwrite: true })
        if (dur <= 0) {
          tween.current.progress(1)
        }
      }),
    [camera, contextSafe],
  )

  useFrame((_, dt) => {
    shiftForChat(camera as THREE.PerspectiveCamera, size.width, size.height, quality.reducedMotion, home, dt)
    const c = controls.current
    if (!c) return
    const st = state.current
    const now = performance.now() / 1000
    const cam = camera as THREE.PerspectiveCamera

    // ?debug pose(): hold an exact camera (render checks against Wanda's reference views).
    if (debugPose.current) {
      const p = debugPose.current
      c.enabled = false
      cam.position.fromArray(p.position)
      cam.lookAt(new THREE.Vector3().fromArray(p.target))
      if (Math.abs(cam.fov - p.fov) > 1e-3) {
        cam.fov = p.fov
        cam.updateProjectionMatrix()
      }
      return
    }

    // --- Focus: ease to a framed view when a panel opens, back to the saved pose when it closes.
    const ui = getUI()
    // The featured skill (Claude Code) frames its own book, not the whole shelf: the duck's
    // "how he builds with AI" answer lands on that spine. Other skills keep the shelf stop cam.
    const featured = content.skills.featured.id
    const book = ui.open?.skill === featured ? ui.targets.get(`book-${featured}`) : undefined
    // Phones (v2.3 #66): frame for the station sheet's *measured* top. The key carries it, so a
    // ≥2 px change (the panel's ResizeObserver already coalesces to one rAF and skips drags)
    // re-frames once. Hold the first move until the measure lands (≤300 ms; fonts.ready first).
    const portrait = size.width / size.height < 0.85
    const isStation = !!ui.open && STOPS.find((x) => x.id === ui.open?.id)?.kind !== 'duck'
    const measured = portrait && isStation && ui.sheetTop?.id === ui.open?.id ? ui.sheetTop!.top : null
    let hold = false
    if (portrait && isStation && measured === null) {
      if (st.waitId !== ui.open!.id) {
        st.waitId = ui.open!.id
        st.waitAt = now
      }
      hold = now - st.waitAt < 0.3
    }
    const key = ui.open ? `${ui.open.id}${book ? `:${featured}` : ''}${portrait && isStation ? `@${measured ?? 'cap'}` : ''}` : ''
    if (key !== st.openKey && !hold) {
      const reframe = !!ui.open && st.openKey.split('@')[0] === key.split('@')[0]
      st.openKey = key
      const t = book ?? (ui.open ? markerTargetFor(ui.targets, ui.open.id) : undefined)
      const stopCam = ui.open && !book ? ui.stopCams.get(ui.open.id) : undefined
      const current: Pose = { position: cam.position.clone(), target: c.target.clone(), fov: cam.fov }
      const dur = quality.reducedMotion ? 0 : EASE_TIME
      const phoneFit = portrait && isStation && !book
      const sheetTop = phoneFit ? (measured ?? capSheetTop(size.height)) : 0
      if (phoneFit && !t && !stopCam && ui.open) {
        // A panel with no target of its own keeps the current camera; only the ±0.25 aim nudge
        // may move it if the duck rule fails against the measured sheet (v2.3 #66).
        const duckBox = ui.targets.get('duck')?.box
        const to = fitPortrait(current, { duck: duckBox }, size.width, size.height, sheetTop, { aimOnly: true })
        rigFlags.frame = { id: ui.open.id, sheetTop, measured: measured !== null, sheetFrac: 1 - sheetTop / size.height, s: to.fit.s, elev: 0, k: 1, ok: to.fit.ok, reframes: (reframe ? (rigFlags.frame?.reframes ?? 0) + 1 : 0) }
        if (to.fit.s !== 0) {
          if (!st.saved) st.saved = current
          st.focused = true
          fly(current, to, dur, false)
        }
      } else if (t || stopCam) {
        if (!st.saved) st.saved = st.flying && st.flyRelease && st.flyTo ? st.flyTo : current
        // Blender's STOP_*_Cam framing wins (node.quaternion·Rx(-90°) / target_gltf_yup, see
        // targets.ts); otherwise frame the clicked object.
        const base = fovFor(size.width / size.height)
        const kind = STOPS.find((x) => x.id === ui.open?.id)?.kind
        // sheetFrac: the measured station sheet plus the peek, as a share of the viewport height.
        const sheet = kind === 'duck' ? DUCK_SHEET : phoneFit ? 1 - sheetTop / size.height : 0.5
        let to: Pose = stopCam ? poseFromStopCam(stopCam, size, sheet, ...dockedLayout(size.width)) : { ...poseFor(t!, { home, safe, aspect: size.width / size.height, fov: base, info, above: book ? BOOK_ABOVE : undefined, xc: book ? freeCentreNdc(size.width, ...dockedLayout(size.width)) : undefined }), fov: base }
        if (phoneFit && ui.open) {
          // #61: Vision's verified base pose where the stop cam can't work (stop-2) or v2.3 re-posed
          // it (Contact, Now building); then the rule checks + s / elevation / dolly steps.
          to = phoneBasePose(ui.open.id, size.width) ?? to
          const subject = subjectBox(ui.targets, ui.open.id, t)
          const fit = fitPortrait(to, { subject, duck: ui.targets.get('duck')?.box }, size.width, size.height, sheetTop, {
            duckUnder: DUCK_CLEAR,
            safe,
            minY: 1.0,
          })
          to = fit
          rigFlags.frame = { id: ui.open.id, sheetTop, measured: measured !== null, sheetFrac: sheet, s: fit.fit.s, elev: fit.fit.elev, k: fit.fit.k, ok: fit.fit.ok, reframes: reframe ? (rigFlags.frame?.reframes ?? 0) + 1 : 0 }
        }
        st.focused = true
        // Sync FOV zoom to the framed lens so pinch/wheel scale the photo from here, not from free-roam.
        if (to.fov !== undefined) st.zoom = THREE.MathUtils.clamp(to.fov / base, ZOOM_MIN, ZOOM_MAX)
        fly(current, to, dur, false)
      } else if (st.saved) {
        const back = st.saved
        st.saved = null
        if (back.fov !== undefined) st.zoom = THREE.MathUtils.clamp(back.fov / fovFor(size.width / size.height), ZOOM_MIN, ZOOM_MAX)
        fly(current, back, dur, true)
      }
    }
    // GSAP owns the camera during a fly; a panel's framed view is held still afterwards.
    if (st.flying) return
    if (st.focused) {
      cam.lookAt(c.target)
      // Pinch / wheel still zooms a framed station (photos, monitor, laptop).
      const wantF = fovFor(size.width / size.height) * st.zoom
      if (Math.abs(cam.fov - wantF) > 0.01) {
        cam.fov = THREE.MathUtils.lerp(cam.fov, wantF, 0.18)
        cam.updateProjectionMatrix()
      }
      return
    }

    // --- Free roam. Slow idle drift: a gentle sway around wherever the viewer left the camera.
    // Once the duck has pointed at something, the camera holds still for good (no idle drift).
    if (!st.intro && !quality.reducedMotion && !st.interacting && !ui.duckPointed && now - st.lastInput > IDLE_AFTER) {
      if (st.driftStart < 0) {
        // From the camera itself, not OrbitControls' cached spherical (stale until its next
        // update(): it once swung the phone home ~70° off the desk toward the default camera).
        const off = cam.position.clone().sub(c.target)
        st.driftStart = now
        st.driftAz = Math.atan2(off.x, off.z)
        st.driftPolar = Math.acos(THREE.MathUtils.clamp(off.y / Math.max(off.length(), 1e-6), -1, 1))
      }
      const t = now - st.driftStart
      const ease = THREE.MathUtils.smoothstep(t, 0, 6)
      const w = (2 * Math.PI) / DRIFT_PERIOD
      const az = st.driftAz + ease * DRIFT_AZ * Math.sin(w * t)
      const po = THREE.MathUtils.clamp(st.driftPolar + ease * DRIFT_POLAR * Math.sin(w * 1.7 * t), c.minPolarAngle, c.maxPolarAngle)
      c.setAzimuthalAngle(az)
      c.setPolarAngle(po)
    }

    // Eased FOV zoom toward base lens × zoom factor.
    const want = fovFor(size.width / size.height) * st.zoom
    if (Math.abs(cam.fov - want) > 0.01) {
      cam.fov = THREE.MathUtils.lerp(cam.fov, want, 0.18)
      cam.updateProjectionMatrix()
    }
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      // `enabled` is driven imperatively by the GSAP fly controller (off during flies + panels).
      target={look.pivot}
      enablePan={false}
      enableZoom={false}
      enableDamping
      dampingFactor={0.14}
      rotateSpeed={rotateSpeed}
      touches={{ ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }}
      minDistance={LOOK_EPS}
      maxDistance={LOOK_EPS}
      // Polar angle of the eye around the pivot: 90° = level; the eye sits behind the pivot, so
      // a smaller angle = looking down.
      minPolarAngle={Math.PI / 2 - PITCH_DOWN}
      maxPolarAngle={Math.PI / 2 + PITCH_UP}
    />
  )
}
