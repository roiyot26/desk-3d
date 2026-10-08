import * as THREE from 'three'
import { content } from './content'
import { FORGE_CLICKS, stopCamsFromManifest } from './content/forge'
import type { RoomInfo } from './analyze'

/**
 * Click targets.
 *
 * Convention (Blender side): every interactive object is a top-level EMPTY named `CLICK_<Thing>`
 * with its meshes as children. A raycast hit walks up the parents to the nearest registered node,
 * so any child mesh opens the target.
 *
 * Wanda's portfolio GLB (public/desk.glb) carries every CLICK_* below, so none of them needs a
 * mesh-name fallback any more. Fallbacks are kept only for optional things that are genuinely not
 * in the export:
 *   - the two artworks (no CLICK_ on purpose: they are just art from the real room; hovering shows
 *     a one-word label and a click shows a tiny "From the real room." caption, nothing else),
 *   - the duck: if CLICK_Duck ever goes missing, Room.tsx adds a procedural PLACEHOLDER_Duck,
 *   - the sculpture bonus (no such object in this GLB: skipped silently).
 * A target with no match is skipped silently (no marker, no hit area); its panel stays reachable
 * from the progress dots, the deep links and the plain list.
 *
 *   stop-1  CLICK_Monitor_Projects                      camera STOP_1_Desk_Cam
 *   stop-2  CLICK_Laptop_3D, CLICK_Frame_3DRender        camera STOP_2_Laptop_Cam
 *   stop-3  CLICK_Book_<Skill> (one per skill)           camera STOP_3_Bookshelf_Cam
 *   stop-4  CLICK_Terrarium_VirtualGarden                camera STOP_4_Terrarium_Cam
 *   stop-5  CLICK_Chalkboard_Career (the cork board)     camera STOP_5_Corkboard_Cam
 *   stop-6  CLICK_Mug_Contact                            camera STOP_6_Mug_Cam
 *   duck    CLICK_Duck (morph "Quack", MAT_DuckEyes, DUCK_BeamOrigin)  camera STOP_7_Duck_Cam
 *   aside   CLICK_StickyNote_NowBuilding
 *   actions (no panel, they change the room):
 *           CLICK_Switch_Lights   all room lights        CLICK_Lamp_Desk / CLICK_Lamp_Floor  one lamp
 *           CLICK_Window_Latch    rain on / off          CLICK_Neon_Sign                     neon blink
 *   captions  Poster_* / PosterFrame_* and ArtPan*: "From the real room."
 * Ignored on purpose: STOP_8_Art_Cam / STOP_8_Marker and every PLACARD_* node (hidden by Room.tsx).
 */
export type TargetAction = 'lights-all' | 'lamp-desk' | 'lamp-floor' | 'rain' | 'neon' | 'caption'

export type TargetDef = {
  /** Unique key of this hit target. */
  key: string
  /** Panel it opens: a stop id, a bonus id or an aside id from content.json (or a label id for actions). */
  id: string
  click: (string | RegExp)[]
  fallback?: RegExp
  /** This target carries the numbered tour marker for its stop. */
  marker?: boolean
  skill?: string
  project?: string
  /** Optional camera direction (object -> camera) and distance factor, used when no STOP_*_Cam exists. */
  view?: [number, number, number]
  distance?: number
  /** Nudge the marker / label away from a neighbour (world metres). */
  markerOffset?: [number, number, number]
  /** Toggle something in the room instead of opening a panel. */
  action?: TargetAction
}

const books: TargetDef[] = [content.skills.featured, ...content.skills.items]
  .filter((s) => s.book)
  .map((s, i) => ({ key: `book-${s.id}`, id: 'stop-3', click: [`CLICK_Book_${s.book}`], skill: s.id, marker: i === 0 }))

