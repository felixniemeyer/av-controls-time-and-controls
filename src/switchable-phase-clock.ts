import { PhaseClock } from './phase-clock'
import { PhaseQueue } from './phase-queue'
import { OffPhaseClock } from './phase-clocks/off-phase-clock'
import { ConstantPhaseClock } from './phase-clocks/constant-phase-clock'
import { BpmTapPhaseClock } from './phase-clocks/bpm-tap-phase-clock'
import { AutoPhase } from './auto-phase'

export type PhaseSource = 'off' | 'constant' | 'auto' | 'tap'

/**
 * SwitchablePhaseClock: Wrapper that allows switching between different phase sources.
 *
 * Contains all 4 phase clocks and forwards method calls to the currently active one.
 * This allows components to receive a single PhaseClock reference that can change
 * behavior without requiring components to update their references.
 *
 * Performance: The indirection overhead is negligible compared to rendering costs,
 * and modern JS engines inline simple forwarding very efficiently.
 */
export class SwitchablePhaseClock implements PhaseClock {
  private offClock: OffPhaseClock
  private constantClock: ConstantPhaseClock
  private tapClock: BpmTapPhaseClock
  private autoClock: AutoPhase

  private activeClock: PhaseClock
  private activeSource: PhaseSource

  constructor(autoPhase: AutoPhase) {
    // Initialize all clocks first
    this.offClock = new OffPhaseClock()
    this.constantClock = new ConstantPhaseClock(120, 4)
    this.tapClock = new BpmTapPhaseClock(120, 4)
    this.autoClock = autoPhase

    // Set active source and clock
    this.activeSource = 'auto'
    this.activeClock = this.autoClock
  }

  /**
   * Switch to a different phase source.
   */
  setActiveSource(source: PhaseSource): void {
    this.activeSource = source
    switch (source) {
      case 'off':
        this.activeClock = this.offClock
        break
      case 'constant':
        this.activeClock = this.constantClock
        break
      case 'tap':
        this.activeClock = this.tapClock
        break
      case 'auto':
        this.activeClock = this.autoClock
        break
    }
  }

  getActiveSource(): PhaseSource {
    return this.activeSource
  }

  /**
   * Get direct access to individual clocks for configuration.
   */
  getOffClock(): OffPhaseClock {
    return this.offClock
  }

  getConstantClock(): ConstantPhaseClock {
    return this.constantClock
  }

  getTapClock(): BpmTapPhaseClock {
    return this.tapClock
  }

  getAutoClock(): AutoPhase {
    return this.autoClock
  }

  /**
   * Tick all clocks that need updating (auto and tap).
   * Constant and off clocks tick when the wrapper ticks.
   */
  tickAll(deltaS?: number): void {
    // Auto and tap need explicit ticking
    // Constant and off will be ticked when tick() is called on the wrapper
    this.autoClock.tick(deltaS)
    this.tapClock.tick(deltaS)
  }

  // ============ PhaseClock interface implementation ============
  // All methods forward to the active clock

  getPhase(): number {
    return this.activeClock.getPhase()
  }

  getUnwrappedPhase(): number {
    return this.activeClock.getUnwrappedPhase()
  }

  getPredictedUnwrappedPhase(): number {
    return this.activeClock.getPredictedUnwrappedPhase()
  }

  getPhaseRate(): number {
    return this.activeClock.getPhaseRate()
  }

  getSeconds(): number {
    return this.activeClock.getSeconds()
  }

  getTickDeltaS(): number {
    return this.activeClock.getTickDeltaS()
  }

  getCappedTickDeltaS(amount?: number): number {
    return this.activeClock.getCappedTickDeltaS(amount)
  }

  tick(deltaS?: number): void {
    this.activeClock.tick(deltaS)
  }

  reset(): void {
    this.activeClock.reset()
  }

  registerQueue(queue: PhaseQueue): void {
    // Register with all clocks so switching doesn't lose queue registrations
    this.offClock.registerQueue(queue)
    this.constantClock.registerQueue(queue)
    this.tapClock.registerQueue(queue)
    this.autoClock.registerQueue(queue)
  }

  removeQueue(queue: PhaseQueue): void {
    this.offClock.removeQueue(queue)
    this.constantClock.removeQueue(queue)
    this.tapClock.removeQueue(queue)
    this.autoClock.removeQueue(queue)
  }

  setUnwrappedPhase(phase: number): void {
    if (this.activeClock.setUnwrappedPhase) {
      this.activeClock.setUnwrappedPhase(phase)
    }
  }
}
