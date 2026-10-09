// Print nodes, meshes, materials and bounds of a GLB (no deps).
import { readFileSync } from 'node:fs'
const buf = readFileSync(process.argv[2] ?? 'public/bake/desk.glb')
const len = buf.readUInt32LE(12)
const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8'))
const mats = json.materials ?? []
console.log('nodes', json.nodes?.length, 'meshes', json.meshes?.length, 'materials', mats.length, 'images', json.images?.length)
console.log('extensionsUsed', json.extensionsUsed)
for (const n of json.nodes ?? []) {
  const m = n.mesh != null ? json.meshes[n.mesh] : null
  let info = ''
  if (m) {
    const prims = m.primitives.map((p) => {
      const mat = mats[p.material] ?? {}
      const pos = json.accessors[p.attributes.POSITION]
      return `${mat.name}[uv1:${'TEXCOORD_1' in p.attributes}] min=${pos.min?.map((v) => v.toFixed(2))} max=${pos.max?.map((v) => v.toFixed(2))}`
    })
    info = prims.join(' | ')
  }
  console.log(`${n.name} t=${(n.translation ?? []).map((v) => v.toFixed(2))} s=${(n.scale ?? []).map((v) => v.toFixed(2))} ${info}`)
}
console.log('--- materials')
for (const m of mats) {
  const p = m.pbrMetallicRoughness ?? {}
  console.log(m.name, 'base', p.baseColorFactor?.map((v) => v.toFixed(3)), 'tex', !!p.baseColorTexture, 'emis', m.emissiveFactor?.map((v) => v.toFixed(2)), 'str', m.extensions?.KHR_materials_emissive_strength?.emissiveStrength, 'alpha', m.alphaMode, 'occl', !!m.occlusionTexture, 'ext', Object.keys(m.extensions ?? {}))
}
