import { Controls } from 'av-controls'
import { PhaseClock } from '../phase-clock'

export class LFOControl {
  private valueFader: Controls.Fader.Receiver
  private modalPad: Controls.Modal.Receiver
  
  // Modal internal controls
  private rangeFader: Controls.Fader.Receiver
  private modeSelector: Controls.Selector.Receiver
  private rateModeSelector: Controls.Selector.Receiver
  private waveformSelector: Controls.Selector.Receiver
  private timeFader: Controls.Fader.Receiver
  private multiplierFader: Controls.Fader.Receiver
  private divisorFader: Controls.Fader.Receiver
  private offsetFader: Controls.Fader.Receiver
  private powerFader: Controls.Fader.Receiver

  private controls: { [key: string]: Controls.Base.Receiver }

  constructor(
    name: string,
    private clock: PhaseClock,
    x: number, y: number,
    width: number, height: number,
    initialValue = 0.5,
    private min = 0, // Added min
    private max = 1, // Added max
    color = '#4a9'
  ) {
    // Layout for main controls: Fader on top (80%), Pad below (20%), full width.
    const faderHeight = height * 0.8
    const padHeight = height * 0.2
    
    const faderY = y
    const padY = y + faderHeight

    this.valueFader = new Controls.Fader.Receiver(
      new Controls.Fader.Spec(
        new Controls.Base.Args(name, x, faderY, width, faderHeight, color),
        new Controls.Fader.State(initialValue), min, max, 2 // Pass min/max to fader
      )
    )

    // Modal Content Layout
    // All modal internal coordinates are 0-100.
    this.rangeFader = new Controls.Fader.Receiver(
      new Controls.Fader.Spec(
        new Controls.Base.Args('range', 20, 0, 20, 40, '#f84'),
        new Controls.Fader.State(0), 0, 1, 2 // Initial value changed from 0.5 to 0
      )
    )
    this.modeSelector = new Controls.Selector.Receiver(
      new Controls.Selector.Spec(
        new Controls.Base.Args(name + ' mode', 20, 40, 20, 30, '#f84'),
        ['above', 'around', 'below'], new Controls.Selector.State(1) // 'around' is index 1
      )
    )

    this.multiplierFader = new Controls.Fader.Receiver(
      new Controls.Fader.Spec(
        new Controls.Base.Args('nominator', 40, 0, 20, 40, '#48f'),
        new Controls.Fader.State(1), 1, 16, 0 // Integer 1-16
      )
    )
    this.rateModeSelector = new Controls.Selector.Receiver(
      new Controls.Selector.Spec(
        new Controls.Base.Args(name + ' rate', 40, 40, 20, 30, '#48f'),
        ['phase', 'time'], new Controls.Selector.State(0) // 'phase' is index 0
      )
    )

    this.divisorFader = new Controls.Fader.Receiver(
      new Controls.Fader.Spec(
        new Controls.Base.Args('divisor', 60, 0, 20, 70, '#84f'),
        new Controls.Fader.State(4), 1, 32, 0 // Integer 1-32
      )
    )

    this.timeFader = new Controls.Fader.Receiver(
      new Controls.Fader.Spec(
        new Controls.Base.Args('period', 80, 0, 20, 70, '#8f4'),
        new Controls.Fader.State(2), 0, 60, 2
      )
    )

    this.waveformSelector = new Controls.Selector.Receiver(
      new Controls.Selector.Spec(
        new Controls.Base.Args(name + ' wave', 0, 0, 20, 70, '#999'),
        ['swell saw', 'decay saw', 'sine', 'square'],
        new Controls.Selector.State(2)
      )
    )

    this.offsetFader = new Controls.Fader.Receiver(
      new Controls.Fader.Spec(
        new Controls.Base.Args(name + ' phase offset', 40, 70, 60, 15, '#999'),
        new Controls.Fader.State(0), 0, 1, 2,
        true // isHorizontal
      )
    )

    this.powerFader = new Controls.Fader.Receiver(
      new Controls.Fader.Spec(
        new Controls.Base.Args(name + ' power', 40, 85, 60, 15, '#999'),
        new Controls.Fader.State(1), 0.1, 4, 2,
        true // isHorizontal
      )
    )

    // The modal itself (Pad that opens the modal)
    this.modalPad = new Controls.Modal.Receiver(
      new Controls.Group.SpecWithoutControls(
        new Controls.Base.Args('LFO', x, padY, width, padHeight, color)
      ),
      {
        [name + ' range']: this.rangeFader,
        [name + ' mode']: this.modeSelector,
        [name + ' mult']: this.multiplierFader,
        [name + ' rate']: this.rateModeSelector,
        [name + ' div']: this.divisorFader,
        [name + ' time']: this.timeFader,
        [name + ' wave']: this.waveformSelector,
        [name + ' phase offset']: this.offsetFader,
        [name + ' power']: this.powerFader,
      },
      80, // modalWidth
      80  // modalHeight
    )

    this.controls = {
      [name]: this.valueFader,
      [name + ' LFO']: this.modalPad
    }
  }

