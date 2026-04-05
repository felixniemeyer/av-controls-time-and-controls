import { BasePhaseClockImpl } from '../phase-clock'

/**
 * OffPhaseClock: Phase source with no rhythmic progression.
 * - Phase is always 0
 * - Phase rate is always 0
 * - Time progresses normally
 *
 * Use case: Non-rhythmic visuals that only need time progression.
 */
export class OffPhaseClock extends BasePhaseClockImpl {
  getPhase(): number {
    return 0
  }

  getUnwrappedPhase(): number {
    return 0
  }

  getPredictedUnwrappedPhase(): number {
    return 0
  }

  getPhaseRate(): number {
    return 0
  }

  tick(deltaS?: number): void {
    // Update time but not phase
    const now = Date.now()
    this.tickDeltaS = deltaS ?? ((now - this.lastTickTime) / 1000)
    this.lastTickTime = now
    this.seconds += this.tickDeltaS
    this.notifyQueues()
  }
}