export const TARGET_DEFS: TargetDef[] = [
  { key: 'monitor', id: 'stop-1', marker: true, click: ['CLICK_Monitor_Projects'], view: [0.25, 0.25, 1] },
  { key: 'laptop', id: 'stop-2', marker: true, click: ['CLICK_Laptop_3D'], view: [0.35, 0.45, 1], distance: 1.25 },
  { key: 'frame', id: 'stop-2', click: ['CLICK_Frame_3DRender'], view: [-1, 0.1, 0.2] },
  ...books,
  { key: 'terrarium', id: 'stop-4', marker: true, click: ['CLICK_Terrarium_VirtualGarden'], view: [0.2, 0.45, 1], distance: 1.4 },
  { key: 'career', id: 'stop-5', marker: true, click: ['CLICK_Chalkboard_Career', 'CLICK_CorkBoard_Career', 'CLICK_Corkboard_Career'], view: [-1, 0, 0.3] },
  { key: 'mug', id: 'stop-6', marker: true, click: ['CLICK_Mug_Contact'], view: [0.5, 0.6, 1], distance: 1.6 },
  {
    key: 'duck',
    id: 'bonus-duck',
    click: ['CLICK_Duck', 'CLICK_RubberDuck'],
    fallback: /^PLACEHOLDER_Duck$/,
    // Pulled back so the duck's beams to the monitor / shelf / board stay in frame.
    view: [0.45, 0.35, 1],
    distance: 5,
  },
  { key: 'sticky', id: 'aside-now-building', click: ['CLICK_StickyNote_NowBuilding'] },
  { key: 'switch', id: 'action-lights', action: 'lights-all', click: ['CLICK_Switch_Lights'] },
  { key: 'lamp-desk', id: 'action-lamp-desk', action: 'lamp-desk', click: ['CLICK_Lamp_Desk'] },
  { key: 'lamp-floor', id: 'action-lamp-floor', action: 'lamp-floor', click: ['CLICK_Lamp_Floor'] },
  { key: 'latch', id: 'action-rain', action: 'rain', click: ['CLICK_Window_Latch'] },
  { key: 'neon', id: 'action-neon', action: 'neon', click: ['CLICK_Neon_Sign'] },
  { key: 'poster', id: 'caption-poster', action: 'caption', click: ['CLICK_Art_Poster'], fallback: /^(Poster_\w+|PosterFrame_\w+)$/ },
  { key: 'pan', id: 'caption-pan', action: 'caption', click: ['CLICK_Art_Pan'], fallback: /^ArtPan(_\w+)?$/ },
  { key: 'sculpture', id: 'bonus-sculpture', click: ['CLICK_Art_Sculpture'], fallback: /^Sculpt(Ico|Plinth)$/, view: [0.3, 0.1, 1] },
]

/**
 * Names the duck's presets may use for things that are several CLICK_* targets in the model
 * (the bookshelf is eight books): resolved to that stop's marker target.
 */
const KEY_ALIASES: Record<string, string> = { bookshelf: 'stop-3', 'desk-books': 'stop-3', books: 'stop-3', corkboard: 'stop-5' }

export function targetByKey(targets: Map<string, Target>, key: string): Target | undefined {
  return targets.get(key) ?? (KEY_ALIASES[key] ? markerTargetFor(targets, KEY_ALIASES[key]) : undefined)
}

/** Blender tour cameras: STOP_<n>_<Name>_Cam -> panel id. Built from forge_manifest (STOP_1..7; duck=7). STOP_8 ignored. */
export const STOP_CAMS: Record<number, string> = stopCamsFromManifest()

export type StopCam = { position: THREE.Vector3; target: THREE.Vector3; hfov: number }

/**
 * Reads STOP_*_Cam empties. Convention: the node looks down its local -Y with local -Z up, and
 * userData (glTF extras) has `target_gltf_yup` (look-at point), `fov_mm` and `sensor_mm` (36).
 * We use position + look-at, and the horizontal FOV of that lens: 2·atan(sensor / 2 / fov_mm).
 */
export function resolveStopCams(scene: THREE.Object3D): Map<string, StopCam> {
  const out = new Map<string, StopCam>()
  scene.updateMatrixWorld(true)
  scene.traverse((o) => {
    const m = o.name.match(/^STOP_(\d+)_\w+_Cam$/)
    if (!m) return
    const id = STOP_CAMS[Number(m[1])]
    if (!id) return
    const position = o.getWorldPosition(new THREE.Vector3())
    const ud = o.userData as { target_gltf_yup?: number[]; fov_mm?: number; sensor_mm?: number }
    let target: THREE.Vector3
    if (Array.isArray(ud.target_gltf_yup) && ud.target_gltf_yup.length === 3) target = new THREE.Vector3(...(ud.target_gltf_yup as [number, number, number]))
    else {
      // camera.quaternion = node.quaternion * Rx(-90°): -Y becomes the view direction.
      const q = o.getWorldQuaternion(new THREE.Quaternion()).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2))
      target = position.clone().add(new THREE.Vector3(0, 0, -1).applyQuaternion(q))
    }
    const hfov = 2 * Math.atan((ud.sensor_mm ?? 36) / 2 / (ud.fov_mm ?? 30))
    out.set(id, { position, target, hfov })
  })
  return out
}

