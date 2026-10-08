import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import {
  Bounds,
  Center,
  ContactShadows,
  Environment,
  Html,
  OrbitControls,
  useGLTF,
  useProgress,
} from '@react-three/drei'

const MODEL_URL = `${import.meta.env.BASE_URL}desk.glb`
const BACKGROUND = '#eeece8'

function Loader() {
  const { progress } = useProgress()
  return (
    <Html center>
      <div className="loader">Loading desk… {progress.toFixed(0)}%</div>
    </Html>
  )
}

function Desk() {
  // Generic load: no mesh names assumed, materials untouched (keeps emissive screens).
  const { scene } = useGLTF(MODEL_URL)
  scene.traverse((obj) => {
    obj.castShadow = true
    obj.receiveShadow = true
  })
  return <primitive object={scene} />
}

export default function App() {
  return (
    <>
      <Canvas
        camera={{ position: [3, 2.2, 3], fov: 40, near: 0.01, far: 200 }}
        dpr={[1, 2]}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
      >
        <color attach="background" args={[BACKGROUND]} />
        <ambientLight intensity={0.25} />
        <directionalLight position={[4, 6, 3]} intensity={0.8} />
        <Suspense fallback={<Loader />}>
          <Bounds fit clip observe margin={1.35}>
            <Center top>
              <Desk />
            </Center>
          </Bounds>
          <ContactShadows position={[0, 0, 0]} opacity={0.45} scale={12} blur={2.4} far={4} resolution={1024} />
          <Environment preset="apartment" />
        </Suspense>
        <OrbitControls
          makeDefault
          autoRotate
          autoRotateSpeed={0.6}
          enablePan={false}
          enableDamping
          minDistance={1.5}
          maxDistance={8}
          minPolarAngle={0.2}
          maxPolarAngle={Math.PI / 2 - 0.05}
        />
      </Canvas>
      <div className="hint">Drag to orbit · scroll to zoom</div>
    </>
  )
}

useGLTF.preload(MODEL_URL)
