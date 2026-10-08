import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer } from '@react-three/drei'
import type { RoomInfo } from './analyze'
import { audio } from './audio'
import { readBake } from './bake/assets'
import { BakedLighting, preloadBakeTextures } from './bake/BakedLighting'
import { CameraRig } from './CameraRig'
import { DuckRig } from './duck/DuckRig'
import { KeyPresser } from './keyboard'
import { LightMixer } from './LightMixer'
import { Hotspots } from './Hotspots'
import { setCanvasElement } from './interact'
import { Overlay } from './Overlay'
import { Post, RendererToneMapping } from './Post'
import { RainGlass, RainStreaks } from './Rain'
import { BakedCeiling, RoomLights, RoomModel, glbRain, roomScene } from './Room'
import { qualityFor, type Tier } from './quality'
import { getUI, setUI, useUI } from './store'

// The whole 3D experience. Loaded as its own chunk so ?view=list stays light.

const BACKGROUND = '#0b0b0e'
/** Wanda's bake was graded at 2^0.72 in Cycles (README_FORGE.md). */
const BAKE_EXPOSURE = 1.65

/** Dim, local (no network) environment for reflections: warm lamp side, cool window side. */
function RoomEnvironment() {
  return (
    <Environment resolution={64} frames={1} environmentIntensity={0.35}>
      <color attach="background" args={['#0d0b0b']} />
      <Lightformer form="rect" color="#ffb070" intensity={1.2} position={[-3, 1.5, 2]} scale={[2, 1.5, 1]} target={[0, 1, 0]} />
      <Lightformer form="rect" color="#9fb6ff" intensity={0.6} position={[1, 1.5, -3]} scale={[2, 1.4, 1]} target={[0, 1, 0]} />
      <Lightformer form="rect" color="#3a3030" intensity={0.4} position={[0, 4, 0]} scale={[4, 4, 1]} target={[0, 0, 0]} />
    </Environment>
  )
}

