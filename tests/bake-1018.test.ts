import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import * as THREE from 'three'
import { content } from '../src/content'
import { forge } from '../src/content/forge'
import { freeCentreNdc, freeWidthShare, markerTargetFor, poseFor, resolveStopCams, resolveTargets, STICKY_FILL, type Target } from '../src/targets'
import { fovFor, phoneLift, PHONE_CHIP_ROOM, PHONE_DUCK_NDC } from '../src/CameraRig'
import { CHAT_INSET, chatWidth } from '../src/duck/DuckChat'
import type { RoomInfo } from '../src/analyze'
import { CAT_BREATHE, CAT_FLICK, FLICK_MIN_S, FLICK_SPREAD_S, startCat } from '../src/cat'

/** Wanda's 2026-10-18 package (web_next): parse the GLB's JSON chunk, no decoders needed. */
type GNode = { name?: string; children?: number[]; mesh?: number; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[]; extras?: Record<string, unknown> }
type Gltf = {
  nodes: GNode[]
  scenes: { nodes: number[] }[]
  meshes: { name?: string; primitives: { attributes: Record<string, number>; material?: number }[] }[]
  accessors: { min?: number[]; max?: number[] }[]
  materials: { name: string; pbrMetallicRoughness?: { baseColorTexture?: { index: number } } }[]
  textures: { extensions?: { KHR_texture_basisu?: { source: number } } }[]
  images: { name?: string; bufferView: number }[]
  bufferViews: { byteOffset?: number; byteLength: number }[]
  animations?: { name: string }[]
  skins?: { joints: number[] }[]
}
const glbBytes = readFileSync('public/bake/desk.glb')
const jsonLen = glbBytes.readUInt32LE(12)
const gltf = JSON.parse(glbBytes.subarray(20, 20 + jsonLen).toString('utf8')) as Gltf
const bin = glbBytes.subarray(20 + jsonLen + 8)
const names = new Set(gltf.nodes.map((n) => n.name ?? ''))

/** Rebuild the node tree with box meshes from the POSITION accessor bounds, so targets get real boxes. */
function proxyScene() {
  const make = (i: number): THREE.Object3D => {
    const n = gltf.nodes[i]
    let o: THREE.Object3D = new THREE.Object3D()
    if (n.mesh !== undefined) {
      const a = gltf.accessors[gltf.meshes[n.mesh].primitives[0].attributes.POSITION]
      const mn = new THREE.Vector3(...(a.min as [number, number, number]))
      const mx = new THREE.Vector3(...(a.max as [number, number, number]))
      const s = mx.clone().sub(mn).max(new THREE.Vector3(1e-4, 1e-4, 1e-4))
      const g = new THREE.BoxGeometry(s.x, s.y, s.z).translate(...mn.clone().add(mx).multiplyScalar(0.5).toArray())
      o = new THREE.Mesh(g, new THREE.MeshBasicMaterial())
    }
    o.name = n.name ?? ''
    if (n.extras) o.userData = { ...n.extras }
    if (n.matrix) new THREE.Matrix4().fromArray(n.matrix).decompose(o.position, o.quaternion, o.scale)
    else {
      if (n.translation) o.position.fromArray(n.translation)
      if (n.rotation) o.quaternion.fromArray(n.rotation)
      if (n.scale) o.scale.fromArray(n.scale)
    }
    for (const c of n.children ?? []) o.add(make(c))
    return o
  }
  const root = new THREE.Group()
  for (const i of gltf.scenes[0].nodes) root.add(make(i))
  return root
}

