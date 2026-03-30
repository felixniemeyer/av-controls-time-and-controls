import { PhaseClock } from './phase-clock'
import { PhaseQueue } from './phase-queue'

interface LoopEvent {
  down: number
  up: number
  velocity: number
}

/**
 * Phase-based tap pattern recorder and player.
 * Records note-on/off events inside a fixed-duration phase loop
 * and replays them from the original recording start anchor.
 */
export class PhaseTapPattern {
  private queue: PhaseQueue
  private schedulerToken = 0

  private events: LoopEvent[] = []

  private isRecording = false
  private recordingStartUnwrappedPhase = 0
  private pressedAtLoopTime: number | undefined
  private pressedVelocity = 0

  private isPlaying = false
  private playbackStartUnwrappedPhase = 0
  private nextDownIndex = 0
  private nextUpIndex = 0
  private downIteration = 0
  private upIteration = 0
  private outputIsDown = false

  constructor(
    private clock: PhaseClock,
    public onOn: (velocity: number) => void = () => {},
    public onOff: () => void = () => {},
    private phasesPerCycle = 1,
    lookAheadMs = 70,
    _latencyCompensateMs = 1000 / 60
  ) {
    this.queue = new PhaseQueue(lookAheadMs)
    clock.registerQueue(this.queue)
  }

  /**
   * Record a tap (note-on) at the current phase.
   */
  tap(velocity = 1) {
    const now = this.clock.getPredictedUnwrappedPhase()
    this.finalizeRecordingIfNeeded(now)

    if (!this.isRecording) {
      this.startRecording(now)
    }

    this.pressedAtLoopTime = Math.max(0, now - this.recordingStartUnwrappedPhase)
    this.pressedVelocity = velocity
    this.onOn(velocity)
  }

  /**
   * Record a release (note-off) for the current tap.
   */
  release() {
    const now = this.clock.getPredictedUnwrappedPhase()
    this.finalizeRecordingIfNeeded(now)

    if (!this.isRecording || this.pressedAtLoopTime === undefined) {
      return
    }

    const up = Math.min(this.phasesPerCycle, Math.max(0, now - this.recordingStartUnwrappedPhase))
    this.events.push({
      down: this.pressedAtLoopTime,
      up,
      velocity: this.pressedVelocity
    })
    this.pressedAtLoopTime = undefined
    this.pressedVelocity = 0
    this.onOff()
  }

  /**
   * Get the current position within the active loop in phase units.
   */
  getPhaseInCycle(): number {
    const now = this.clock.getPredictedUnwrappedPhase()

    if (this.isRecording) {
      return Math.min(this.phasesPerCycle, Math.max(0, now - this.recordingStartUnwrappedPhase))
    }

    if (this.isPlaying) {
      const loopTime = now - this.playbackStartUnwrappedPhase
      return ((loopTime % this.phasesPerCycle) + this.phasesPerCycle) % this.phasesPerCycle
    }

    return 0
  }

  /**
   * Stop playback/recording and silence any active note.
   */
  stop() {
    this.schedulerToken++
    this.queue.cancelAll()

    if (this.outputIsDown || this.pressedAtLoopTime !== undefined) {
      this.onOff()
    }

    this.isRecording = false
    this.pressedAtLoopTime = undefined
    this.pressedVelocity = 0

    this.isPlaying = false
    this.outputIsDown = false
    this.nextDownIndex = 0
    this.nextUpIndex = 0
    this.downIteration = 0
    this.upIteration = 0
  }

  /**
   * Clear the recorded pattern.
   */
  clear() {
    this.stop()
    this.events = []
  }

  /**
   * Get the number of taps in the current pattern.
   */
  getPatternLength(): number {
    return this.events.length
  }

  /**
   * Cleanup - unregister from clock.
   */
  dispose() {
    this.stop()
    this.clock.removeQueue(this.queue)
  }

  private startRecording(now: number) {
    this.stop()
    this.events = []
    this.isRecording = true
    this.recordingStartUnwrappedPhase = now

    const token = ++this.schedulerToken
    const recordEnd = this.recordingStartUnwrappedPhase + this.phasesPerCycle
    this.queue.whenPhase(recordEnd, (msUntil) => {
      setTimeout(() => {
        if (token !== this.schedulerToken) return
        this.finalizeRecordingIfNeeded(recordEnd)
      }, msUntil)
    })
  }

  private finalizeRecordingIfNeeded(now: number) {
    if (!this.isRecording) return

    const recordEnd = this.recordingStartUnwrappedPhase + this.phasesPerCycle
    if (now < recordEnd) return

    if (this.pressedAtLoopTime !== undefined) {
      this.events.push({
        down: this.pressedAtLoopTime,
        up: this.phasesPerCycle,
        velocity: this.pressedVelocity,
      })
      this.pressedAtLoopTime = undefined
      this.pressedVelocity = 0
      this.onOff()
    }

    this.isRecording = false
    if (this.events.length === 0) {
      return
    }

    this.startPlayback(recordEnd)
  }

  private startPlayback(loopStart: number) {
    this.isPlaying = true
    this.playbackStartUnwrappedPhase = loopStart
    this.outputIsDown = false
    this.nextDownIndex = 0
    this.nextUpIndex = 0
    this.downIteration = 0
    this.upIteration = 0
    this.scheduleNextPlaybackEvent()
  }

  private scheduleNextPlaybackEvent() {
    if (!this.isPlaying || this.events.length === 0) return

    const token = this.schedulerToken
    const nextEventPhase = Math.min(this.getNextUpPhase(), this.getNextDownPhase())
    this.queue.whenPhase(nextEventPhase, (msUntil) => {
      setTimeout(() => {
        if (token !== this.schedulerToken) return
        this.consumePlaybackEventsAt(nextEventPhase)
      }, msUntil)
    })
  }

  private consumePlaybackEventsAt(targetPhase: number) {
    while (true) {
      const nextUpPhase = this.getNextUpPhase()
      const nextDownPhase = this.getNextDownPhase()
      const nextPhase = Math.min(nextUpPhase, nextDownPhase)

      if (!Number.isFinite(nextPhase) || Math.abs(nextPhase - targetPhase) > 1e-9) {
        break
      }

      if (nextUpPhase <= nextDownPhase) {
        if (this.outputIsDown) {
          this.onOff()
          this.outputIsDown = false
        }
        this.advanceUpPointer()
      } else {
        const event = this.events[this.nextDownIndex]
        if (event) {
          this.onOn(event.velocity)
          this.outputIsDown = true
        }
        this.advanceDownPointer()
      }
    }

    this.scheduleNextPlaybackEvent()
  }

  private getNextDownPhase(): number {
    const event = this.events[this.nextDownIndex]
    if (!event) return Number.POSITIVE_INFINITY
    return this.playbackStartUnwrappedPhase + event.down + this.downIteration * this.phasesPerCycle
  }

  private getNextUpPhase(): number {
    const event = this.events[this.nextUpIndex]
    if (!event) return Number.POSITIVE_INFINITY
    return this.playbackStartUnwrappedPhase + event.up + this.upIteration * this.phasesPerCycle
  }

  private advanceDownPointer() {
    this.nextDownIndex += 1
    if (this.nextDownIndex >= this.events.length) {
      this.nextDownIndex = 0
      this.downIteration += 1
    }
  }

  private advanceUpPointer() {
    this.nextUpIndex += 1
    if (this.nextUpIndex >= this.events.length) {
      this.nextUpIndex = 0
      this.upIteration += 1
    }
  }
}
