// Render tiers, picked once at startup and lowered at runtime when the GPU struggles.
//   high   = full post stack (AO, bloom, grade, grain, SMAA), soft shadows.
//   medium = phones / low-power devices: light post (bloom, AgX, grade, vignette), smaller shadows.
//   low    = safe mode: no post at all (AgX on the renderer), no shadows, simple Lambert materials.
//            Used for software GL (SwiftShader, llvmpipe) and as the automatic fallback after a
//            shader compile failure or a lost WebGL context.
export type Tier = 'high' | 'medium' | 'low'

export type Quality = {
  tier: Tier
  reducedMotion: boolean
  rainCount: number
  shadowMapSize: number
  shadows: boolean
  post: 'full' | 'light' | 'none'
  simpleMaterials: boolean
  dprMax: number
  /** True when ?quality= forced the tier: the runtime auto-downgrade stays off. */
  forced: boolean
}

export type GLProbe = { ok: boolean; software: boolean; renderer: string }

/** One-off WebGL check (no per-frame cost): is there a context at all, and is it software GL? */
export function probeWebGL(): GLProbe {
  try {
    const c = document.createElement('canvas')
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null
    if (!gl) return { ok: false, software: false, renderer: '' }
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return { ok: true, software: /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer), renderer }
  } catch {
    return { ok: false, software: false, renderer: '' }
  }
}

export function forcedTier(): Tier | null {
  const q = new URLSearchParams(window.location.search).get('quality')
  return q === 'high' || q === 'medium' || q === 'low' ? q : null
}

export function detectTier(probe: GLProbe): Tier {
  const forced = forcedTier()
  if (forced) return forced
  if (probe.software) return 'low'
  const ua = navigator.userAgent
  const mobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(ua)
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
  const smallScreen = Math.min(window.screen.width, window.screen.height) < 600
  const fewCores = (navigator.hardwareConcurrency ?? 8) <= 4
  const lowMemory = ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4
  if (mobileUA || (coarse && smallScreen) || (fewCores && lowMemory)) return 'medium'
  return 'high'
}

export function qualityFor(tier: Tier): Quality {
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  return {
    tier,
    reducedMotion,
    rainCount: tier === 'high' ? 3500 : tier === 'medium' ? 1400 : 1000,
    shadowMapSize: tier === 'high' ? 1024 : 512,
    shadows: tier !== 'low',
    post: tier === 'high' ? 'full' : tier === 'medium' ? 'light' : 'none',
    simpleMaterials: tier === 'low',
    // Crisp text: render at the device pixel ratio (capped at 2) on every tier.
    dprMax: 2,
    forced: forcedTier() !== null,
  }
}
