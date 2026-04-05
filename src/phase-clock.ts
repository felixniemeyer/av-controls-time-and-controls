import { PhaseQueue } from './phase-queue'

/**
 * Interface for time-only clocks (no phase information).
 * Used for components that need time progression but don't require rhythmic phase.
 */
export interface TimeClock {
  /**
   * Get elapsed seconds since clock start.
   */
  getSeconds(): number

  /**
   * Get delta time since last tick in seconds.
   */
  getTickDeltaS(): number

  /**
   * Get delta time since last tick in seconds, clamped to [-amount, amount].
   */
  getCappedTickDeltaS(amount?: number): number

  /**
   * Call once per frame to update internal state.
   */
  tick(deltaS?: number): void

  /**
   * Reset clock state to its initial value.
   */
  reset(): void
}

/**
 * Interface for phase-based timing sources.
 * Phase is a normalized value in [0, 1) representing position within a cycle.
 * Unwrapped phase is monotonically non-decreasing and can exceed 1.
 * Extends TimeClock to also provide time information.
 */
export interface PhaseClock extends TimeClock {
  /**
   * Get the current normalized phase within the cycle [0, 1).
   */
  getPhase(): number

  /**
   * Get the unwrapped phase (monotonically non-decreasing).
   * Use this for scheduling to avoid wrap discontinuities.
   */
  getUnwrappedPhase(): number

  /**
   * Get the current unwrapped phase with short-horizon phase-rate anticipation.
   * Use this for input-event sampling between ticks.
   */
  getPredictedUnwrappedPhase(): number

  /**
   * Get the current phase rate in cycles per second.
   */
  getPhaseRate(): number

  /**
   * Register a PhaseQueue to receive notifications on tick.
   */
  registerQueue(queue: PhaseQueue): void

  /**
   * Remove a previously registered PhaseQueue.
   */
  removeQueue(queue: PhaseQueue): void

  /**
   * Set the unwrapped phase to a specific value (e.g., for bar snapping).
   * Not all implementations support this operation.
   */
  setUnwrappedPhase?(phase: number): void
}

/**
 * Base implementation with common functionality for PhaseClock implementations.
 */
export abstract class BasePhaseClockImpl implements PhaseClock {
  protected queues: PhaseQueue[] = []
  protected seconds = 0
  protected tickDeltaS = 0
  protected lastTickTime = Date.now()

  abstract getPhase(): number
  abstract getUnwrappedPhase(): number
  abstract getPredictedUnwrappedPhase(): number
  abstract getPhaseRate(): number

  protected getElapsedSinceLastTickS(): number {
    return Math.max(0, (Date.now() - this.lastTickTime) / 1000)
  }

  getSeconds(): number {
    return this.seconds
  }

  getTickDeltaS(): number {
    return this.tickDeltaS
  }

  getCappedTickDeltaS(amount = 1): number {
    return Math.max(-amount, Math.min(amount, this.tickDeltaS))
  }

  tick(deltaS?: number): void {
    const now = Date.now()
    this.tickDeltaS = deltaS ?? ((now - this.lastTickTime) / 1000)
    this.lastTickTime = now
    this.seconds += this.tickDeltaS
    this.notifyQueues()
  }

  registerQueue(queue: PhaseQueue): void {
    this.queues.push(queue)
  }

  removeQueue(queue: PhaseQueue): void {
    const idx = this.queues.indexOf(queue)
    if (idx > -1) {
      this.queues.splice(idx, 1)
    }
  }

  reset(): void {
    this.seconds = 0
    this.tickDeltaS = 0
    this.lastTickTime = Date.now()
  }

  protected notifyQueues(): void {
    const unwrapped = this.getUnwrappedPhase()
    const rate = this.getPhaseRate()
    for (const q of this.queues) {
      q.notify(unwrapped, rate)
    }
  }
}
