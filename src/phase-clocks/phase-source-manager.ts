import { Controls } from 'av-controls'
import { PhaseClock } from '../phase-clock'
import { OffPhaseClock } from './off-phase-clock'
import { ConstantPhaseClock } from './constant-phase-clock'
import { BpmTapPhaseClock } from './bpm-tap-phase-clock'
import { AutoPhase, AutoPhaseConfig } from '../auto-phase'

export type PhaseSourceMode = 'off' | 'constant' | 'auto' | 'bpm'

/**
 * PhaseSourceManager: Unified interface for switching between phase sources.
 *
 * Manages four interchangeable phase clocks:
 * - Off: No rhythmic progression (phase=0, rate=0)
 * - Constant: Fixed BPM with adjustable time signature
 * - Auto: ML-based bar detection from audio
 * - BPM Tap: Manual tempo tapping with phase correction
 *
 * Provides:
 * - Mode selector control
 * - Mode-specific controls (BPM faders, tap pads, etc.)
 * - Unified PhaseClock interface
 * - Automatic control visibility based on mode
 *
 * Usage:
 * ```typescript
 * const manager = new PhaseSourceManager({
 *   modelPath: '/model.onnx',
 *   menuSpec: new Controls.Menu.Spec(...)
 * })
 *
 * // Get active clock
 * const clock = manager.getClock()
 *
 * // Get controls for current mode
 * const controls = manager.getControls()
 *
 * // Tick once per frame
 * manager.tick()
 * ```
 */
export class PhaseSourceManager {
  private currentMode: PhaseSourceMode = 'off'
  private offClock: OffPhaseClock
  private constantClock: ConstantPhaseClock
  private autoClock: AutoPhase
  private bpmClock: BpmTapPhaseClock

  private currentClock: PhaseClock

  // Controls
  private modeSelector!: Controls.Selector.Receiver
  private bpmFader!: Controls.Fader.Receiver
  private beatsPerBarFader!: Controls.Fader.Receiver
  private tapPad!: Controls.Pad.Receiver
  private tapModeSelector!: Controls.Selector.Receiver
  private setBarPad!: Controls.Pad.Receiver

  constructor(autoPhaseConfig: AutoPhaseConfig) {
    // Initialize clocks
    this.offClock = new OffPhaseClock()
    this.constantClock = new ConstantPhaseClock(120, 4)
    this.autoClock = new AutoPhase(autoPhaseConfig)
    this.bpmClock = new BpmTapPhaseClock(120, 4)
    this.currentClock = this.offClock

    this.createControls()
  }

  private createControls() {
    // Mode selector
    this.modeSelector = new Controls.Selector.Receiver(
      new Controls.Selector.Spec(
        new Controls.Base.Args('phase source', 0, 0, 25, 10, '#48f'),
        ['Off', 'Constant', 'Auto', 'BPM Tap'],
        new Controls.Selector.State(0)
      ),
      (index: number) => {
        const modes: PhaseSourceMode[] = ['off', 'constant', 'auto', 'bpm']
        this.setMode(modes[index]!)
      }
    )

    // BPM fader (for Constant mode)
    this.bpmFader = new Controls.Fader.Receiver(
      new Controls.Fader.Spec(
        new Controls.Base.Args('BPM', 0, 10, 25, 15, '#48f'),
        new Controls.Fader.State(120),
        30, 300, 0
      ),
      (bpm: number) => {
        const beatsPerBar = Math.round(this.beatsPerBarFader.value)
        this.constantClock.setTempo(bpm, beatsPerBar)
      }
    )

    // Beats-per-bar fader (for Constant and BPM modes)
    this.beatsPerBarFader = new Controls.Fader.Receiver(
      new Controls.Fader.Spec(
        new Controls.Base.Args('beats/bar', 0, 25, 25, 15, '#48f'),
        new Controls.Fader.State(4),
        0.6, 8.4, 0  // [1-8] effectively when rounded
      ),
      (beats: number) => {
        const rounded = Math.round(beats)
        this.constantClock.setBeatsPerBar(rounded)
        this.bpmClock.setBeatsPerBar(rounded)
      }
    )

    // Tap mode selector (for BPM mode)
    this.tapModeSelector = new Controls.Selector.Receiver(
      new Controls.Selector.Spec(
        new Controls.Base.Args('tap mode', 0, 40, 25, 10, '#48f'),
        ['Live', 'Accu', 'Adjust'],
        new Controls.Selector.State(0)
      )
    )

    // Tap pad (for BPM mode)
    this.tapPad = new Controls.Pad.Receiver(
      new Controls.Pad.Spec(
        new Controls.Base.Args('tap', 0, 50, 25, 10, '#aa3')
      ),
      () => {
        const modeIndex = this.tapModeSelector.index
        const tapParams = [
          // Live mode
          ['default', 1, 7, 0.5, 0.2],
          // Accu mode
          ['accu', 0.8, 7, 1, 1],
          // Adjust mode
          ['adjust', 1, 3, 0.15, 0.01]
        ][modeIndex]!

        this.bpmClock.tap(...tapParams as [string, number, number, number, number])
      }
    )

    // Set bar pad (for BPM mode)
    this.setBarPad = new Controls.Pad.Receiver(
      new Controls.Pad.Spec(
        new Controls.Base.Args('set bar', 0, 60, 25, 10, '#fa5')
      ),
      () => {
        const unwrapped = this.currentClock.getUnwrappedPhase()
        const snapped = Math.round(unwrapped)
        if (this.currentClock.setUnwrappedPhase) {
          this.currentClock.setUnwrappedPhase(snapped)
        }
      }
    )
  }

  setMode(mode: PhaseSourceMode) {
    this.currentMode = mode
    switch (mode) {
      case 'off':
        this.currentClock = this.offClock
        break
      case 'constant':
        this.currentClock = this.constantClock
        break
      case 'auto':
        this.currentClock = this.autoClock
        break
      case 'bpm':
        this.currentClock = this.bpmClock
        break
    }
  }

  getMode(): PhaseSourceMode {
    return this.currentMode
  }

  getClock(): PhaseClock {
    return this.currentClock
  }

  /**
   * Get controls for the current phase source mode.
   * Returns different controls based on active mode:
   * - All modes: mode selector
   * - Constant: BPM fader, beats/bar fader
   * - BPM: beats/bar fader, tap mode selector, tap pad, set bar pad
   * - Auto: audio menu
   */
  getControls(): { [key: string]: Controls.Base.Receiver } {
    const controls: { [key: string]: Controls.Base.Receiver } = {
      'phase source': this.modeSelector
    }

    if (this.currentMode === 'constant') {
      controls['bpm'] = this.bpmFader
      controls['beats/bar'] = this.beatsPerBarFader
    }

    if (this.currentMode === 'bpm') {
      controls['beats/bar'] = this.beatsPerBarFader
      controls['tap mode'] = this.tapModeSelector
      controls['tap'] = this.tapPad
      controls['set bar'] = this.setBarPad
    }

    if (this.currentMode === 'auto') {
      controls['audio'] = this.autoClock.getMenu()
    }

    return controls
  }

  tick() {
    this.currentClock.tick()
  }

  reset() {
    this.currentClock.reset()
  }

  /**
   * Dispose resources (mainly for AutoPhase).
   */
  dispose() {
    this.autoClock.dispose()
  }
}
