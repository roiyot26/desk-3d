import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { RoomInfo } from './analyze'
import type { Quality } from './quality'
import { getUI, useUI } from './store'
import { markerTargetFor, poseFor, type Pose } from './targets'

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
export function homeView(info: RoomInfo, portrait: boolean): Pose {
  const r = info.room
  const floor = r.min.y
  if (portrait) {
    const win = info.glass?.center ?? info.focus
    const position = new THREE.Vector3(THREE.MathUtils.lerp(r.min.x, r.max.x, 0.6), floor + EYE_HEIGHT, r.max.z - 0.45)
    const target = new THREE.Vector3((info.focus.x + win.x) / 2, floor + 1.1, info.focus.z - 0.4)
    return { position, target }
  }
  const position = new THREE.Vector3(r.max.x - 0.6, floor + EYE_HEIGHT, r.max.z - 0.55)
  const target = new THREE.Vector3(info.focus.x - 0.15, floor + 1.08, info.focus.z - 0.35)
  return { position, target }
}

const IDLE_AFTER = 3.5 // seconds without input before the drift starts
const DRIFT_AZ = THREE.MathUtils.degToRad(6)
const DRIFT_POLAR = THREE.MathUtils.degToRad(0.8)
const DRIFT_PERIOD = 38 // seconds per sway
const EASE_TIME = 1.15 // seconds per camera move between stops

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export function CameraRig({ info, quality }: { info: RoomInfo; quality: Quality }) {
  const { camera, size } = useThree()
  const controls = useRef<OrbitControlsImpl>(null)
  const portrait = size.width / size.height < 0.85
  const home = useMemo(() => homeView(info, portrait), [info, portrait])

  // Orbit limits relative to the home view (a little more vertical range than before).
  const limits = useMemo(() => {
    const off = home.position.clone().sub(home.target)
    const s = new THREE.Spherical().setFromVector3(off)
    return {
      dist: s.radius,
      minAz: s.theta - THREE.MathUtils.degToRad(portrait ? 30 : 42),
      maxAz: s.theta + THREE.MathUtils.degToRad(portrait ? 22 : 20),
      minPolar: s.phi - THREE.MathUtils.degToRad(20),
      maxPolar: Math.min(s.phi + THREE.MathUtils.degToRad(12), THREE.MathUtils.degToRad(98)),
    }
  }, [home, portrait])

  // Safe camera volume: inside the walls, above the furniture line, below the ceiling.
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

  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera
    cam.position.copy(home.position)
    cam.near = 0.03
    cam.far = 400
    cam.lookAt(home.target)
    controls.current?.target.copy(home.target)
    controls.current?.update()
  }, [camera, home])

  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera
    cam.fov = fovFor(size.width / size.height)
    cam.updateProjectionMatrix()
  }, [camera, size])

  const state = useRef({
    desired: 0,
    lastSet: 0,
    interacting: false,
    lastInput: -100,
    driftStart: -1,
    driftAz: 0,
    driftPolar: 0,
    // Focus (panel / tour) state.
    openKey: '',
    saved: null as Pose | null,
    anim: null as { from: Pose; to: Pose; t0: number; dur: number; release: boolean } | null,
    focused: false,
  })

  useEffect(() => {
    const c = controls.current
    if (!c) return
    const st = state.current
    const start = () => {
      st.interacting = true
      st.driftStart = -1
    }
    const end = () => {
      st.interacting = false
      st.lastInput = performance.now() / 1000
    }
    c.addEventListener('start', start)
    c.addEventListener('end', end)
    return () => {
      c.removeEventListener('start', start)
      c.removeEventListener('end', end)
    }
  }, [])

  const tmp = useMemo(() => new THREE.Vector3(), [])
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
      const current: Pose = { position: cam.position.clone(), target: c.target.clone() }
      const dur = quality.reducedMotion ? 0 : EASE_TIME
      if (t) {
        if (!st.saved) st.saved = st.anim?.release ? st.anim.to : current
        const to = poseFor(t, { home, safe, aspect: size.width / size.height, fov: cam.fov, info })
        st.anim = { from: current, to, t0: now, dur, release: false }
        st.focused = true
      } else if (st.saved) {
        st.anim = { from: current, to: st.saved, t0: now, dur, release: true }
        st.saved = null
      }
    }
    if (st.anim) {
      const a = st.anim
      const k = a.dur > 0 ? Math.min((now - a.t0) / a.dur, 1) : 1
      const e = easeInOut(k)
      cam.position.lerpVectors(a.from.position, a.to.position, e)
      c.target.lerpVectors(a.from.target, a.to.target, e)
      cam.lookAt(c.target)
      if (k >= 1) {
        st.anim = null
        if (a.release) {
          st.focused = false
          st.desired = 0
          st.lastSet = 0
          st.driftStart = -1
          st.lastInput = now
        }
      }
      return
    }
    if (st.focused) {
      cam.lookAt(c.target)
      return
    }

    // --- Free roam. Slow idle drift: a gentle sway around wherever the viewer left the camera.
    if (!quality.reducedMotion && !st.interacting && now - st.lastInput > IDLE_AFTER) {
      if (st.driftStart < 0) {
        st.driftStart = now
        st.driftAz = c.getAzimuthalAngle()
        st.driftPolar = c.getPolarAngle()
      }
      const t = now - st.driftStart
      const ease = THREE.MathUtils.smoothstep(t, 0, 6)
      const w = (2 * Math.PI) / DRIFT_PERIOD
      const az = THREE.MathUtils.clamp(st.driftAz + ease * DRIFT_AZ * Math.sin(w * t), limits.minAz, limits.maxAz)
      const po = THREE.MathUtils.clamp(st.driftPolar + ease * DRIFT_POLAR * Math.sin(w * 1.7 * t), limits.minPolar, limits.maxPolar)
      c.setAzimuthalAngle(az)
      c.setPolarAngle(po)
    }

    // Keep the camera inside the room. Track the distance the viewer asked for (zoom), then
    // pull the camera toward the target along the view ray whenever that would leave the room.
    const target = c.target
    const dist = camera.position.distanceTo(target)
    if (st.desired === 0) st.desired = dist
    else if (st.lastSet > 0) st.desired *= dist / st.lastSet
    st.desired = THREE.MathUtils.clamp(st.desired, c.minDistance, c.maxDistance)
    tmp.subVectors(camera.position, target).normalize()
    let s = st.desired
    for (const a of ['x', 'y', 'z'] as const) {
      const d = tmp[a]
      if (d > 1e-5) s = Math.min(s, (safe.max[a] - target[a]) / d)
      else if (d < -1e-5) s = Math.min(s, (safe.min[a] - target[a]) / d)
    }
    s = Math.max(s, 0.4)
    camera.position.copy(target).addScaledVector(tmp, s)
    st.lastSet = s
  })

  const focused = useFocused()
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enabled={!focused}
      target={home.target}
      enablePan={false}
      enableDamping
      dampingFactor={0.12}
      // Negative speed: the room follows the cursor ("grab the world"), which is what a
      // first-person interior look feels like. Positive made the window slide against the drag.
      rotateSpeed={-0.55}
      zoomSpeed={0.6}
      minDistance={1.1}
      maxDistance={limits.dist + 0.2}
      minAzimuthAngle={limits.minAz}
      maxAzimuthAngle={limits.maxAz}
      minPolarAngle={limits.minPolar}
      maxPolarAngle={limits.maxPolar}
    />
  )
}

function useFocused() {
  // Controls are off while a panel owns the camera (and during the ease back).
  return useUI((s) => s.open !== null)
}
