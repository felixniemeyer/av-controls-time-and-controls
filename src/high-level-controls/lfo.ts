import { Controls } from 'av-controls'
import { PhaseClock } from '../phase-clock'

export class LFOControl {
  private valueFader: Controls.Fader.Receiver
  private modalPad: Controls.Modal.Receiver
  
  // Modal internal controls
  private rangeFader: Controls.Fader.Receiver
  private modeSelector: Controls.Selector.Receiver
  private rateModeSelector: Controls.Selector.Receiver
  private timeFader: Controls.Fader.Receiver
  private multiplierFader: Controls.Fader.Receiver
  private divisorFader: Controls.Fader.Receiver
  private shapeFader: Controls.Fader.Receiver // New shape fader

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
    const mX = 0
    const mY = 0
    const mH = 100 
    const colW = 25 // 4 columns * 25 = 100
    
    // Top section for Range/Mode/Mult/Rate/Div/Time
    // Bottom section for Shape Fader (16 height)
    const shapeFaderHeight = 16
    const shapeFaderY = mH - shapeFaderHeight
    const otherControlsHeight = 84

    // For columns 1 and 2, which have a fader and a selector
    const splitH = otherControlsHeight * 0.5 // Each takes 42 height

    // Column 1: Range (Top) & Mode (Bottom)
    this.rangeFader = new Controls.Fader.Receiver(
      new Controls.Fader.Spec(
        new Controls.Base.Args('range', mX, mY, colW, splitH, '#f84'),
        new Controls.Fader.State(0), 0, 1, 2 // Initial value changed from 0.5 to 0
      )
    )
    this.modeSelector = new Controls.Selector.Receiver(
      new Controls.Selector.Spec(
        new Controls.Base.Args(name + ' mode', mX, mY + splitH, colW, splitH, '#f84'),
        ['above', 'around', 'below'], new Controls.Selector.State(1) // 'around' is index 1
      )
    )

    // Column 2: Multiplier (Top) & Rate Mode (Bottom)
    this.multiplierFader = new Controls.Fader.Receiver(
      new Controls.Fader.Spec(
        new Controls.Base.Args('nominator', mX + colW, mY, colW, splitH, '#48f'),
        new Controls.Fader.State(1), 1, 16, 0 // Integer 1-16
      )
    )
    this.rateModeSelector = new Controls.Selector.Receiver(
      new Controls.Selector.Spec(
        new Controls.Base.Args(name + ' rate', mX + colW, mY + splitH, colW, splitH, '#48f'),
        ['phase', 'time'], new Controls.Selector.State(0) // 'phase' is index 0
      )
    )

    // Column 3: Divisor (Full height of the top 84%)
    this.divisorFader = new Controls.Fader.Receiver(
      new Controls.Fader.Spec(
        new Controls.Base.Args('divisor', mX + colW * 2, mY, colW, otherControlsHeight, '#84f'),
        new Controls.Fader.State(4), 1, 32, 0 // Integer 1-32
      )
    )

    // Column 4: Time Fader (Full height of the top 84%)
    this.timeFader = new Controls.Fader.Receiver(
      new Controls.Fader.Spec(
        new Controls.Base.Args('period', mX + colW * 3, mY, colW, otherControlsHeight, '#8f4'),
        new Controls.Fader.State(2), 0, 60, 2
      )
    )

    // New Shape Fader at the bottom, spanning all 4 columns
    this.shapeFader = new Controls.Fader.Receiver(
      new Controls.Fader.Spec(
        new Controls.Base.Args(name + ' shape', mX, shapeFaderY, colW * 4, shapeFaderHeight, '#999'),
        new Controls.Fader.State(0), -1, 1, 2, // -1=triangle, 0=sine, 1=square
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
        [name + ' shape']: this.shapeFader, // Add shape fader to modal controls
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

  private getTriangleWave(phase: number): number {
    phase = phase % 1 // Ensure phase is 0-1
    const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2; // 0 to 1 to 0
    return 0.5 + 0.5 * (tri * 2 - 1); // maps 0->1->0 to -1->1->-1, then 0->1
  }

  private getSquareWave(phase: number): number {
    return phase < 0.5 ? 1 : 0
  }

  // Blends two waveforms (A and B) based on blendFactor (0 to 1)
  private blendWaveforms(a: number, b: number, blendFactor: number): number {
    return a * (1 - blendFactor) + b * blendFactor
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

    // Determine waveform based on shapeFader value (-1 to 1)
    const shape = this.shapeFader.value
    let osc = 0

    if (shape < 0) { // Blending Triangle to Sine
      const triangle = this.getTriangleWave(phase)
      const sine = this.getSineWave(phase)
      osc = this.blendWaveforms(triangle, sine, shape + 1) // shape+1 maps -1..0 to 0..1
    } else { // Blending Sine to Square
      const sine = this.getSineWave(phase)
      const square = this.getSquareWave(phase)
      osc = this.blendWaveforms(sine, square, shape) // shape maps 0..1 to 0..1
    }
    
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
