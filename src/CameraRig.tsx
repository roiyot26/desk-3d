import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { RoomInfo } from './analyze'
import type { Quality } from './quality'
import { getUI, setUI } from './store'
import { gsap, useGSAP } from './gsap'
import { markerTargetFor, poseFor, poseFromStopCam, type Pose } from './targets'
import { STOPS } from './content'

/** The duck's bottom sheet opens at 65% on phones (index.css .panel.duck); frame above it. */
const DUCK_SHEET = 0.65

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
const SWEEP_LANDSCAPE = Math.PI
const SWEEP_PORTRAIT = THREE.MathUtils.degToRad(130)

const IDLE_AFTER = 3.5 // seconds without input before the drift starts
const DRIFT_AZ = THREE.MathUtils.degToRad(6)
const DRIFT_POLAR = THREE.MathUtils.degToRad(0.8)
const DRIFT_PERIOD = 38 // seconds per sway
const EASE_TIME = 1.15 // seconds per camera move between stops
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
  const home = useMemo(() => homeView(info, portrait, size.width / size.height), [info, portrait, tall])

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
    saved: null as Pose | null,
    /** Destination of the running fly (so a panel opened mid-fly can still return to it). */
    flyTo: null as Pose | null,
    flyRelease: false,
    flying: false,
    focused: false,
  })

  useEffect(() => {
    const c = controls.current
    if (!c) return
    const st = state.current
    const start = () => {
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
    const free = () => !getUI().open && !st.flying && !st.focused
    const onWheel = (e: WheelEvent) => {
      if (!free()) return
      e.preventDefault()
      st.zoom = clampZ(st.zoom * Math.exp(e.deltaY * 0.0012))
      st.lastInput = performance.now() / 1000
    }
    let d0 = 0
    let z0 = 1
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        d0 = dist(e.touches)
        z0 = st.zoom
      }
    }
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !d0 || !free()) return
      e.preventDefault()
      st.zoom = clampZ(z0 * (d0 / Math.max(1, dist(e.touches))))
      st.lastInput = performance.now() / 1000
    }
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) d0 = 0
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchEnd)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
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

  useFrame(() => {
    const c = controls.current
    if (!c) return
    const st = state.current
    const now = performance.now() / 1000
    const cam = camera as THREE.PerspectiveCamera

    // --- Focus: ease to a framed view when a panel opens, back to the saved pose when it closes.
    const ui = getUI()
    const key = ui.open ? `${ui.open.id}` : ''
    if (key !== st.openKey) {
      st.openKey = key
      const t = ui.open ? markerTargetFor(ui.targets, ui.open.id) : undefined
      const stopCam = ui.open ? ui.stopCams.get(ui.open.id) : undefined
      const current: Pose = { position: cam.position.clone(), target: c.target.clone(), fov: cam.fov }
      const dur = quality.reducedMotion ? 0 : EASE_TIME
      if (t || stopCam) {
        if (!st.saved) st.saved = st.flying && st.flyRelease && st.flyTo ? st.flyTo : current
        // Blender's STOP_*_Cam framing wins (node.quaternion·Rx(-90°) / target_gltf_yup, see
        // targets.ts); otherwise frame the clicked object.
        const base = fovFor(size.width / size.height)
        const sheet = STOPS.find((x) => x.id === ui.open?.id)?.kind === 'duck' ? DUCK_SHEET : 0.5
        const to = stopCam ? poseFromStopCam(stopCam, size, sheet) : { ...poseFor(t!, { home, safe, aspect: size.width / size.height, fov: base, info }), fov: base }
        st.focused = true
        fly(current, to, dur, false)
      } else if (st.saved) {
        const back = st.saved
        st.saved = null
        fly(current, back, dur, true)
      }
    }
    // GSAP owns the camera during a fly; a panel's framed view is held still afterwards.
    if (st.flying) return
    if (st.focused) {
      cam.lookAt(c.target)
      return
    }

    // --- Free roam. Slow idle drift: a gentle sway around wherever the viewer left the camera.
    if (!quality.reducedMotion && !st.interacting && now - st.lastInput > IDLE_AFTER) {
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
      dampingFactor={0.1}
      rotateSpeed={rotateSpeed}
      minDistance={LOOK_EPS}
      maxDistance={LOOK_EPS}
      // Polar angle of the eye around the pivot: 90° = level; the eye sits behind the pivot, so
      // a smaller angle = looking down.
      minPolarAngle={Math.PI / 2 - PITCH_DOWN}
      maxPolarAngle={Math.PI / 2 + PITCH_UP}
    />
  )
}
