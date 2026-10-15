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

  /** True once the context has actually run (iOS can leave it 'suspended' or 'interrupted'). */
  running = false
  private armed = false

  /**
   * Call from a user gesture. Safe to call more than once. Mobile (iOS Safari, Android Chrome):
   * the context must be created AND resumed inside a gesture, and iOS also wants a sound started
   * in that same gesture, so we play one silent sample. If it still isn't running (the gesture
   * was a scroll, or iOS interrupted it for a call / the lock screen), the next tap anywhere
   * retries: no silent fail.
   */
  unlock() {
    this.arm()
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) {
        console.info('[desk-3d] Web Audio not supported here')
        return
      }
      try {
        this.ctx = new AC({ latencyHint: 'interactive' })
      } catch {
        this.ctx = new AC()
      }
      this.master = this.ctx.createGain()
      this.master.gain.value = getUI().muted ? 0 : 1
      this.master.connect(this.ctx.destination)
      this.ctx.onstatechange = () => {
        this.running = this.ctx?.state === 'running'
        if (this.running) this.mix()
      }
      subscribe(() => this.mix())
      for (const n of FILES) void this.load(n)
    }
    this.kick()
  }

  /** Resume + a one-sample silent buffer: the iOS unlock (must run inside the gesture). */
  private kick() {
    const ctx = this.ctx
    if (!ctx) return
    try {
      const b = ctx.createBuffer(1, 1, 22050)
      const s = ctx.createBufferSource()
      s.buffer = b
      s.connect(ctx.destination)
      s.start(0)
    } catch {
      /* ignore */
    }
    if (ctx.state !== 'running') {
      ctx.resume().then(
        () => {
          this.running = ctx.state === 'running'
          this.mix()
        },
        (e) => console.info('[desk-3d] audio resume blocked, will retry on next tap', e),
      )
    } else this.running = true
  }

  /**
   * Gesture listeners for the whole visit: every tap / key retries until the context runs, and
   * coming back to the tab (or iOS ending an interruption) resumes it.
   */
  private arm() {
    if (this.armed || typeof window === 'undefined') return
    this.armed = true
    const retry = () => {
      if (!getUI().entered) return
      if (!this.ctx || this.ctx.state !== 'running') this.unlock()
    }
    for (const ev of ['pointerdown', 'touchend', 'click', 'keydown'] as const) window.addEventListener(ev, retry, { capture: true, passive: true })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => {})
    })
    window.addEventListener('pageshow', () => {
      if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => {})
    })
  }

  private async load(n: Name) {
    try {
      const res = await fetch(url(n))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.arrayBuffer()
      const ctx = this.ctx!
      // Older iOS Safari only has the callback form of decodeAudioData.
      const buf = await new Promise<AudioBuffer>((ok, bad) => {
        let settled = false
        const done = (v: AudioBuffer) => { if (!settled) { settled = true; ok(v) } }
        const fail = (e: unknown) => { if (!settled) { settled = true; bad(e instanceof Error ? e : new Error(String(e))) } }
        try {
          const ret = ctx.decodeAudioData(data.slice(0), done, fail) as Promise<AudioBuffer> | undefined
          // Modern browsers return a Promise and may ignore the callbacks.
          ret?.then(done, fail)
        } catch (e) {
          fail(e)
        }
      })
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
    if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => {})
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
