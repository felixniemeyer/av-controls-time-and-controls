import { PhaseClock, BasePhaseClockImpl } from '../phase-clock'

/**
 * Phase clock implementation driven by model inference.
 * Maintains monotonically non-decreasing unwrapped phase.
 */
export class AutoPhaseClock extends BasePhaseClockImpl implements PhaseClock {
  private phase = 0
  private unwrappedPhase = 0
  private phaseRate = 0
  private smoothedPhaseRate = 0
  private phaseSmoothing = 0.5

  // EMA smoothing factor for phase rate (~100ms at 60fps)
  // alpha = 1 - exp(-dt / tau), for tau=0.1s and dt=1/60: alpha ≈ 0.154
  private readonly phaseRateAlpha = 0.15

  // Maximum phase step per update (0.5 = 180 degrees)
  private readonly maxPhaseStep = 0.5

  // Frames per second (for phase rate conversion)
  private readonly fps = 60

  /**
   * Update phase from model inference output.
   * @param rawPhase Decoded phase [0, 1) from atan2(sin, cos)
   * @param rawLogBarDuration Natural log of bar duration in seconds
   */
  updateFromInference(rawPhase: number, rawLogBarDuration: number) {
    const barDurationS = Math.exp(rawLogBarDuration)
    const phaseRateCyclesPerSec = Number.isFinite(barDurationS) && barDurationS > 1e-4
      ? 1 / barDurationS
      : 0

    if (phaseRateCyclesPerSec > 0.001 && phaseRateCyclesPerSec < this.fps) {
      this.smoothedPhaseRate =
        this.smoothedPhaseRate * (1 - this.phaseRateAlpha) +
        phaseRateCyclesPerSec * this.phaseRateAlpha
    }
    this.phaseRate = this.smoothedPhaseRate

    const currentFrac = ((this.unwrappedPhase % 1) + 1) % 1
    let wrappedDelta = rawPhase - currentFrac

    // Fold into [-0.5, 0.5) so wrap-around is treated as the shortest path.
    if (wrappedDelta >= 0.5) {
      wrappedDelta -= 1
    } else if (wrappedDelta < -0.5) {
      wrappedDelta += 1
    }

    // Only allow forward corrections. Negative wrapped deltas are interpreted
    // as stale/jittery observations from the previous part of the cycle.
    const forwardError = Math.min(
      this.maxPhaseStep,
      Math.max(0, wrappedDelta),
    )
    const correctionAlpha = 1 - this.phaseSmoothing * 0.95
    this.unwrappedPhase += forwardError * correctionAlpha
    this.phase = ((this.unwrappedPhase % 1) + 1) % 1
  }

  /**
   * Feed silence to the clock (maintains state without audio).
   * Phase is held at current position.
   */
  feedSilence() {
    // Don't update phase - just hold current position
    // The model should output stable phase when given silence
  }

  getPhase(): number {
    return this.phase
  }

  getUnwrappedPhase(): number {
    return this.unwrappedPhase
  }

  getPredictedUnwrappedPhase(): number {
    return this.unwrappedPhase + this.getElapsedSinceLastTickS() * this.phaseRate
  }

  getPhaseRate(): number {
    return this.phaseRate
  }

  setPhaseSmoothing(value: number) {
    this.phaseSmoothing = Math.max(0, Math.min(1, value))
  }

  getPhaseSmoothing() {
    return this.phaseSmoothing
  }

  tick(deltaS?: number): void {
    const now = Date.now()
    this.tickDeltaS = deltaS ?? ((now - this.lastTickTime) / 1000)
    this.lastTickTime = now
    this.seconds += this.tickDeltaS

    const rateInfluence = this.phaseSmoothing
    if (this.phaseRate > 0 && rateInfluence > 0) {
      this.unwrappedPhase += this.tickDeltaS * this.phaseRate * rateInfluence
      this.phase = ((this.unwrappedPhase % 1) + 1) % 1
    }

    this.notifyQueues()
  }

  /**
   * Advance phase using current tick delta and a fixed phase rate.
   * Useful for synthetic/fallback phase generation.
   */
  advance(rateCyclesPerSecond: number) {
    const deltaPhase = this.tickDeltaS * rateCyclesPerSecond
    this.unwrappedPhase += deltaPhase
    this.phase = ((this.unwrappedPhase % 1) + 1) % 1
    this.phaseRate = rateCyclesPerSecond
    this.smoothedPhaseRate = rateCyclesPerSecond
  }

  /**
   * Reset phase to zero without rewinding unwrapped phase.
   * Keeps scheduling monotonic for PhaseQueue consumers.
   */
  reset() {
    super.reset()
    // Move to the next integer phase boundary so phase=0 while unwrapped
    // remains non-decreasing (important for queued phase events).
    const nextCycleBoundary = Math.ceil(this.unwrappedPhase)
    this.phase = 0
    this.unwrappedPhase = nextCycleBoundary
    this.phaseRate = 0
    this.smoothedPhaseRate = 0
  }

  /**
   * Set phase directly (for manual override or testing).
   */
  setPhase(phase: number) {
    this.phase = phase % 1
    this.unwrappedPhase = Math.floor(this.unwrappedPhase) + this.phase
  }

  /**
   * Set phase rate directly (for testing or fallback).
   */
  setPhaseRate(rate: number) {
    this.phaseRate = rate
    this.smoothedPhaseRate = rate
  }
}
