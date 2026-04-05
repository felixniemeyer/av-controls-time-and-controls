import { BasePhaseClockImpl } from '../phase-clock'

/**
 * BpmTapPhaseClock: Phase source controlled by manual BPM tapping.
 * - User taps on beats (quarter notes)
 * - Beats-per-bar determines phase cycle duration
 * - Three tap modes: 'live', 'accu', 'adjust'
 * - Phase correction aligns phase to 0 on each tap
 *
 * Phase semantics:
 * - One phase cycle = one bar (not beat)
 * - BPM taps mark beats (user taps quarter notes)
 * - phaseRate = (beatsPerSecond) / beatsPerBar
 *
 * Example: 120 BPM, 4/4 time
 * - User taps 120 times/minute = 2 beats/sec
 * - Phase rate = 2 beats/sec ÷ 4 beats/bar = 0.5 bars/sec
 * - One phase cycle takes 2 seconds
 *
 * Tap modes:
 * - 'live' (default): Responsive, fast adaptation (factorReduction=1)
 * - 'accu': Accurate, slow convergence (factorReduction=0.8)
 * - 'adjust': Fine-tuning mode (factorReduction=1, tight gap, strong correction)
 */
export class BpmTapPhaseClock extends BasePhaseClockImpl {
  private phase = 0
  private unwrappedPhase = 0
  private phaseRate = 0.5  // Default 120 BPM, 4/4
  private beatsPerBar = 4

  // Tap state (ported from Clock.bpmTap)
  private lastTapTime = -Infinity
  private lastType = ''
  private msPB = 500  // Milliseconds per beat (default 120 BPM)
  private changeFactor = 0.2
  private shiftFactor = 0.5

  // Phase shifting for smooth correction
  private phaseShiftUntilS = 0
  private phaseShiftPerS = 0

  constructor(bpm = 120, beatsPerBar = 4) {
    super()
    this.msPB = 60000 / bpm
    this.beatsPerBar = beatsPerBar
    this.updatePhaseRate()
  }

  setBeatsPerBar(beats: number) {
    this.beatsPerBar = beats
    this.updatePhaseRate()
  }

  getBeatsPerBar(): number {
    return this.beatsPerBar
  }

  setBpm(bpm: number) {
    this.msPB = 60000 / bpm
    this.updatePhaseRate()
  }

  getBpm(): number {
    return 60000 / this.msPB
  }

  /**
   * Tap on a beat. Call this when user taps a pad.
   *
   * @param type Tap mode identifier: 'default', 'accu', or 'adjust'
   * @param factorReduction Decay multiplier for adaptation factors (0-1)
   * @param gap Number of beats before resetting the tap session
   * @param initialShiftFactor Initial phase correction strength (0-1)
   * @param initialChangeFactor Initial tempo change strength (0-1)
   */
  tap(
    type = 'default',
    factorReduction = 1,
    gap = 7,
    initialShiftFactor = 0.5,
    initialChangeFactor = 0.2
  ) {
    const now = performance.now()

    // First tap or new session detection
    const timeSinceLastTap = now - this.lastTapTime
    if (type !== this.lastType || timeSinceLastTap > gap * this.msPB) {
      // Reset session
      this.lastType = type
      this.changeFactor = initialChangeFactor
      this.shiftFactor = initialShiftFactor
      this.lastTapTime = now
      return
    }

    // Subsequent tap: update tempo with exponential moving average
    const delta = timeSinceLastTap
    this.msPB = this.msPB * (1 - this.changeFactor) + delta * this.changeFactor

    // Phase correction: align to beat boundary
    // Since taps mark beats, convert beat phase to bar phase
    const beatPhase = (this.unwrappedPhase * this.beatsPerBar) % 1
    let phaseError: number

    if (beatPhase < 0.5) {
      phaseError = -beatPhase  // Pull backward to beat start
    } else {
      phaseError = 1 - beatPhase  // Push forward to next beat
    }

    // Convert beat phase error to bar phase error
    const barPhaseError = phaseError / this.beatsPerBar

    // Apply smooth correction over one beat duration
    const beatDurationS = this.msPB / 1000
    this.phaseShiftPerS = barPhaseError * this.shiftFactor / beatDurationS
    this.phaseShiftUntilS = this.seconds + beatDurationS

    // Decay adaptation factors
    this.changeFactor *= factorReduction
    this.shiftFactor *= factorReduction

    this.lastTapTime = now
    this.updatePhaseRate()
  }

  private updatePhaseRate() {
    const beatsPerSecond = 1000 / this.msPB
    this.phaseRate = beatsPerSecond / this.beatsPerBar
  }

  getPhase(): number {
    return this.phase
  }

  getUnwrappedPhase(): number {
    return this.unwrappedPhase
  }

  getPredictedUnwrappedPhase(): number {
    const elapsed = this.getElapsedSinceLastTickS()
    let predictedPhase = this.unwrappedPhase + elapsed * this.phaseRate

    // Apply phase shift if active
    const shiftTimeRemaining = this.phaseShiftUntilS - this.seconds
    if (shiftTimeRemaining > 0 && elapsed < shiftTimeRemaining) {
      predictedPhase += this.phaseShiftPerS * elapsed
    } else if (shiftTimeRemaining > 0) {
      // Shift ends within prediction window
      predictedPhase += this.phaseShiftPerS * shiftTimeRemaining
    }

    return predictedPhase
  }

  getPhaseRate(): number {
    return this.phaseRate
  }

  setUnwrappedPhase(phase: number): void {
    this.unwrappedPhase = phase
    this.phase = ((phase % 1) + 1) % 1
  }

  tick(): void {
    // Update time
    const now = Date.now()
    this.tickDeltaS = (now - this.lastTickTime) / 1000
    this.lastTickTime = now
    this.seconds += this.tickDeltaS

    // Update phase
    let deltaPhase = this.tickDeltaS * this.phaseRate

    // Apply phase shift if active
    const shiftTimeRemaining = this.phaseShiftUntilS - this.seconds
    if (shiftTimeRemaining > 0) {
      const shiftAmount = Math.min(this.tickDeltaS, shiftTimeRemaining) * this.phaseShiftPerS
      deltaPhase += shiftAmount

      if (shiftTimeRemaining <= this.tickDeltaS) {
        // Shift period ended
        this.phaseShiftUntilS = 0
        this.phaseShiftPerS = 0
      }
    }

    this.unwrappedPhase += deltaPhase
    this.phase = ((this.unwrappedPhase % 1) + 1) % 1

    this.notifyQueues()
  }

  reset(): void {
    super.reset()
    this.phase = 0
    this.unwrappedPhase = 0
    this.lastTapTime = -Infinity
    this.lastType = ''
    this.changeFactor = 0.2
    this.shiftFactor = 0.5
    this.phaseShiftUntilS = 0
    this.phaseShiftPerS = 0
  }
}
