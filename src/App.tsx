import { Suspense, useCallback, useMemo, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { AdaptiveDpr, Environment, Lightformer, useProgress } from '@react-three/drei'
import type { RoomInfo } from './analyze'
import { CameraRig } from './CameraRig'
import { Post } from './Post'
import { RainGlass, RainStreaks } from './Rain'
import { RoomLights, RoomModel } from './Room'
import { detectQuality } from './quality'

const BACKGROUND = '#0b0b0e'

function LoadingOverlay() {
  const { progress, active } = useProgress()
  const done = !active && progress >= 100
  return (
    <div className={`loader${done ? ' done' : ''}`} aria-live="polite">
      <div className="loader-label">Loading room… {progress.toFixed(0)}%</div>
      <div className="loader-bar">
        <span style={{ width: `${progress}%` }} />
      </div>
    </div>
  )
}

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

export default function App() {
  const quality = useMemo(() => detectQuality(), [])
  const [info, setInfo] = useState<RoomInfo | null>(null)
  const onInfo = useCallback((i: RoomInfo) => setInfo(i), [])

  return (
    <>
      <Canvas
        shadows="percentage"
        dpr={[1, quality.tier === 'high' ? 2 : 1.5]}
        camera={{ position: [2, 1.4, 2.4], fov: 45, near: 0.03, far: 400 }}
        gl={{ antialias: false, powerPreference: 'high-performance', toneMapping: THREE.NoToneMapping }}
        performance={{ min: 0.6 }}
      >
        <color attach="background" args={[BACKGROUND]} />
        <AdaptiveDpr pixelated={false} />
        <Suspense fallback={null}>
          <RoomModel onInfo={onInfo} />
          <RoomEnvironment />
        </Suspense>
        {info && (
          <>
            <RoomLights info={info} quality={quality} />
            {info.glass && <RainStreaks info={info} quality={quality} />}
            {info.glass && <RainGlass info={info} quality={quality} />}
            <CameraRig info={info} quality={quality} />
            <Post quality={quality} baked={info.baked.aoMap || info.baked.lightMap} />
          </>
        )}
      </Canvas>
      <LoadingOverlay />
      <div className="hint">Drag to look around · scroll to step closer</div>
    </>
  )
}
