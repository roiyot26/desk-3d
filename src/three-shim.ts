// `three` resolves here (vite.config.ts alias). Everything is the real three.js, except `Clock`:
// three r183+ deprecates THREE.Clock in favour of THREE.Timer, but @react-three/fiber v8 still
// constructs a Clock for its frame loop. This Clock keeps R3F's API and is driven by THREE.Timer.
import { Timer } from 'three-real'

export * from 'three-real'

export class Clock {
  autoStart: boolean
  startTime = 0
  oldTime = 0
  elapsedTime = 0
  running = false
  private timer = new Timer()

  constructor(autoStart = true) {
    this.autoStart = autoStart
  }

  start() {
    this.timer.reset()
    this.timer.update()
    this.startTime = this.oldTime = performance.now()
    this.elapsedTime = 0
    this.running = true
  }

  stop() {
    this.getElapsedTime()
    this.running = false
    this.autoStart = false
  }

  getElapsedTime() {
    this.getDelta()
    return this.elapsedTime
  }

  getDelta() {
    if (this.autoStart && !this.running) {
      this.start()
      return 0
    }
    if (!this.running) return 0
    this.timer.update()
    const diff = this.timer.getDelta()
    this.oldTime = performance.now()
    this.elapsedTime += diff
    return diff
  }
}
