import * as THREE from 'three'

/**
 * Wanda's sleeping cat (README_FORGE "Post-go-live pass"): CAT_Root > ARM_Cat > skinned CAT_Body.
 * ANIM_Cat_Breathe loops (3.5 s); ANIM_Cat_TailFlick plays once every 6–15 s. The two clips drive
 * different bones (Chest/Spine scale vs Tail2/Tail3 rotation), so both run at full weight.
 * prefers-reduced-motion: nothing plays; the cat stays in its baked rest pose.
 */
export const CAT_BREATHE = 'ANIM_Cat_Breathe'
export const CAT_FLICK = 'ANIM_Cat_TailFlick'
export const FLICK_MIN_S = 6
export const FLICK_SPREAD_S = 9

export type CatRig = { update: (dt: number) => void; stop: () => void; mixer: THREE.AnimationMixer | null }

const NONE: CatRig = { update: () => {}, stop: () => {}, mixer: null }

export function startCat(
  root: THREE.Object3D,
  clips: THREE.AnimationClip[],
  opts: { reducedMotion: boolean; random?: () => number },
): CatRig {
  if (opts.reducedMotion) return NONE
  const breathe = THREE.AnimationClip.findByName(clips, CAT_BREATHE)
  const flickClip = THREE.AnimationClip.findByName(clips, CAT_FLICK)
  if (!breathe && !flickClip) return NONE
  const random = opts.random ?? Math.random
  const mixer = new THREE.AnimationMixer(root)
  if (breathe) mixer.clipAction(breathe).setLoop(THREE.LoopRepeat, Infinity).play()
  let flick: THREE.AnimationAction | null = null
  if (flickClip) {
    flick = mixer.clipAction(flickClip)
    flick.setLoop(THREE.LoopOnce, 1)
    flick.clampWhenFinished = false
  }
  // Time-based schedule on the mixer clock (no setTimeout): pauses with the render loop.
  let nextFlick = FLICK_MIN_S + random() * FLICK_SPREAD_S
  let t = 0
  return {
    mixer,
    update(dt: number) {
      const step = Math.min(Math.max(dt, 0), 0.25)
      t += step
      if (flick && t >= nextFlick) {
        flick.reset().play()
        nextFlick = t + FLICK_MIN_S + random() * FLICK_SPREAD_S
      }
      mixer.update(step)
    },
    stop() {
      mixer.stopAllAction()
      mixer.uncacheRoot(root)
    },
  }
}