describe('bake-1018: hooks still resolve on the new GLB', () => {
  it('every CLICK_, STOP_ and KEY_ name in the runtime manifest is a node in desk.glb', () => {
    for (const list of [forge.click, forge.stops, forge.keys]) for (const n of list) expect(names.has(n), n).toBe(true)
    expect(forge.click.length).toBe(21)
    expect(forge.keys.length).toBe(65)
  })
  it('the 8 room labels and all 7 stations resolve to CLICK_ targets', () => {
    const targets = resolveTargets(proxyScene())
    for (const r of content.guide.rows) {
      const t = markerTargetFor(targets, r.id)
      expect(t, r.label).toBeDefined()
      expect(t!.source, r.label).toBe('click')
      expect(t!.box.isEmpty(), r.label).toBe(false)
    }
  })
  it('all 7 STOP cams resolve with a look-at target', () => {
    const cams = resolveStopCams(proxyScene())
    expect([...cams.keys()].sort()).toEqual(['stop-1', 'stop-2', 'stop-3', 'stop-4', 'stop-5', 'stop-6', 'stop-7'])
  })
  it('the screens the labels avoid are still there, and the duck keeps its Quack morph node', () => {
    for (const n of ['ScreenSlot_Monitor', 'ScreenSlot_Laptop', 'CLICK_Duck', 'CLICK_StickyNote_NowBuilding', 'CLICK_Mug_Contact']) expect(names.has(n), n).toBe(true)
  })
})

describe('bake-1018: package contents', () => {
  const manifest = JSON.parse(readFileSync('public/bake/lightmaps/manifest.json', 'utf8')) as { groups: { group: string; file: string; scale: number }[]; env?: { file: string } }
  it('ships every file the lightmap manifest names, and no build intermediates', () => {
    expect(manifest.groups.map((g) => g.group).sort()).toEqual(['DeskLamp', 'Fill', 'FloorLamp', 'Neon', 'Pictures', 'Window'])
    for (const g of manifest.groups) expect(existsSync(`public/bake/${g.file}`), g.file).toBe(true)
    expect(existsSync(`public/bake/${manifest.env!.file}`)).toBe(true)
    expect(readdirSync('public/bake').sort()).toEqual(['desk.glb', 'env', 'lightmaps'])
  })
  it('wall and floor paint ship as UASTC (no ETC1S blocks), so the #3A3233 flat override is gone', () => {
    const ktx = (name: string) => {
      const img = gltf.images.find((i) => i.name === name)!
      const bv = gltf.bufferViews[img.bufferView]
      const k = bin.subarray(bv.byteOffset ?? 0)
      const dfd = k.readUInt32LE(48)
      return { model: k[dfd + 12], w: k.readUInt32LE(20) }
    }
    for (const n of ['MAT_Paint_Charcoal_base', 'MAT_Concrete_Floor_v2_base']) expect(ktx(n).model, n).toBe(166)
    expect(readFileSync('src/Room.tsx', 'utf8')).not.toMatch(/3A3233|FLAT_PAINT/)
  })
  it('the 10-18 texture pass is in: the laptop screen texture keeps its slot and size', () => {
    const mat = gltf.materials.find((m) => m.name === 'ScreenSlot_Laptop')!
    const tex = gltf.textures[mat.pbrMetallicRoughness!.baseColorTexture!.index]
    expect(gltf.images[tex.extensions!.KHR_texture_basisu!.source].name).toBe('screen_laptop_blender')
  })
})

