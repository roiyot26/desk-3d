import { getUI, subscribe } from './store'

/**
 * Tiny WebAudio engine. Nothing is fetched until the visitor presses Enter on the loader (that
 * click is also the autoplay unlock). All files are synthesized by scripts/make-sounds.py (CC0).
 *
 *   rain   loop, louder the closer the camera is to the window (and only while it rains)
 *   lofi   loop, quiet bed of music (duck: "play some music" toggles it)
 *   hum    loop, neon hum, only audible near the sign
 *   key    one-shot, keyboard clicks (pitch-jittered)
 *   quack  one-shot
 */
type Name = 'rain' | 'lofi' | 'hum' | 'key' | 'quack'
const FILES: Name[] = ['rain', 'lofi', 'hum', 'key', 'quack']
const LOOPS = ['rain', 'lofi', 'hum'] as const
const url = (n: Name) => `${import.meta.env.BASE_URL}audio/${n}.mp3`

class AudioEngine {
  ctx: AudioContext | null = null
  master: GainNode | null = null
  buffers = new Map<Name, AudioBuffer>()
  loopGain = new Map<Name, GainNode>()
  /** Spatial weights 0..1 fed by the canvas each few frames. */
  near = { window: 0.5, neon: 0 }

  /** Call from a user gesture (Enter). Safe to call more than once. */
  unlock() {
    if (this.ctx) {
      void this.ctx.resume()
      return
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    this.ctx = new AC()
    this.master = this.ctx.createGain()
    this.master.gain.value = getUI().muted ? 0 : 1
    this.master.connect(this.ctx.destination)
    void this.ctx.resume()
    subscribe(() => this.mix())
    for (const n of FILES) void this.load(n)
  }

  private async load(n: Name) {
    try {
      const res = await fetch(url(n))
      const buf = await this.ctx!.decodeAudioData(await res.arrayBuffer())
      this.buffers.set(n, buf)
      if ((LOOPS as readonly string[]).includes(n)) this.startLoop(n, buf)
    } catch (e) {
      console.info(`[desk-3d] sound ${n} unavailable`, e)
    }
  }

  private startLoop(n: Name, buf: AudioBuffer) {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    // MP3 encoders pad the start/end with silence: loop over the audible part only.
    const d = buf.getChannelData(0)
    let a = 0
    let b = d.length - 1
    while (a < d.length && Math.abs(d[a]) < 1e-4) a++
    while (b > a && Math.abs(d[b]) < 1e-4) b--
    src.loopStart = a / buf.sampleRate
    src.loopEnd = (b + 1) / buf.sampleRate
    const g = ctx.createGain()
    g.gain.value = 0
    src.connect(g).connect(this.master!)
    src.start(0, src.loopStart)
    this.loopGain.set(n, g)
    this.mix()
  }

  /** Recompute loop levels from the store + spatial weights (smoothed). */
  mix() {
    if (!this.ctx || !this.master) return
    const s = getUI()
    const t = this.ctx.currentTime
    this.master.gain.setTargetAtTime(s.muted ? 0 : 1, t, 0.08)
    const level: Record<(typeof LOOPS)[number], number> = {
      rain: s.rain ? 0.1 + 0.45 * this.near.window : 0,
      lofi: s.music ? 0.16 : 0,
      hum: 0.02 + 0.22 * this.near.neon * (s.agenticUntil > performance.now() ? 1.8 : 1),
    }
    for (const n of LOOPS) this.loopGain.get(n)?.gain.setTargetAtTime(level[n], t, 0.35)
  }

  setNear(win: number, neon: number) {
    if (Math.abs(win - this.near.window) + Math.abs(neon - this.near.neon) < 0.02) return
    this.near = { window: win, neon }
    this.mix()
  }

  play(n: 'key' | 'quack', opts: { rate?: number; gain?: number } = {}) {
    const buf = this.buffers.get(n)
    if (!this.ctx || !buf || getUI().muted) return
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.playbackRate.value = opts.rate ?? 1
    const g = this.ctx.createGain()
    g.gain.value = opts.gain ?? 0.6
    src.connect(g).connect(this.master!)
    src.start()
  }
}

export const audio = new AudioEngine()
