import * as THREE from 'three'

// Scene discovery for a replaceable GLB. Nothing here depends on exact mesh names:
// names are only hints, with geometric fallbacks, so a re-exported or baked GLB keeps working.

export type GlassFrame = {
  /** Existing glass mesh from the GLB, or null when we had to add an overlay plane. */
  mesh: THREE.Mesh | null
  center: THREE.Vector3
  /** Unit vectors spanning the pane (right, up) and the normal pointing into the room. */
  right: THREE.Vector3
  up: THREE.Vector3
  normal: THREE.Vector3
  width: number
  height: number
}

export type PointHint = { position: THREE.Vector3; color: THREE.Color; name: string }

export type RoomInfo = {
  /** Interior volume (walls + floor), used to keep the camera inside. */
  room: THREE.Box3
  glass: GlassFrame | null
  /** Meshes outside the room (city, sky, rain): they also go on layer 1 for the window pass. */
  exterior: THREE.Object3D[]
  bulbs: PointHint[]
  neon: PointHint[]
  focus: THREE.Vector3
  hasCeiling: boolean
  baked: { lightMap: boolean; aoMap: boolean }
}

const tmpBox = new THREE.Box3()
const tmpV = new THREE.Vector3()

function meshes(root: THREE.Object3D) {
  const out: THREE.Mesh[] = []
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh)
  })
  return out
}

function materialsOf(m: THREE.Mesh): THREE.Material[] {
  return Array.isArray(m.material) ? m.material : [m.material]
}

/** Name of the mesh plus its parent chain (multi-primitive nodes become a Group of meshes). */
function fullName(o: THREE.Object3D) {
  let s = ''
  for (let p: THREE.Object3D | null = o; p; p = p.parent) s += ' ' + p.name
  return s
}

function worldBox(o: THREE.Object3D) {
  return new THREE.Box3().setFromObject(o)
}

export function frameFromBox(box: THREE.Box3, roomCenter: THREE.Vector3, mesh: THREE.Mesh | null): GlassFrame {
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  // The thinnest horizontal axis is the pane normal (windows are vertical).
  const normal = size.x < size.z ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1)
  if (tmpV.subVectors(roomCenter, center).dot(normal) < 0) normal.negate()
  const up = new THREE.Vector3(0, 1, 0)
  const right = new THREE.Vector3().crossVectors(up, normal).normalize()
  const width = Math.abs(size.dot(right))
  return { mesh, center, right, up, normal, width, height: size.y }
}

export function analyzeScene(scene: THREE.Object3D): RoomInfo {
  scene.updateMatrixWorld(true)
  const all = meshes(scene)

  // 1) Room box: walls + floor if named, else everything that is human-scale.
  const room = new THREE.Box3()
  for (const m of all) if (/wall|floor/i.test(fullName(m))) room.union(worldBox(m))
  if (room.isEmpty()) {
    for (const m of all) {
      tmpBox.setFromObject(m)
      const s = tmpBox.getSize(tmpV)
      if (Math.max(s.x, s.y, s.z) < 12) room.union(tmpBox)
    }
  }
  const roomCenter = room.getCenter(new THREE.Vector3())

  // 2) Exterior = meshes whose bounds do not touch the room.
  const exterior: THREE.Object3D[] = []
  const grown = room.clone().expandByScalar(0.02)
  for (const m of all) if (!grown.intersectsBox(tmpBox.setFromObject(m))) exterior.push(m)

  // 3) Glass: transmission / transparent / named glass, largest area wins.
  let glass: GlassFrame | null = null
  let best = 0
  for (const m of all) {
    if (exterior.includes(m)) continue
    const mats = materialsOf(m) as THREE.MeshPhysicalMaterial[]
    const glassy =
      /glass|pane/i.test(fullName(m)) ||
      mats.some((mt) => (mt.transmission ?? 0) > 0 || /glass/i.test(mt.name) || (mt.transparent && mt.opacity < 0.7))
    if (!glassy) continue
    const b = worldBox(m)
    const s = b.getSize(tmpV)
    const area = Math.max(s.x * s.y, s.z * s.y)
    if (area > best && s.y > 0.3) {
      best = area
      glass = frameFromBox(b, roomCenter, m)
    }
  }
  // Fallback: no pane in the export, but a window frame is there -> overlay plane in its opening.
  if (!glass) {
    const winBox = new THREE.Box3()
    for (const m of all) if (!exterior.includes(m) && /^win|window/i.test(m.name)) winBox.union(worldBox(m))
    if (!winBox.isEmpty()) glass = frameFromBox(winBox, roomCenter, null)
  }

  // 4) Light hints from emissive materials (no lights are exported from Blender).
  const bulbs: PointHint[] = []
  const neon: PointHint[] = []
  for (const m of all) {
    if (exterior.includes(m)) continue
    const mt = materialsOf(m)[0] as THREE.MeshStandardMaterial
    if (!mt?.emissive) continue
    const name = fullName(m) + ' ' + mt.name
    const strength = Math.max(mt.emissive.r, mt.emissive.g, mt.emissive.b) * (mt.emissiveIntensity ?? 1)
    if (strength < 0.5) continue
    const position = worldBox(m).getCenter(new THREE.Vector3())
    const color = mt.emissive.clone()
    if (/bulb/i.test(name)) bulbs.push({ position, color, name: m.name })
    else if (/neon|led/i.test(name)) neon.push({ position, color, name: m.name })
  }

  // 5) Focus point: the desk top if we can find it, else room centre at desk height.
  let focus = roomCenter.clone().setY(room.min.y + 0.95)
  const desk = all.find((m) => /desk.?top/i.test(m.name)) ?? all.find((m) => /desk/i.test(m.name))
  if (desk) focus = worldBox(desk).getCenter(new THREE.Vector3())

  let lightMap = false
  let aoMap = false
  for (const m of all)
    for (const mt of materialsOf(m) as THREE.MeshStandardMaterial[]) {
      if (mt.lightMap || /bake|lightmap/i.test(mt.name)) lightMap = true
      if (mt.aoMap) aoMap = true
    }

  const hasCeiling = all.some((m) => /ceiling|roof/i.test(m.name))
  return { room, glass, exterior, bulbs, neon, focus, hasCeiling, baked: { lightMap, aoMap } }
}
