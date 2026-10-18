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
 * Wanda's portfolio GLB (public/bake/desk.glb) carries every CLICK_* below, so none of them needs a
 * mesh-name fallback any more. Fallbacks are kept only for optional things that are genuinely not
 * in the export:
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
 *   stop-7  CLICK_Duck: Ask the Duck (morph "Quack", MAT_DuckEyes, DUCK_BeamOrigin)  camera STOP_7_Duck_Cam
 *   aside   CLICK_StickyNote_NowBuilding
 *   actions (no panel, they change the room):
 *           CLICK_Switch_Lights   room circuit (Fill + Pictures; also the HUD bulb)   CLICK_Lamp_Desk / CLICK_Lamp_Floor  one lamp
 *           CLICK_Window_Latch    rain on / off          CLICK_Neon_Sign                     neon blink
 * The two artworks (Poster_* / PosterFrame_*, ArtPan*) are non-interactive decor: no target, no
 * hover label, no caption, no cursor change (Roi's ruling, AC-7).
 * Ignored on purpose: STOP_8_Art_Cam / STOP_8_Marker and every PLACARD_* node (hidden by Room.tsx).
 */
export type TargetAction = 'lights-room' | 'lamp-desk' | 'lamp-floor' | 'rain' | 'neon'

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
  /**
   * Small subjects (the sticky note): frame so the object's width is this share of the free width
   * (beside the side panel on desktop, the full width on phones), instead of the room-scale fit.
   */
  fill?: number
  /** Phones (portrait): camera direction override for `view` (Shuri #76: the sticky turns further right on phones). */
  phoneView?: [number, number, number]
  /** Phones (portrait): `fill` override (the steeper phone view foreshortens the subject). */
  phoneFill?: number
  /** Nudge the marker / label away from a neighbour (world metres). */
  markerOffset?: [number, number, number]
  /** Toggle something in the room instead of opening a panel. */
  action?: TargetAction
}

const books: TargetDef[] = [content.skills.featured, ...content.skills.items]
  .filter((s) => s.book)
  .map((s, i) => ({ key: `book-${s.id}`, id: 'stop-3', click: [`CLICK_Book_${s.book}`], skill: s.id, marker: i === 0 }))

/** Share of the free width the sticky note fills at its station (Shuri #76: at least 25%). */
export const STICKY_FILL = 0.34
/** Sticky station camera direction on phones (object -> camera); desktop keeps view [0.3, 0.12, 1]. */
export const STICKY_PHONE_VIEW: [number, number, number] = [0.7, 0.12, 1]
/** Phones: the note at 35° foreshortens ~10%, so it is framed a little tighter (measured pixel share ≥ 30%). */
export const STICKY_PHONE_FILL = 0.38
/** Phones: the chat peek under a station sheet (index.css: .panel is 50dvh tall, bottom: 88px peek). */
export const PHONE_PEEK = 88
/** Phones: share of the screen height above a station sheet (50% sheet + the chat peek). */
export const phoneFreeTop = (h: number) => Math.max(0.1, (h * 0.5 - PHONE_PEEK) / Math.max(h, 1))

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
    id: 'stop-7',
    marker: true,
    click: ['CLICK_Duck', 'CLICK_RubberDuck'],
    fallback: /^PLACEHOLDER_Duck$/,
    // Pulled back so the duck's beams to the monitor / shelf / board stay in frame.
    view: [0.45, 0.35, 1],
    distance: 5,
  },
  // Shuri PR #9 #76: the note itself, not the windowsill cat. Seen from a little right and above, so
  // the cat (behind and to the right) slides off the right edge / under the panel; ~1/3 of the free width.
  // Phones have no panel to hide the cat behind: ~18° further right (Shuri asked ≈10° / [0.5, 0.12, 1]; the
  // cat's bind-pose box + 3 cm only clears the right edge by 8 px from 0.7), so it leaves the frame entirely.
  { key: 'sticky', id: 'aside-now-building', click: ['CLICK_StickyNote_NowBuilding'], view: [0.3, 0.12, 1], phoneView: STICKY_PHONE_VIEW, fill: STICKY_FILL, phoneFill: STICKY_PHONE_FILL },
  // The room circuit (bake groups Fill + Pictures, + ShelfLEDCyan); the lamps and neon have their own.
  { key: 'switch', id: 'action-lights', action: 'lights-room', click: ['CLICK_Switch_Lights'] },
  { key: 'lamp-desk', id: 'action-lamp-desk', action: 'lamp-desk', click: ['CLICK_Lamp_Desk'] },
  { key: 'lamp-floor', id: 'action-lamp-floor', action: 'lamp-floor', click: ['CLICK_Lamp_Floor'] },
  { key: 'latch', id: 'action-rain', action: 'rain', click: ['CLICK_Window_Latch'] },
  { key: 'neon', id: 'action-neon', action: 'neon', click: ['CLICK_Neon_Sign'] },
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
      // Mug sits next to the laptop — keep its hit box tight so it doesn't steal laptop taps.
      const min = def.key === 'mug' ? new THREE.Vector3(0.14, 0.14, 0.14) : new THREE.Vector3(0.28, 0.24, 0.28)
      proxy = new THREE.Box3().setFromCenterAndSize(center, size.clone().max(min))
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
 * Desktop: NDC x of the panel's free area centre, before the rig's projection shift (setViewOffset
 * moves the image left by `shift` px). Shared by the stop cameras and the featured book.
 */