/** Room is "ready" once its shaders are compiled (async where the browser allows) and 3 frames drew. */
function ReadyGate() {
  const { gl, scene, camera } = useThree()
  useEffect(() => {
    let alive = true
    setUI({ stage: 'compile', progress: 1 })
    const done = () => {
      let frames = 0
      const tick = () => {
        if (!alive) return
        if (++frames >= 3) setUI({ stage: 'ready' })
        else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }
    // Let the loader paint "Warming up the lights" before a possibly synchronous compile.
    const id = window.setTimeout(() => {
      const p = gl.compileAsync ? gl.compileAsync(scene, camera) : Promise.resolve()
      p.then(done, done)
    }, 50)
    return () => {
      alive = false
      window.clearTimeout(id)
    }
  }, [gl, scene, camera])
  return null
}

/**
 * Auto quality: if the frame rate stays under 30 fps for 3 seconds, step down one level:
 * 1 = post off, 2 = rain particles off, 3 = DPR 1. Off when ?quality= forces a tier.
 */
function QualityGovernor({ enabled }: { enabled: boolean }) {
  const s = useRef({ start: 0, frames: 0, slow: 0, grace: 0 })
  useFrame(() => {
    const st = s.current
    const now = performance.now()
    if (!enabled || getUI().stage !== 'ready') {
      st.start = now
      st.frames = 0
      st.slow = 0
      st.grace = now + 3000 // ignore the first seconds (shader warm-up, texture uploads)
      return
    }
    st.frames++
    const dt = now - st.start
    if (dt < 1000) return
    const fps = (st.frames * 1000) / dt
    st.frames = 0
    st.start = now
    if (now < st.grace) return
    st.slow = fps < 30 ? st.slow + 1 : 0
    const level = getUI().degrade
    if (st.slow >= 3 && level < 3) {
      setUI({ degrade: level + 1 })
      console.info(`[desk-3d] ${fps.toFixed(0)} fps for 3 s: quality step ${level + 1} (${['', 'post off', 'rain particles off', 'DPR 1'][level + 1]})`)
      st.slow = 0
      st.grace = now + 2500
    }
  })
  return null
}

/** Feeds the audio mix: rain gets louder near the window, the neon hum is only heard near the sign. */
function AudioSpatial({ info }: { info: RoomInfo }) {
  const targets = useUI((s) => s.targets)
  const neon = useMemo(() => {
    const t = targets.get('career')
    if (t) return t.center.clone()
    return info.neon[0]?.position.clone() ?? null
  }, [targets, info])
  const n = useRef(0)
  useFrame(({ camera }) => {
    if (++n.current % 8) return
    const near = (p: THREE.Vector3 | null | undefined, full: number, zero: number) =>
      p ? THREE.MathUtils.clamp(1 - (camera.position.distanceTo(p) - full) / (zero - full), 0, 1) : 0
    audio.setNear(near(info.glass?.center, 1.0, 4.5), near(neon, 0.6, 2.6))
  })
  return null
}

/** Blender's static rain cards stand in for the particle rain once auto-quality turns it off. */
function GlbRain({ particles }: { particles: boolean }) {
  const rain = useUI((s) => s.rain)
  useEffect(() => {
    for (const m of glbRain) m.visible = rain && !particles
  }, [rain, particles])
  return null
}

function DprCap({ max }: { max: number }) {
  const setDpr = useThree((s) => s.setDpr)
  useEffect(() => setDpr(Math.min(window.devicePixelRatio || 1, max)), [setDpr, max])
  return null
}

type Fatal = (reason: string) => void

/** Live path: errors go to the app boundary (plain page) exactly as before. */
function MaybeBakeBoundary({ bake, onError, children }: { bake: boolean; onError: () => void; children: ReactNode }) {
  return bake ? <BakeBoundary onError={onError}>{children}</BakeBoundary> : <>{children}</>
}

/** A broken bake package (missing GLB / lightmap, bad KTX2) drops to the live-light path, not the plain page. */
class BakeBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(e: unknown) {
    console.warn('[desk-3d] bake package failed to load, using live lights.', e)
    this.props.onError()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

export default function Experience({ onFatal, initialTier }: { onFatal: Fatal; initialTier: Tier }) {
  // Baked package in public/bake/? (Inlined at build time; null = live-light path.)
  const manifest = readBake()
  const [bakeFailed, setBakeFailed] = useState(false)
  const bake = bakeFailed ? null : manifest
  const [bakeReady, setBakeReady] = useState(false)
  const onBakeReady = useCallback(() => setBakeReady(true), [])
  const onBakeError = useCallback(() => {
    setBakeFailed(true)
    setInfo(null)
  }, [])
  const [attempt, setAttempt] = useState({ n: 0, tier: initialTier })
  const quality = useMemo(() => qualityFor(attempt.tier), [attempt.tier])
  const [info, setInfo] = useState<RoomInfo | null>(null)
  const onInfo = useCallback((i: RoomInfo) => setInfo(i), [])
  const degrade = useUI((s) => s.degrade)
  const failed = useRef(-1)

  // Shader compile failure or a lost context: retry once in safe mode (no post, no shadows,
  // Lambert materials) on a fresh canvas. If safe mode fails too, show the plain page.
  const fail = useCallback(
    (reason: string) => {
      if (failed.current === attempt.n) return
      failed.current = attempt.n
      console.warn(`[desk-3d] WebGL problem (${reason}) on tier ${attempt.tier}.`)
      if (attempt.tier !== 'low') {
        setUI({ stage: 'compile', degrade: 0 })
        setInfo(null)
        setBakeReady(false)
        setAttempt({ n: attempt.n + 1, tier: 'low' })
      } else onFatal(reason)
    },
    [attempt, onFatal],
  )
  const failRef = useRef(fail)
  failRef.current = fail

  const postOn = quality.post !== 'none' && degrade < 1
  const dprMax = degrade >= 3 ? 1 : quality.dprMax

  return (
    <>
      <Canvas
        key={`${attempt.n}-${bake ? 'bake' : 'live'}`}
        shadows={quality.shadows ? 'percentage' : false}
        dpr={[1, quality.dprMax]}
        camera={{ position: [2, 1.4, 2.4], fov: 45, near: 0.03, far: 400 }}
        gl={{ antialias: false, powerPreference: 'high-performance', toneMapping: THREE.NoToneMapping }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace
          if (bake) preloadBakeTextures(gl, bake)
          gl.debug.onShaderError = (ctx, program) => {
            console.warn('[desk-3d] shader program failed to link:', ctx.getProgramInfoLog(program) || '(no log)')
            failRef.current('shader')
          }
          const el = gl.domElement
          el.addEventListener('webglcontextlost', (e) => {
            e.preventDefault()
            failRef.current('context-lost')
          })
          setCanvasElement(el)
          el.style.cursor = 'grab'
        }}
      >
        <color attach="background" args={[BACKGROUND]} />
        <DprCap max={dprMax} />
        <RendererToneMapping post={postOn} exposure={bake ? BAKE_EXPOSURE : undefined} />
        <MaybeBakeBoundary bake={!!bake} onError={onBakeError}>
          <Suspense fallback={null}>
            <RoomModel onInfo={onInfo} quality={quality} bake={bake} />
            {/* Live path: drei's local Lightformer env. Baked: Wanda's room_env.ktx2 (BakedLighting). */}
            {!bake && <RoomEnvironment />}
          </Suspense>
          {/* Own boundary: while the lightmaps finish, the room stays mounted (ReadyGate waits). */}
          {bake && info && roomScene && (
            <Suspense fallback={null}>
              <BakedLighting manifest={bake} room={roomScene} lowRes={quality.tier !== 'high'} onReady={onBakeReady} />
            </Suspense>
          )}
        </MaybeBakeBoundary>
        {info && (
          <>
            {bake ? <BakedCeiling info={info} /> : <RoomLights info={info} quality={quality} />}
            {info.glass && degrade < 2 && <RainStreaks info={info} quality={quality} />}
            {info.glass && <RainGlass info={info} quality={quality} />}
            <CameraRig info={info} quality={quality} />
            <Hotspots />
            <LightMixer />
            <KeyPresser />
            <DuckRig />
            <AudioSpatial info={info} />
            <GlbRain particles={!!info.glass && degrade < 2} />
            {postOn && <Post quality={quality} baked={!!bake || info.baked.aoMap || info.baked.lightMap} />}
            {(!bake || bakeReady) && <ReadyGate key={attempt.n} />}
            <QualityGovernor enabled={!quality.forced} />
          </>
        )}
      </Canvas>
      <Overlay />
    </>
  )
}

