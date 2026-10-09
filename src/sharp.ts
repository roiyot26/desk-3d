import * as THREE from 'three'

/**
 * Text sharpness helpers.
 *
 * Text-bearing textures (book spines, project cards, the 3D plaque, the monitor / laptop screens,
 * the sticky note, the mug print) are sampled from their full-res level with max anisotropy and no
 * mip blur: a trilinear mip chain smears small type as soon as it's a little off-axis. Every other
 * texture keeps its mipmaps and just gets max anisotropy.
 */
export const TEXT_MATERIAL = /Spine|Card|Plaque|ScreenSlot|MugPrint|StickyNote/i

export function sharpenTextTexture(t: THREE.Texture, gl: THREE.WebGLRenderer) {
  t.anisotropy = gl.capabilities.getMaxAnisotropy()
  t.minFilter = THREE.LinearFilter
  t.magFilter = THREE.LinearFilter
  t.generateMipmaps = false
  t.needsUpdate = true
}

const MAPS = ['map', 'emissiveMap'] as const

export function sharpenSceneText(scene: THREE.Object3D, gl: THREE.WebGLRenderer) {
  const max = gl.capabilities.getMaxAnisotropy()
  const seen = new Set<THREE.Texture>()
  scene.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    for (const mt of Array.isArray(m.material) ? m.material : [m.material]) {
      const text = TEXT_MATERIAL.test(mt.name)
      for (const k of MAPS) {
        const t = (mt as THREE.MeshStandardMaterial)[k]
        if (!t || seen.has(t)) continue
        seen.add(t)
        if (text) sharpenTextTexture(t, gl)
        else if (t.anisotropy < max) {
          t.anisotropy = max
          t.needsUpdate = true
        }
      }
    }
  })
}

const _v = new THREE.Vector3()
/** drei <Html> calculatePosition, snapped to whole CSS pixels so labels never sit on a half pixel. */
export function snapToPixel(el: THREE.Object3D, camera: THREE.Camera, size: { width: number; height: number }) {
  _v.setFromMatrixPosition(el.matrixWorld).project(camera)
  return [Math.round(((_v.x + 1) * size.width) / 2), Math.round(((1 - _v.y) * size.height) / 2)]
}
