import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import * as THREE from 'three'
import { content } from '../src/content'
import { forge } from '../src/content/forge'
import { markerTargetFor, resolveStopCams, resolveTargets } from '../src/targets'
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