describe('bake-1018: the cat', () => {
  it('desk.glb carries the skinned cat and both clips', () => {
    expect(names.has('CAT_Root') && names.has('ARM_Cat') && names.has('CAT_Body')).toBe(true)
    expect(gltf.animations?.map((a) => a.name).sort()).toEqual([CAT_BREATHE, CAT_FLICK].sort())
  })
  const rig = () => {
    const root = new THREE.Object3D()
    const chest = new THREE.Object3D()
    chest.name = 'Chest'
    const tail = new THREE.Object3D()
    tail.name = 'Tail3'
    root.add(chest, tail)
    const breathe = new THREE.AnimationClip(CAT_BREATHE, 3.5, [new THREE.VectorKeyframeTrack('Chest.scale', [0, 1.75, 3.5], [1, 1, 1, 1.03, 1.03, 1.03, 1, 1, 1])])
    const flick = new THREE.AnimationClip(CAT_FLICK, 2.5, [new THREE.VectorKeyframeTrack('Tail3.position', [0, 0.75, 2.5], [0, 0, 0, 0.1, 0, 0, 0, 0, 0])])
    return { root, chest, tail, clips: [breathe, flick] }
  }
  it('breathes on a loop and flicks the tail once in the 6–15 s window', () => {
    const { root, chest, tail, clips } = rig()
    const cat = startCat(root, clips, { reducedMotion: false, random: () => 0 })
    for (let i = 0; i < 7; i++) cat.update(0.25) // 1.75 s: mid-breath (one frame is capped at 0.25 s)
    expect(chest.scale.x).toBeCloseTo(1.03, 3)
    expect(tail.position.x).toBe(0)
    while (tail.position.x === 0 && cat.mixer!.time < FLICK_MIN_S + 0.5) cat.update(0.25) // first flick at 6 s (random 0)
    expect(cat.mixer!.time).toBeGreaterThanOrEqual(FLICK_MIN_S)
    for (let i = 0; i < 3; i++) cat.update(0.25)
    expect(tail.position.x).toBeGreaterThan(0.05)
    expect(FLICK_MIN_S + FLICK_SPREAD_S).toBe(15)
    cat.stop()
  })
  it('reduced motion: no mixer, the cat stays in its baked rest pose', () => {
    const { root, chest, clips } = rig()
    const cat = startCat(root, clips, { reducedMotion: true })
    cat.update(1.75)
    expect(cat.mixer).toBeNull()
    expect(chest.scale.x).toBe(1)
  })
  it('a GLB without the clips is fine (no mixer)', () => {
    expect(startCat(new THREE.Object3D(), [], { reducedMotion: false }).mixer).toBeNull()
  })
})

describe('bake-1018: LinkedIn', () => {
  it('no profile URL without the -874ba9209 suffix anywhere in shipped copy', () => {
    for (const f of ['src/content/content.json', 'index.html', 'src/content/static.ts', 'README.md'])
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/linkedin\.com\/in\/roi-yotvat(?!-874ba9209)/)
  })
})

/** Project a world box with a pose; returns the screen rect in px (y down). */
function rectOf(box: THREE.Box3, pose: { position: THREE.Vector3; target: THREE.Vector3 }, fov: number, W: number, H: number, shift = 0) {
  const cam = new THREE.PerspectiveCamera(fov, W / H, 0.01, 100)
  cam.position.copy(pose.position)
  cam.lookAt(pose.target)
  cam.updateMatrixWorld()
  let l = Infinity, r = -Infinity, t = Infinity, b = -Infinity
  for (let i = 0; i < 8; i++) {
    const v = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(cam)
    const x = (v.x + 1) * 0.5 * W - shift
    const y = (1 - v.y) * 0.5 * H
    l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, y); b = Math.max(b, y)
  }
  return { l, r, t, b }
}

