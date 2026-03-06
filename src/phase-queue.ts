interface PhaseWaiter {
  targetUnwrappedPhase: number
  callback: (msUntil: number) => void
}

export class PhaseQueue {
  private waiters: PhaseWaiter[] = []

  constructor(
    private lookAheadMs: number = 70
  ) {}

  /**
   * Notify the queue of the current phase state.
   * Fires callbacks for events within the lookahead window.
   * @param unwrappedPhase Current monotonic phase (can exceed 1)
   * @param phaseRate Current phase rate in cycles/second
   */
  notify(unwrappedPhase: number, phaseRate: number) {
    // Avoid division by zero or negative rates
    if (phaseRate <= 0.001) return

    // Convert lookahead from ms to phase units
    const lookAheadPhase = (this.lookAheadMs / 1000) * phaseRate

    while (this.waiters.length > 0) {
      const waiter = this.waiters[0]!
      if (unwrappedPhase + lookAheadPhase > waiter.targetUnwrappedPhase) {
        const phaseDiff = waiter.targetUnwrappedPhase - unwrappedPhase
        // Convert phase difference to milliseconds
        const msUntil = (phaseDiff / phaseRate) * 1000
        waiter.callback(Math.max(0, msUntil))
        this.waiters.shift()
      } else {
        break
      }
    }
  }

  /**
   * Cancel all pending callbacks.
   */
  cancelAll() {
    this.waiters = []
  }

  /**
   * Schedule a callback to fire when the target unwrapped phase is reached.
   * Callbacks are stored sorted by target phase for efficient notification.
   * @param targetUnwrappedPhase The unwrapped phase at which to fire (monotonic, can exceed 1)
   * @param callback Receives milliseconds until the target phase
   */
  whenPhase(targetUnwrappedPhase: number, callback: (msUntil: number) => void) {
    const waiter: PhaseWaiter = { targetUnwrappedPhase, callback }

    // Insert sorted by targetUnwrappedPhase (ascending)
    const idx = this.waiters.findIndex(w => w.targetUnwrappedPhase > targetUnwrappedPhase)
    if (idx === -1) {
      this.waiters.push(waiter)
    } else {
      this.waiters.splice(idx, 0, waiter)
    }
  }

  /**
   * Get the number of pending waiters (useful for debugging).
   */
  getPendingCount(): number {
    return this.waiters.length
  }
}
