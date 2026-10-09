import * as THREE from 'three'

/**
 * Tolerance for an older / partial GLB: if there is no CLICK_Duck, add a procedural rubber duck
 * (PLACEHOLDER_Duck, with MAT_DuckEyes and a DUCK_BeamOrigin) on the desk so Ask the Duck still
 * has a body. Wanda's portfolio GLB has the real duck, so this does nothing there.
 */

const YELLOW = 0xf5c842
const ORANGE = 0xe8952a
const BLACK = 0x1a1410
const BEAK = 0xe07020
const EYE = 0x22ddff

function has(scene: THREE.Object3D, re: RegExp) {
  let found = false
  scene.traverse((o) => {
    if (re.test(o.name)) found = true
  })
  return found
}

export function addPlaceholders(scene: THREE.Object3D) {
  if (!has(scene, /^(CLICK_Duck|CLICK_RubberDuck|PLACEHOLDER_Duck)$/)) addDuck(scene)
}

function mat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, ...opts })
}

function addDuck(scene: THREE.Object3D) {
  // Next to the mug / keyboard, sitting on the desk top (y ≈ 0.74).
  const g = new THREE.Group()
  g.name = 'PLACEHOLDER_Duck'
  g.position.set(0.18, 0.74, 0.24)
  g.rotation.y = -0.55

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.045, 20, 16), mat(YELLOW))
  body.name = 'DuckBody'
  body.position.set(0, 0.045, 0)
  body.scale.set(1.15, 0.85, 1.3)
  g.add(body)

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.028, 16, 12), mat(YELLOW))
  head.name = 'DuckHead'
  head.position.set(0.01, 0.09, 0.035)
  g.add(head)

  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.03, 8), mat(BEAK, { roughness: 0.4 }))
  beak.name = 'DuckBeak'
  beak.rotation.z = -Math.PI / 2
  beak.position.set(0.01, 0.085, 0.06)
  g.add(beak)

  // Eyes: emissive cyan; Room.tsx registers them with LightMixer group "eyes" (thinking / agentic).
  const eyeMat = new THREE.MeshStandardMaterial({
    name: 'MAT_DuckEyes',
    color: BLACK,
    emissive: new THREE.Color(EYE),
    emissiveIntensity: 0.15,
    roughness: 0.35,
  })
  for (const [x, name] of [
    [-0.012, 'DuckEyeL'],
    [0.012, 'DuckEyeR'],
  ] as const) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 10, 8), eyeMat)
    e.name = name
    e.position.set(x, 0.098, 0.055)
    g.add(e)
  }

  // Tiny wing stubs and a flat bill-support so it reads as a duck from the side.
  const wing = mat(ORANGE)
  for (const x of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), wing)
    w.position.set(0.04 * x, 0.045, 0)
    w.scale.set(0.45, 0.7, 1.1)
    g.add(w)
  }

  // Invisible beam origin (slightly above the beak) for the cyan citation beams.
  const origin = new THREE.Object3D()
  origin.name = 'DUCK_BeamOrigin'
  origin.position.set(0.01, 0.1, 0.07)
  g.add(origin)

  scene.add(g)
}
