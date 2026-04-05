import { BasePhaseClockImpl } from '../phase-clock'

/**
 * ConstantPhaseClock: Phase source with fixed BPM and time signature.
 * - Constant phase rate derived from BPM and beats-per-bar
 * - Phase advances linearly over time
 * - Supports manual phase adjustment via setUnwrappedPhase()
 *
 * Phase semantics:
 * - One phase cycle = one bar (not beat)
 * - phaseRate = (BPM / 60) / beatsPerBar (bars per second)
 *
 * Example: 120 BPM, 4/4 time
 * - 2 beats/sec ÷ 4 beats/bar = 0.5 bars/sec
 * - One phase cycle takes 2 seconds
 */
export class ConstantPhaseClock extends BasePhaseClockImpl {
  private phase = 0
  private unwrappedPhase = 0
  private phaseRate = 0.5  // Default 120 BPM, 4/4

  constructor(bpm = 120, beatsPerBar = 4) {
    super()
    this.setTempo(bpm, beatsPerBar)
  }

  setTempo(bpm: number, beatsPerBar: number) {
    const beatsPerSecond = bpm / 60
    this.phaseRate = beatsPerSecond / beatsPerBar
  }

  setBpm(bpm: number, beatsPerBar?: number) {
    const beats = beatsPerBar ?? this.getBeatsPerBar()
    this.setTempo(bpm, beats)
  }

  setBeatsPerBar(beatsPerBar: number) {
    const bpm = this.getBpm()
    this.setTempo(bpm, beatsPerBar)
  }

  getBpm(): number {
    const beatsPerBar = this.getBeatsPerBar()
    return this.phaseRate * beatsPerBar * 60
  }

  getBeatsPerBar(): number {
    // Derive from current phase rate
    // Assuming default 120 BPM: phaseRate = 2 / beatsPerBar
    const beatsPerSecond = 2  // 120 BPM / 60
    return beatsPerSecond / this.phaseRate
  }

  getPhase(): number {
    return this.phase
  }

  getUnwrappedPhase(): number {
    return this.unwrappedPhase
  }

  getPredictedUnwrappedPhase(): number {
    const elapsed = this.getElapsedSinceLastTickS()
    return this.unwrappedPhase + elapsed * this.phaseRate
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
    const deltaPhase = this.tickDeltaS * this.phaseRate
    this.unwrappedPhase += deltaPhase
    this.phase = ((this.unwrappedPhase % 1) + 1) % 1

    this.notifyQueues()
  }

  reset(): void {
    super.reset()
    this.phase = 0
    this.unwrappedPhase = 0
  }
}