  getControls() {
    return this.controls
  }

  // Waveform functions (normalized 0-1 input phase)
  private getSineWave(phase: number): number {
    return 0.5 + 0.5 * Math.sin(phase * Math.PI * 2)
  }

  private getSwellSawWave(phase: number): number {
    return phase
  }

  private getDecaySawWave(phase: number): number {
    return 1 - phase
  }

  private getSquareWave(phase: number): number {
    return phase < 0.5 ? 1 : 0
  }

  getValue = (): number => {
    if (!this.clock) return this.valueFader.value;

    const modeIndex = this.rateModeSelector.index
    const mode = this.rateModeSelector.spec.options[modeIndex]
    let phase = 0
    
    if (mode === 'time') {
      const period = Math.max(0.01, this.timeFader.value)
      phase = (this.clock.getSeconds() % period) / period
    } else {
      // phase mode (phase cycles based)
      const mult = Math.max(1, Math.round(this.multiplierFader.value))
      const div = Math.max(1, Math.round(this.divisorFader.value))

      const phasesPerCycle = mult / div
      phase = (this.clock.getUnwrappedPhase() % phasesPerCycle) / phasesPerCycle
    }

    phase = (phase + this.offsetFader.value) % 1
    if (phase < 0) {
      phase += 1
    }

    const waveform = this.waveformSelector.spec.options[this.waveformSelector.index]
    let osc = 0
    if (waveform === 'swell saw') {
      osc = this.getSwellSawWave(phase)
    } else if (waveform === 'decay saw') {
      osc = this.getDecaySawWave(phase)
    } else if (waveform === 'square') {
      osc = this.getSquareWave(phase)
    } else {
      osc = this.getSineWave(phase)
    }

    const power = Math.max(0.0001, this.powerFader.value)
    osc = Math.pow(Math.max(0, Math.min(1, osc)), power)
    
    const base = this.valueFader.value
    const range = this.rangeFader.value
    
    const shapeModeIndex = this.modeSelector.index
    const shapeMode = this.modeSelector.spec.options[shapeModeIndex]

    let minVal = 0
    let maxVal = 0

    // Bounds logic respects min/max of the control
    // gap to upper limit = this.max - base
    // gap to lower limit = base - this.min
    
    if (shapeMode === 'above') {
      // [v, v + gap_upper * r]
      minVal = base
      maxVal = base + (this.max - base) * range
    } else if (shapeMode === 'below') {
      // [v - gap_lower * r, v]
      maxVal = base
      minVal = base - (base - this.min) * range
    } else {
      // around
      // [v - gap_lower * r, v + gap_upper * r]
      minVal = base - (base - this.min) * range
      maxVal = base + (this.max - base) * range
    }

    return minVal + osc * (maxVal - minVal)
  }
}

export class VectorLFOs {
  private components: LFOControl[] = []

  constructor(
    private componentNames: string[],
    name: string,
    phaseClock: PhaseClock,
    x: number, y: number,
    width: number, height: number,
    initialValues: number[],
    min = 0, max = 1,
    colors = ['#999', '#999', '#999']
  ) {
    const componentWidth = width / componentNames.length

    componentNames.forEach((componentName, i) => {
      this.components.push(new LFOControl(
        name + ' ' + componentName,
        phaseClock,
        x + componentWidth * i,
        y,
        componentWidth,
        height,
        initialValues[i]!,
        min,
        max,
        colors[i]
      ))
    })
  }

  getValues() {
    return this.components.map((component) => component.getValue())
  }

  getValuesOrTargets(_smooth: boolean) {
    return this.getValues()
  }

  getControls() {
    const result = {} as Record<string, Controls.Base.Receiver>
    this.componentNames.forEach((_componentName: string, i: number) => {
      const controls = this.components[i]!.getControls()
      Object.assign(result, controls)
    })
    return result
  }
}

const rgbPostfixes = ['r', 'g', 'b']
const rgbColors = ['#a44', '#4a4', '#44a']
export class RGBLFOs extends VectorLFOs {
  constructor(
    name: string,
    phaseClock: PhaseClock,
    x: number, y: number,
    width: number, height: number,
    initialValues: [number, number, number],
    min = 0, max = 1
  ) {
    super(rgbPostfixes, name, phaseClock, x, y, width, height, initialValues, min, max, rgbColors)
  }
}

const rgbaPostfixes = ['r', 'g', 'b', 'a']
const rgbaColors = ['#a44', '#4a4', '#44a', '#666']
export class RGBALFOs extends VectorLFOs {
  constructor(
    name: string,
    phaseClock: PhaseClock,
    x: number, y: number,
    width: number, height: number,
    initialValues: [number, number, number, number],
    min = 0, max = 1
  ) {
    super(rgbaPostfixes, name, phaseClock, x, y, width, height, initialValues, min, max, rgbaColors)
  }
}
