import { setUI } from './store'

// Download progress for the loader, summed over every big asset (the GLB, and with the bake
// package also the six lightmaps and the env map). Sizes not known yet count with an estimate,
// so the bar never jumps backwards much when a new file starts.

const files = new Map<string, { loaded: number; total: number; estimate: number }>()

export function expectFile(key: string, estimateBytes: number) {
  if (!files.has(key)) files.set(key, { loaded: 0, total: 0, estimate: estimateBytes })
}

export function fileProgress(key: string, e: ProgressEvent | { loaded: number; total: number }) {
  const f = files.get(key) ?? { loaded: 0, total: 0, estimate: 6e6 }
  f.loaded = e.loaded
  if (e.total > 0) f.total = e.total
  files.set(key, f)
  let loaded = 0
  let total = 0
  for (const x of files.values()) {
    const t = x.total || Math.max(x.estimate, x.loaded * 1.05)
    loaded += Math.min(x.loaded, t)
    total += t
  }
  setUI({ progress: total > 0 ? Math.min(loaded / total, 0.999) : 0 })
}

export function fileDone(key: string) {
  const f = files.get(key)
  if (f) fileProgress(key, { loaded: f.total || f.estimate, total: f.total || f.estimate })
}
