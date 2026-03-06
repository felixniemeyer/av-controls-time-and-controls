import { PhaseClock } from './phase-clock'
import { PhaseQueue } from './phase-queue'

interface PhaseTap {
  onPhase: number      // Phase within cycle [0, 1)
  durationPhase: number // Duration in phase units (0, 1]
  velocity: number
}

/**
 * Phase-based tap pattern recorder and player.
 * Records note-on/off events as phase positions within a normalized [0, 1) cycle.
 * Plays back patterns using PhaseQueue for accurate scheduling.
 */
export class PhaseTapPattern {
  private recordStartPhase = -1
  private preventAll = false
  private tapId = 0
  private pattern: PhaseTap[] = []
  private cycleStartPhase = 0
  private queue: PhaseQueue
  private waitingForOff = false

  constructor(
    private clock: PhaseClock,
    public onOn: (velocity: number) => void = () => {},
    public onOff: () => void = () => {},
    lookAheadMs = 70,
    private latencyCompensateMs = 1000 / 60
  ) {
    this.queue = new PhaseQueue(lookAheadMs)
    clock.registerQueue(this.queue)
  }

  /**
   * Record a tap (note-on) at the current phase.
   */
  tap(velocity = 1) {
    const currentPhase = this.clock.getUnwrappedPhase()
    let phaseInCycle = currentPhase - this.recordStartPhase
    let startedNewCycle = false

    if (phaseInCycle >= 1 || this.recordStartPhase < 0) {
      // Start new recording cycle
      startedNewCycle = true
      this.recordStartPhase = Math.floor(currentPhase)
      phaseInCycle = currentPhase - this.recordStartPhase
      this.queue.cancelAll()
      this.preventAll = true
      this.tapId = 0
      this.pattern = []

      // Compensate for latency
      const latencyPhase = (this.latencyCompensateMs / 1000) * this.clock.getPhaseRate()
      this.cycleStartPhase = Math.floor(currentPhase) + 1 - latencyPhase
    }

    // Record the tap
    this.pattern.push({
      onPhase: phaseInCycle,
      velocity,
      durationPhase: 1 - phaseInCycle // Default duration if release not called
    })

    // Schedule first playback at the recorded phase position (not always phase 0).
    if (startedNewCycle) {
      const firstTap = this.pattern[0]!
      const firstOnAtPhase = this.cycleStartPhase + firstTap.onPhase
      this.queue.whenPhase(firstOnAtPhase, (msUntil) => {
        setTimeout(() => {
          this.preventAll = false
          this.tapId = 0
          this.onOn(firstTap.velocity)
          this.waitForOff()
        }, msUntil)
      })
    }

    this.onOn(velocity)
  }

  /**
   * Record a release (note-off) for the current tap.
   */
  release() {
    const currentPhase = this.clock.getUnwrappedPhase()
    const phaseInCycle = currentPhase - this.recordStartPhase

    if (phaseInCycle < 1 && this.pattern.length > 0) {
      const tap = this.pattern[this.tapId]
      if (tap) {
        tap.durationPhase = phaseInCycle - tap.onPhase
        this.tapId++
      }
      this.onOff()
    }
  }

  /**
   * Get the current phase position within the cycle [0, 1).
   */
  getPhaseInCycle(): number {
    return this.clock.getPhase()
  }

  private waitForOn() {
    this.tapId++
    if (this.tapId < this.pattern.length) {
      const tap = this.pattern[this.tapId]!
      const onAtPhase = this.cycleStartPhase + tap.onPhase

      this.queue.whenPhase(onAtPhase, (msUntil) => {
        setTimeout(() => {
          if (!this.preventAll) {
            this.onOn(tap.velocity)
          }
        }, msUntil)
        this.waitForOff()
      })
    } else {
      // New cycle - prevent drift by scheduling from integer cycle boundary
      const nextCycleStart = this.cycleStartPhase + 1

      this.queue.whenPhase(nextCycleStart, (msUntil) => {
        this.cycleStartPhase = nextCycleStart
        this.tapId = 0
        const tap = this.pattern[0]
        if (tap) {
          setTimeout(() => {
            if (!this.preventAll) {
              this.onOn(tap.velocity)
            }
          }, msUntil)
          this.waitForOff()
        }
      })
    }
  }

  private waitForOff() {
    this.waitingForOff = true
    const tap = this.pattern[this.tapId]
    if (!tap) return

    const offAtPhase = this.cycleStartPhase + tap.onPhase + tap.durationPhase

    this.queue.whenPhase(offAtPhase, (msUntil) => {
      setTimeout(() => {
        if (!this.preventAll) {
          this.onOff()
        }
      }, msUntil)
      this.waitForOn()
      this.waitingForOff = false
    })
  }

  /**
   * Stop playback and silence any active note.
   */
  stop() {
    if (this.waitingForOff) {
      this.onOff()
    }
    this.preventAll = true
    this.queue.cancelAll()
    this.waitingForOff = false
  }

  /**
   * Clear the recorded pattern.
   */
  clear() {
    this.stop()
    this.pattern = []
    this.recordStartPhase = -1
  }

  /**
   * Get the number of taps in the current pattern.
   */
  getPatternLength(): number {
    return this.pattern.length
  }

  /**
   * Cleanup - unregister from clock.
   */
  dispose() {
    this.stop()
    this.clock.removeQueue(this.queue)
  }
}
