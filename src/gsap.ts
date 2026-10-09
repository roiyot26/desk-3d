import gsap from 'gsap'
import { useGSAP } from '@gsap/react'

// Register once, before any useGSAP / gsap call (see gsap-react skill).
gsap.registerPlugin(useGSAP)

// Camera flies must finish on wall-clock time. GSAP's default lag smoothing treats any frame
// longer than 500 ms as 33 ms, so on a GPU that is stalling (shader compile, a slow laptop, the
// auto-quality step-down) a 1.15 s fly could crawl for minutes and keep OrbitControls locked.
gsap.ticker.lagSmoothing(0)

export const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

export { gsap, useGSAP }
