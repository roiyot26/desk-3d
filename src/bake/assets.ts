import * as THREE from 'three'
import { DRACOLoader, DRACO_GLTF_CONFIG } from 'three/examples/jsm/loaders/DRACOLoader.js'
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'

/**
 * Wanda's baked web package (see README → "Baked lighting").
 *
 * Drop path: `public/bake/`, mirroring her `web/` folder 1:1:
 *   public/bake/desk.glb                    Draco + KTX2 room (replaces public/desk.glb while present)
 *   public/bake/lightmaps/manifest.json     groups, scales, blend formula, env      <- the switch
 *   public/bake/lightmaps/lm_<Group>.ktx2   one 2048² lightmap per light group (TEXCOORD_1)
 *   public/bake/env/room_env.ktx2           equirect of the lit room (reflections only)
 * The page uses the bake path only when the manifest is there and valid. Otherwise it keeps the
 * live-light path on the unbaked public/desk.glb. `?bake=0` forces the live path for comparison.
 *
 * Decoders: three r186's DRACOLoader / KTX2Loader point at their own wasm in
 * three/examples/jsm/libs via `new URL(..., import.meta.url)`, which Vite bundles as hashed
 * assets (dist/assets/draco_decoder-*.wasm, basis_transcoder-*.wasm). So they always match the
 * three version, nothing is vendored in the repo and nothing comes from a CDN. Draco uses the
 * smaller glTF-only build (DRACO_GLTF_CONFIG). The wasm is fetched only when a GLB/KTX2 needs it.
 * Dev only: Vite pre-bundles the loaders into node_modules/.vite, which breaks those relative
 * URLs, so `npm run dev` points them at the same files under /node_modules/three/... instead.
 */

const BASE = import.meta.env.BASE_URL
const DEV_LIBS = `${BASE}node_modules/three/examples/jsm/libs/`
export const BAKE_DIR = `${BASE}bake/`
export const BAKE_MODEL_URL = `${BAKE_DIR}desk.glb`
export const LIVE_MODEL_URL = `${BASE}desk.glb`

export type BakeGroupName = 'DeskLamp' | 'FloorLamp' | 'Fill' | 'Window' | 'Neon' | 'Pictures'
export const BAKE_GROUPS: BakeGroupName[] = ['DeskLamp', 'FloorLamp', 'Fill', 'Window', 'Neon', 'Pictures']

export type BakeGroup = {
  group: BakeGroupName
  /** Relative to the package root (e.g. "lightmaps/lm_Fill.ktx2"). */
  file: string
  scale: number
  default_intensity: number
  lights?: string[]
  emissive_materials?: string[]
}

export type BakeManifest = {
  version: number
  resolution: number
  groups: BakeGroup[]
  env?: { file: string; scale: number }
}

function valid(m: unknown): m is BakeManifest {
  const x = m as BakeManifest
  return (
    !!x &&
    Array.isArray(x.groups) &&
    x.groups.length > 0 &&
    x.groups.every((g) => typeof g.file === 'string' && typeof g.scale === 'number' && BAKE_GROUPS.includes(g.group))
  )
}

/**
 * Is the bake package there? Decided at build time: Vite inlines the manifest when
 * public/bake/lightmaps/manifest.json exists (dev picks it up on a reload), and the glob is empty
 * otherwise. So the live site never requests a missing file (no 404 in the console) and the swap
 * stays a pure file drop + rebuild.
 */
const found = import.meta.glob('../../public/bake/lightmaps/manifest.json', { eager: true, import: 'default' })

let resolved: BakeManifest | null | undefined

/** The bake manifest, or null for the live-light path (`?bake=0` forces live for comparison). */
export function readBake(): BakeManifest | null {
  if (resolved !== undefined) return resolved
  const m = Object.values(found)[0]
  const off = new URLSearchParams(window.location.search).get('bake') === '0'
  if (m && !valid(m)) console.warn('[desk-3d] public/bake/lightmaps/manifest.json is not a bake manifest: using live lights.')
  resolved = !off && valid(m) ? m : null
  if (resolved) console.info(`[desk-3d] baked lighting: ${resolved.groups.length} lightmap groups from public/bake/`)
  return resolved
}

// ---------------------------------------------------------------- loaders (one of each per page)

let draco: DRACOLoader | null = null
let ktx2: KTX2Loader | null = null
let ktx2Renderer: THREE.WebGLRenderer | null = null

export function getDRACOLoader() {
  if (!draco) {
    draco = new DRACOLoader()
    // Bundled glTF-only wasm decoder (see top).
    draco.setDecoderPath(import.meta.env.DEV ? `${DEV_LIBS}draco/gltf/` : DRACO_GLTF_CONFIG)
  }
  return draco
}

/** One KTX2Loader (one Basis worker pool) for the GLB textures, the lightmaps and the env map. */
export function getKTX2Loader(gl: THREE.WebGLRenderer) {
  if (!ktx2) {
    ktx2 = new KTX2Loader() // bundled Basis transcoder (see top)
    if (import.meta.env.DEV) ktx2.setTranscoderPath(`${DEV_LIBS}basis/`)
  }
  // A context-loss retry mounts a new renderer: re-detect its compressed formats.
  if (ktx2Renderer !== gl) {
    ktx2.detectSupport(gl)
    ktx2Renderer = gl
  }
  return ktx2
}

/** GLTFLoader extension for useLoader: KHR_draco_mesh_compression + KHR_texture_basisu. */
export function gltfDecoders(gl: THREE.WebGLRenderer) {
  return (loader: GLTFLoader) => {
    loader.setDRACOLoader(getDRACOLoader())
    loader.setKTX2Loader(getKTX2Loader(gl))
  }
}
