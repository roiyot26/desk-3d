// Pick a render tier once at startup. "high" = full post stack, "low" = phones,
// low-power devices and reduced-motion users (no grain/AO, lighter bloom, fewer drops).
export type Tier = 'high' | 'low'

export type Quality = {
  tier: Tier
  reducedMotion: boolean
  rainCount: number
  shadowMapSize: number
}

function detectTier(): Tier {
  const params = new URLSearchParams(window.location.search)
  const forced = params.get('quality')
  if (forced === 'low' || forced === 'high') return forced
  const ua = navigator.userAgent
  const mobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(ua)
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
  const smallScreen = Math.min(window.screen.width, window.screen.height) < 600
  const fewCores = (navigator.hardwareConcurrency ?? 8) <= 4
  const lowMemory = ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4
  if (mobileUA || (coarse && smallScreen) || (fewCores && lowMemory)) return 'low'
  return 'high'
}

export function detectQuality(): Quality {
  const tier = detectTier()
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  return {
    tier,
    reducedMotion,
    rainCount: tier === 'high' ? 3500 : 1400,
    shadowMapSize: tier === 'high' ? 1024 : 512,
  }
}