export type Target = {
  key: string
  id: string
  def: TargetDef
  source: 'click' | 'fallback'
  nodes: THREE.Object3D[]
  box: THREE.Box3
  center: THREE.Vector3
  /** Where the marker / hover label sits (just above the object). */
  anchor: THREE.Vector3
  /** Invisible hit box for small objects (mug, duck...) so they are easy to tap. */
  proxy: THREE.Box3 | null
}

/** node -> target key, used by the raycast walk-up. */
export const nodeToKey = new WeakMap<THREE.Object3D, string>()

function matches(name: string, list: (string | RegExp)[]) {
  return list.some((p) => (typeof p === 'string' ? p === name : p.test(name)))
}

export function resolveTargets(scene: THREE.Object3D): Map<string, Target> {
  scene.updateMatrixWorld(true)
  const all: THREE.Object3D[] = []
  scene.traverse((o) => all.push(o))
  const claimed = new Set<THREE.Object3D>()
  const out = new Map<string, Target>()

  const build = (def: TargetDef, nodes: THREE.Object3D[], source: Target['source']) => {
    const box = new THREE.Box3()
    for (const n of nodes) box.union(new THREE.Box3().setFromObject(n))
    if (box.isEmpty()) return
    for (const n of nodes) {
      nodeToKey.set(n, def.key)
      n.traverse((c) => claimed.add(c))
    }
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const anchor = new THREE.Vector3(center.x, box.max.y + 0.07, center.z)
    if (def.markerOffset) anchor.add(new THREE.Vector3(...def.markerOffset))
    let proxy: THREE.Box3 | null = null
    if (Math.max(size.x, size.y, size.z) < 0.2) {
      proxy = new THREE.Box3().setFromCenterAndSize(center, size.clone().max(new THREE.Vector3(0.18, 0.18, 0.18)))
    }
    out.set(def.key, { key: def.key, id: def.id, def, source, nodes, box, center, anchor, proxy })
  }

  // 1) CLICK_* empties (they win). Prefer names Wanda listed in forge_manifest; missing names are fine.
  for (const def of TARGET_DEFS) {
    if (!def.click.length) continue
    const preferred = def.click.filter((p) => typeof p === 'string' && (FORGE_CLICKS.size === 0 || FORGE_CLICKS.has(p)))
    const patterns = preferred.length ? preferred : def.click
    const nodes = all.filter((o) => matches(o.name, patterns))
    if (nodes.length) build(def, nodes, 'click')
    else if (patterns !== def.click) {
      const fallback = all.filter((o) => matches(o.name, def.click))
      if (fallback.length) build(def, fallback, 'click')
    }
  }
  // 2) Name heuristics on the current GLB, skipping anything a CLICK_ target owns.
  const hasClickFor = new Set([...out.values()].map((t) => t.id))
  for (const def of TARGET_DEFS) {
    if (out.has(def.key) || !def.fallback) continue
    // A stop that already has a CLICK_ target doesn't need its fallback marker.
    if (def.marker && hasClickFor.has(def.id)) continue
    const nodes = all.filter((o) => def.fallback!.test(o.name) && !claimed.has(o))
    // Keep top-most matches only (a matched group already contains its children).
    const top = nodes.filter((n) => !nodes.some((m) => m !== n && isAncestor(m, n)))
    if (top.length) build(def, top, 'fallback')
  }
  // Markers: if the CLICK_ target of a stop isn't flagged as the marker (e.g. only books exist),
  // the first resolved target for that stop carries it.
  for (const s of content.stops) {
    const ts = [...out.values()].filter((t) => t.id === s.id)
    if (ts.length && !ts.some((t) => t.def.marker)) ts[0].def = { ...ts[0].def, marker: true }
  }
  return out
}

