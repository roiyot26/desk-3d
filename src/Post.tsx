import { useEffect, useMemo } from 'react'
import { AgXToneMapping, HalfFloatType, NeutralToneMapping, NoToneMapping } from 'three'
import { useThree } from '@react-three/fiber'
import {
  Bloom,
  BrightnessContrast,
  EffectComposer,
  HueSaturation,
  N8AO,
  Noise,
  SMAA,
  ToneMapping,
  Vignette,
} from '@react-three/postprocessing'
import { BlendFunction, ToneMappingMode } from 'postprocessing'
import { SplitToneEffect } from './Grade'
import type { Quality } from './quality'

/**
 * Post stack (order matters):
 *   N8AO (desktop, skipped when the GLB has baked AO/lightmaps) -> Bloom on HDR values above 1
 *   (only emissive neon / bulbs / city signs get there) -> AgX tone mapping -> teal/warm split
 *   tone + small saturation / contrast -> vignette -> film grain (desktop) -> SMAA.
 * Medium tier drops AO, grain and SMAA and uses a cheaper bloom. Low tier (and auto-quality
 * step 1) has no post at all: see <RendererToneMapping>.
 */
export type Tone = 'agx' | 'neutral'

/** `?tm=agx|neutral` overrides the tone curve (side-by-side checks against Wanda's renders). */
export function toneOverride(): Tone | null {
  const t = new URLSearchParams(window.location.search).get('tm')
  return t === 'agx' || t === 'neutral' ? t : null
}

export function Post({ quality, baked, tone = 'agx' }: { quality: Quality; baked: boolean; tone?: Tone }) {
  const high = quality.tier === 'high'
  const grade = useMemo(() => new SplitToneEffect(), [])
  const effects = [
    high && !baked ? (
      <N8AO key="ao" halfRes quality="performance" aoRadius={0.45} distanceFalloff={0.6} intensity={2.4} color="#0b0a0c" />
    ) : null,
    <Bloom
      key="bloom"
      mipmapBlur
      luminanceThreshold={1.0}
      luminanceSmoothing={0.2}
      intensity={high ? 0.75 : 0.5}
      radius={0.7}
      levels={high ? 7 : 5}
    />,
    <ToneMapping key="tm" mode={tone === 'neutral' ? ToneMappingMode.NEUTRAL : ToneMappingMode.AGX} />,
    <primitive key="grade" object={grade} />,
    <HueSaturation key="hs" saturation={0.06} />,
    <BrightnessContrast key="bc" brightness={0.0} contrast={0.06} />,
    <Vignette key="vig" offset={0.32} darkness={0.5} />,
    high ? <Noise key="grain" premultiply blendFunction={BlendFunction.ADD} opacity={0.25} /> : null,
    high ? <SMAA key="smaa" /> : null,
  ].filter((e): e is JSX.Element => e !== null)

  return (
    <EffectComposer multisampling={0} frameBufferType={HalfFloatType} enableNormalPass={false}>
      {effects}
    </EffectComposer>
  )
}

/**
 * Without the post stack, tone map on the renderer (AgX) so the room keeps its look. With the
 * post stack the renderer stays linear and the ToneMapping effect applies AgX (it reads the same
 * toneMappingExposure uniform). `exposure` overrides both: the baked package wants 1.65
 * (2^0.72, the Cycles look, README_FORGE.md).
 */
export function RendererToneMapping({ post, exposure, tone = 'agx' }: { post: boolean; exposure?: number; tone?: Tone }) {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    gl.toneMapping = post ? NoToneMapping : tone === 'neutral' ? NeutralToneMapping : AgXToneMapping
    gl.toneMappingExposure = exposure ?? (post ? 1 : 1.1)
  }, [gl, post, exposure, tone])
  return null
}