export function freeCentreNdc(W: number, chat = 0, shift = chat / 2, free?: { l: number; r: number }): number {
  const panel = Math.min(420, 0.4 * W) + 32
  const visW = Math.max(W - panel, W * 0.45)
  return free ? ((free.l + free.r) / 2 + shift) / (W / 2) - 1 : chat > 0 ? ((W - panel - chat) / 2 + shift) / (W / 2) - 1 : visW / W - 1
}

/** Desktop: share of the canvas width the station panel leaves free (same layout as freeCentreNdc). */
export function freeWidthShare(W: number, chat = 0, free?: { l: number; r: number }): number {
  const panel = Math.min(420, 0.4 * W) + 32
  const px = free ? free.r - free.l : chat > 0 ? W - panel - chat : Math.max(W - panel, W * 0.45)
  return Math.min(1, Math.max(px, 1) / W)
}

/**
 * Framed view from a Blender STOP camera. The reference lens should cover the part of the screen
 * the panel leaves free (left of the side panel on desktop, above the bottom sheet on phones), so
 * we widen the FOV by that ratio and turn the look-at point so the subject sits in that free area.
 */
export function poseFromStopCam(c: StopCam, size: { width: number; height: number }, sheet = 0.5, chat = 0, shift = chat / 2, free?: { l: number; r: number }): Pose {
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
    // `chat`: px of the docked duck chat. The rig shifts the projection left by `shift`
    // (setViewOffset), so the subject is aimed at the panel's free area here and the lens is
    // fitted to what is really left visible.
    const fitW = free ? Math.max(free.r - free.l, W * 0.25) : Math.max(W - panel - chat, W * 0.3)
    let tanH = Math.tan(c.hfov / 2) * (W / fitW)
    const vfov = THREE.MathUtils.clamp(deg(2 * Math.atan(tanH / A)), 24, 70)
    tanH = Math.tan(THREE.MathUtils.degToRad(vfov) / 2) * A
    // NDC x of the free area's centre, before the rig's projection shift moves it left by `shift`.
    const xc = freeCentreNdc(W, chat, shift, free)
    target.addScaledVector(right, -xc * d * tanH)
    return { position: c.position.clone(), target, fov: vfov }
  }
  // Portrait: keep the reference width, subject centred in the free area above the bottom sheet
  // (top 44% for the default 50% sheet, top 29% for the duck's 65% sheet).
  const vfov = THREE.MathUtils.clamp(deg(2 * Math.atan(Math.tan(c.hfov / 2) / A)), 40, 78)
  const tanV = Math.tan(THREE.MathUtils.degToRad(vfov) / 2)
  const yc = 1 - (1 - sheet - 0.06)
  target.addScaledVector(up, -yc * d * tanV)
  return { position: c.position.clone(), target, fov: vfov }
}

/**
 * A framed view of a target: back off along the object's view direction until it fits,
 * stay inside the room's safe volume, then offset the look-at point so the object sits beside
 * the panel (left of it on desktop, above the bottom sheet on phones).
 */
export function poseFor(
  t: Target,
  ctx: { home: Pose; safe: THREE.Box3; aspect: number; fov: number; info: RoomInfo; /** Portrait: fit the whole object into the top `above` of the screen (clear of the station sheet). */ above?: number; /** Landscape: put the object's centre at this NDC x (the panel's free area, see freeCentreNdc) instead of the generic left offset. */ xc?: number; /** Landscape: share of the width left free by the panel (freeWidthShare), for `def.fill`. */ freeShare?: number },
): Pose {
  const size = t.box.getSize(new THREE.Vector3())
  const radius = Math.max(size.length() / 2, 0.12)
  const vfov = THREE.MathUtils.degToRad(ctx.fov)
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * ctx.aspect)
  const fit = radius / Math.sin(Math.min(vfov, hfov) / 2)
  let dist = THREE.MathUtils.clamp(fit * 1.25 * (t.def.distance ?? 1), 0.6, 2.4)
  if (t.def.fill) {
    // Width of the object across the view (its horizontal extent) = fill × the free width at `dist`.
    const share = ctx.aspect < 0.85 ? 1 : ctx.freeShare ?? 1
    const w = Math.max(Math.hypot(size.x, size.z), 0.02)
    const fill = ctx.aspect < 0.85 ? t.def.phoneFill ?? t.def.fill : t.def.fill
    dist = THREE.MathUtils.clamp(w / (2 * Math.tan(hfov / 2) * fill * share), 0.15, 2.4)
  }
  const above = ctx.aspect < 0.85 ? ctx.above : undefined
  // Back off until the object's full height fits in the free band above the sheet (85% of it).
  // (Small `fill` subjects keep their close distance: the 0.6 m floor is for room-scale objects.)
  if (above) dist = THREE.MathUtils.clamp(Math.max(dist, (size.y / 2) / (Math.tan(vfov / 2) * above * 0.85)), t.def.fill ? 0.15 : 0.6, 2.4)

  let dir: THREE.Vector3
  if (ctx.aspect < 0.85 && t.def.phoneView) dir = new THREE.Vector3(...t.def.phoneView)
  else if (t.def.view) dir = new THREE.Vector3(...t.def.view)
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
  // Portrait: aim below the object so it sits in the free band at the top (centre of that band).
  if (above) target.addScaledVector(up, -d * Math.tan(vfov / 2) * (1 - above))
  else if (ctx.aspect < 0.85) target.addScaledVector(up, -d * Math.tan(vfov / 2) * 0.42)
  else target.addScaledVector(right, d * Math.tan(hfov / 2) * (ctx.xc !== undefined ? -ctx.xc : 0.32))
  return { position, target }
}
