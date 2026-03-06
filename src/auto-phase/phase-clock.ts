import { PhaseClock, BasePhaseClockImpl } from '../phase-clock'

/**
 * Phase clock implementation driven by model inference.
 * Maintains monotonically non-decreasing unwrapped phase.
 */
export class AutoPhaseClock extends BasePhaseClockImpl implements PhaseClock {
  private phase = 0
  private unwrappedPhase = 0
  private phaseRate = 2 // Default ~120 BPM (0.5 bars/sec at 4 beats/bar)
  private smoothedPhaseRate = 2

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
   * @param rawPhaseRate Phase rate in radians/frame from model
   */
  updateFromInference(rawPhase: number, rawPhaseRate: number) {
    // Current fractional phase
    const currentFrac = this.unwrappedPhase % 1

    // Compute phase delta, handling wrap-around
    let phaseDelta = rawPhase - currentFrac

    // Wrap detection: if we jumped backwards by more than 0.5, we wrapped forward
    if (phaseDelta < -0.5) {
      phaseDelta += 1
    }

    // Validate step size
    if (phaseDelta < 0) {
      // Going backwards - freeze (don't update phase)
      // This handles jitter and invalid predictions
    } else if (phaseDelta > this.maxPhaseStep) {
      // Step too large - cap at max
      this.unwrappedPhase += this.maxPhaseStep
      this.phase = this.unwrappedPhase % 1
    } else {
      // Valid forward motion
      this.unwrappedPhase += phaseDelta
      this.phase = rawPhase
    }

    // Convert phase rate: radians/frame -> cycles/second
    // cycles/frame = radians/frame / (2 * PI)
    // cycles/second = cycles/frame * fps
    const phaseRateCyclesPerSec = (rawPhaseRate / (2 * Math.PI)) * this.fps

    // Smooth phase rate with EMA (only if positive)
    if (phaseRateCyclesPerSec > 0.01) {
      this.smoothedPhaseRate =
        this.smoothedPhaseRate * (1 - this.phaseRateAlpha) +
        phaseRateCyclesPerSec * this.phaseRateAlpha
    }

    this.phaseRate = this.smoothedPhaseRate
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

  getPhaseRate(): number {
    return this.phaseRate
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
    this.phaseRate = 2
    this.smoothedPhaseRate = 2
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
