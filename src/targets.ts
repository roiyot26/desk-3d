import * as THREE from 'three'
import { content } from './content'
import type { RoomInfo } from './analyze'

/**
 * Click targets.
 *
 * Convention (Blender side): every interactive object is a top-level EMPTY named `CLICK_<Thing>`
 * with its meshes as children. A raycast hit walks up the parents to the nearest registered node,
 * so any child mesh opens the target.
 *
 * Until those empties are exported, each target can also name a FALLBACK: a regex over node /
 * mesh names in the current GLB. Rules:
 *   1. CLICK_* empties always win. A target with a CLICK_ match ignores its fallback, and meshes
 *      under a CLICK_ empty can't be claimed by another target's fallback.
 *   2. Missing nodes are fine: a target with no CLICK_ match and no fallback match is skipped
 *      silently (no marker, no hit area). Its panel stays reachable from the progress dots,
 *      the deep links and the plain list.
 *
 * Fallback map for the current GLB (documented for Wanda's swap):
 *   stop-1  CLICK_Monitor_Projects                    <- Monitor* meshes + MUI_* screen UI
 *   stop-2  CLICK_Laptop_3D, CLICK_Frame_3DRender     <- the `Laptop` group
 *   stop-3  CLICK_Bookshelf_Skills                    <- wall Shelf + speaker + shelf plant
 *           CLICK_Book_<Skill> (one per skill)        <- desk books Book0..2 (no skill highlight)
 *   stop-4  CLICK_Terrarium_VirtualGarden             <- floor plant (FloorPot, FPLeaf*, FPStem*)
 *   stop-5  CLICK_Chalkboard_Career / CLICK_CorkBoard_Career <- the neon </> sign on the back wall
 *   stop-6  CLICK_Mug_Contact                         <- Mug, MugHandle, Coffee
 *   bonus   CLICK_RubberDuck                          <- (none yet: the duck isn't modelled)
 *           CLICK_Art_Poster / CLICK_Art_Pan / CLICK_Art_Sculpture <- Poster*, ArtPan*, Sculpt*
 *   aside   CLICK_StickyNote_NowBuilding              <- (none yet)
 */
export type TargetDef = {
  /** Unique key of this hit target. */
  key: string
  /** Panel it opens: a stop id, a bonus id or an aside id from content.json. */
  id: string
  click: (string | RegExp)[]
  fallback?: RegExp
  /** This target carries the numbered tour marker for its stop. */
  marker?: boolean
  skill?: string
  project?: string
  /** Optional camera direction (object -> camera) and distance factor for the framed view. */
  view?: [number, number, number]
  distance?: number
  /** Nudge the marker / label away from a neighbour (world metres). */
  markerOffset?: [number, number, number]
}

const books: TargetDef[] = [content.skills.featured, ...content.skills.items]
  .filter((s) => s.book)
  .map((s) => ({ key: `book-${s.id}`, id: 'stop-3', click: [`CLICK_Book_${s.book}`], skill: s.id }))

export const TARGET_DEFS: TargetDef[] = [
  {
    key: 'monitor',
    id: 'stop-1',
    marker: true,
    click: ['CLICK_Monitor_Projects'],
    fallback: /^(Monitor(Display|Body|Bezel|Rim|Neck|Base)|MUI_\w+)$/,
    view: [0.25, 0.25, 1],
  },
  {
    key: 'laptop',
    id: 'stop-2',
    marker: true,
    click: ['CLICK_Laptop_3D', 'CLICK_Frame_3DRender'],
    fallback: /^Laptop$/,
    view: [0.35, 0.45, 1],
    distance: 1.25,
  },
  {
    key: 'bookshelf',
    id: 'stop-3',
    marker: true,
    click: ['CLICK_Bookshelf_Skills'],
    fallback: /^(Shelf|ShelfLED|ShelfPot|ShelfLeaf\d+|Speaker)$/,
    view: [0.35, 0.1, 1],
  },
  ...books,
  { key: 'desk-books', id: 'stop-3', click: [], fallback: /^Book\d+(Pages)?$/ },
  {
    key: 'terrarium',
    id: 'stop-4',
    marker: true,
    click: ['CLICK_Terrarium_VirtualGarden'],
    fallback: /^(FloorPot|FloorSoil|FPLeaf\d+|FPStem\d+)$/,
    view: [0.75, 0.45, 0.9],
    distance: 0.9,
  },
  {
    key: 'career',
    id: 'stop-5',
    marker: true,
    click: ['CLICK_Chalkboard_Career', 'CLICK_CorkBoard_Career', 'CLICK_Corkboard_Career'],
    fallback: /^(NeonBackplate|Neon_\w+)$/,
    view: [0.3, -0.1, 1],
  },
  {
    key: 'mug',
    id: 'stop-6',
    marker: true,
    click: ['CLICK_Mug_Contact'],
    fallback: /^(Mug|MugHandle|Coffee)$/,
    view: [0.5, 0.6, 1],
    distance: 1.6,
    markerOffset: [0.1, -0.02, 0.1],
  },
  { key: 'duck', id: 'bonus-duck', click: ['CLICK_RubberDuck'] },
  { key: 'poster', id: 'bonus-poster', click: ['CLICK_Art_Poster'], fallback: /^(Poster_\w+|PosterFrame_\w+)$/, view: [1, 0, 0.15] },
  { key: 'pan', id: 'bonus-pan', click: ['CLICK_Art_Pan'], fallback: /^ArtPan(_\w+)?$/, view: [1, 0, 0.1] },
  { key: 'sculpture', id: 'bonus-sculpture', click: ['CLICK_Art_Sculpture'], fallback: /^Sculpt(Ico|Plinth)$/, view: [0.3, 0.1, 1] },
  { key: 'sticky', id: 'aside-now-building', click: ['CLICK_StickyNote_NowBuilding'] },
]

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

  // 1) CLICK_* empties (they win).
  for (const def of TARGET_DEFS) {
    if (!def.click.length) continue
    const nodes = all.filter((o) => matches(o.name, def.click))
    if (nodes.length) build(def, nodes, 'click')
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

export type Pose = { position: THREE.Vector3; target: THREE.Vector3 }

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