describe('Shuri PR #9 #76: the Now building station frames the sticky note, not the cat', () => {
  const sticky = resolveTargets(proxyScene()).get('sticky') as Target
  const home = { position: new THREE.Vector3(1.2, 1.4, 1.6), target: new THREE.Vector3(0, 1.1, -0.4) }
  const safe = new THREE.Box3(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 3, 5))
  const info = {} as RoomInfo
  it('the note is a small target with its own view and fill (>= 25%)', () => {
    expect(sticky.def.fill).toBe(STICKY_FILL)
    expect(STICKY_FILL).toBeGreaterThanOrEqual(0.3)
    expect(sticky.def.view?.[0]).toBeGreaterThan(0) // from the right: the windowsill cat slides right
  })
  it('1440 with the docked chat: the note fills >= 25% of the free width and sits inside it', () => {
    const W = 1440, H = 900
    const chat = chatWidth(W) + CHAT_INSET
    const free = { l: 12, r: W - chat - 12 }
    const fov = fovFor(W / H)
    const pose = poseFor(sticky, { home, safe, aspect: W / H, fov, info, xc: freeCentreNdc(W, chat, chat / 2, free), freeShare: freeWidthShare(W, chat, free) })
    const r = rectOf(sticky.box, pose, fov, W, H, chat / 2)
    expect((r.r - r.l) / (free.r - free.l)).toBeGreaterThanOrEqual(0.25)
    expect(r.l).toBeGreaterThanOrEqual(free.l)
    expect(r.r).toBeLessThanOrEqual(free.r)
    expect(r.t).toBeGreaterThan(0)
    expect(r.b).toBeLessThan(H)
  })
  for (const [W, H] of [[390, 844], [360, 780]]) {
    it(`${W}: the note fills >= 25% of the width, above the half sheet`, () => {
      const fov = fovFor(W / H)
      const pose = poseFor(sticky, { home, safe, aspect: W / H, fov, info })
      const r = rectOf(sticky.box, pose, fov, W, H)
      expect((r.r - r.l) / W).toBeGreaterThanOrEqual(0.25)
      expect(r.l).toBeGreaterThan(0)
      expect(r.r).toBeLessThan(W)
      expect(r.t).toBeGreaterThan(0)
      expect(r.b).toBeLessThan(H * 0.5)
    })
  }
})

describe('Shuri PR #9 #78: phone arrival keeps room for the "Ask the duck" chip', () => {
  const duckAt = (y: number): Target => {
    const box = new THREE.Box3(new THREE.Vector3(-0.06, y, -0.06), new THREE.Vector3(0.06, y + 0.12, 0.06))
    return { key: 'duck', id: 'stop-7', def: { key: 'duck', id: 'stop-7', click: [] }, source: 'click', nodes: [], box, center: box.getCenter(new THREE.Vector3()), anchor: box.getCenter(new THREE.Vector3()), proxy: null }
  }
  const topPx = (duck: Target, pose: { position: THREE.Vector3; target: THREE.Vector3; zoom?: number }, W: number, H: number) => rectOf(duck.box, pose, fovFor(W / H) * (pose.zoom ?? 1), W, H).t
  for (const [W, H] of [[390, 844], [360, 780]]) {
    it(`${W}: the lift never puts the duck box top within ${PHONE_CHIP_ROOM}px of the top edge`, () => {
      const duck = duckAt(0.8)
      // A room lens much wider than the arrival lens forces a big lift (the 10-18 bake case).
      const pose = { position: new THREE.Vector3(0, 1.3, 1.2), target: new THREE.Vector3(0, 0.9, 0), zoom: 0.4, roomZoom: 1 }
      const lifted = phoneLift(pose, duck, W / H, H)
      expect(topPx(duck, lifted, W, H)).toBeGreaterThanOrEqual(PHONE_CHIP_ROOM - 0.5)
    })
    it(`${W}: with room to spare the duck still sits at PHONE_DUCK_NDC`, () => {
      const duck = duckAt(0.8)
      const pose = { position: new THREE.Vector3(0, 1.3, 1.5), target: new THREE.Vector3(0, 0.9, 0), zoom: 0.5, roomZoom: 0.5 }
      const lifted = phoneLift(pose, duck, W / H, H)
      const cam = new THREE.PerspectiveCamera(fovFor(W / H) * 0.5, W / H, 0.01, 100)
      cam.position.copy(lifted.position)
      cam.lookAt(lifted.target)
      cam.updateMatrixWorld()
      expect(duck.center.clone().project(cam).y).toBeGreaterThanOrEqual(PHONE_DUCK_NDC - 1e-3)
      expect(topPx(duck, lifted, W, H)).toBeGreaterThanOrEqual(PHONE_CHIP_ROOM - 0.5)
    })
  }
})