function isAncestor(a: THREE.Object3D, b: THREE.Object3D) {
  for (let p = b.parent; p; p = p.parent) if (p === a) return true
  return false
}

/** Raycast hit -> nearest registered ancestor -> target key. */
export function keyForObject(o: THREE.Object3D | null): string | null {
  for (let p = o; p; p = p.parent) {
    const k = nodeToKey.get(p)
    if (k) return k
  }
  return null
}

export function markerTargetFor(targets: Map<string, Target>, id: string): Target | undefined {
  const list = [...targets.values()].filter((t) => t.id === id)
  return list.find((t) => t.def.marker) ?? list[0]
}

export type Pose = { position: THREE.Vector3; target: THREE.Vector3; fov?: number }

/**
 * Framed view from a Blender STOP camera. The reference lens should cover the part of the screen
 * the panel leaves free (left of the side panel on desktop, above the bottom sheet on phones), so
 * we widen the FOV by that ratio and turn the look-at point so the subject sits in that free area.
 */
export function poseFromStopCam(c: StopCam, size: { width: number; height: number }): Pose {
  const W = size.width
  const H = size.height
  const A = W / H
  const d = c.position.distanceTo(c.target)
  const forward = c.target.clone().sub(c.position).normalize()
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()
  const up = new THREE.Vector3().crossVectors(right, forward).normalize()
  const target = c.target.clone()
  const deg = THREE.MathUtils.radToDeg
  if (A >= 0.85) {
    const panel = Math.min(420, 0.4 * W) + 32
    const visW = Math.max(W - panel, W * 0.45)
    let tanH = Math.tan(c.hfov / 2) * (W / visW)
    const vfov = THREE.MathUtils.clamp(deg(2 * Math.atan(tanH / A)), 24, 70)
    tanH = Math.tan(THREE.MathUtils.degToRad(vfov) / 2) * A
    const xc = visW / W - 1 // NDC x of the free area's centre
    target.addScaledVector(right, -xc * d * tanH)
    return { position: c.position.clone(), target, fov: vfov }
  }
  // Portrait: keep the reference width, subject in the top 44% above the sheet.
  const vfov = THREE.MathUtils.clamp(deg(2 * Math.atan(Math.tan(c.hfov / 2) / A)), 40, 78)
  const tanV = Math.tan(THREE.MathUtils.degToRad(vfov) / 2)
  const yc = 1 - 0.44
  target.addScaledVector(up, -yc * d * tanV)
  return { position: c.position.clone(), target, fov: vfov }
}

/**
 * A framed view of a target: back off along the object's view direction until it fits,
 * stay inside the room's safe volume, then offset the look-at point so the object sits beside
 * the panel (left of it on desktop, above the bottom sheet on phones).
 */
export function poseFor(t: Target, ctx: { home: Pose; safe: THREE.Box3; aspect: number; fov: number; info: RoomInfo }): Pose {
  const size = t.box.getSize(new THREE.Vector3())
  const radius = Math.max(size.length() / 2, 0.12)
  const vfov = THREE.MathUtils.degToRad(ctx.fov)
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * ctx.aspect)
  const fit = radius / Math.sin(Math.min(vfov, hfov) / 2)
  const dist = THREE.MathUtils.clamp(fit * 1.25 * (t.def.distance ?? 1), 0.6, 2.4)

  let dir: THREE.Vector3
  if (t.def.view) dir = new THREE.Vector3(...t.def.view)
  else dir = ctx.home.position.clone().sub(t.center).setY(0).normalize().setY(0.25)
  dir.normalize()

  const position = t.center.clone().addScaledVector(dir, dist)
  position.clamp(ctx.safe.min, ctx.safe.max)

  const forward = t.center.clone().sub(position)
  const d = forward.length()
  forward.normalize()
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()
  const up = new THREE.Vector3().crossVectors(right, forward).normalize()
  const target = t.center.clone()
  if (ctx.aspect < 0.85) target.addScaledVector(up, -d * Math.tan(vfov / 2) * 0.42)
  else target.addScaledVector(right, d * Math.tan(hfov / 2) * 0.32)
  return { position, target }
}
