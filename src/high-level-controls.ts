import { Controls } from 'av-controls'

import TapPattern from './tap-pattern'
import { Clock } from './clock'

import { solve } from './linear-solver'

export class SmoothModKnob {
  private knob: Controls.Knob.Receiver
  private value: number
  private span: number
  private halfSpan: number
  private min: number
  private max: number

  constructor(knobSpec: Controls.Knob.Spec) {
    this.knob = new Controls.Knob.Receiver(
      knobSpec
    )
    this.value = knobSpec.initialValue
    this.span = knobSpec.max - knobSpec.min
    this.halfSpan = this.span / 2
    this.min = knobSpec.min
    this.max = knobSpec.max
  }

  update(sustain: number) {
    let d = this.knob.value - this.value

    if(d < 0) {
      d = d + this.span
    }

    // determine direction
    if(d > this.halfSpan) {
      d = d - this.span
    } 

    this.value = this.value + d * (1 - sustain)

    if(this.value < this.min) {
      this.value += this.span
    } else if(this.value > this.max) {
      this.value -= this.span
    }
  }

  getControl() {
    return this.knob
  }

  getValue() {
    return this.value
  }
}

export class SmoothFader {
  private value: number
  private fader: Controls.Fader.Receiver

  constructor(faderSpec: Controls.Fader.Spec) {
    this.value = faderSpec.initialValue
    this.fader = new Controls.Fader.Receiver(
      faderSpec
    )
  }

  update(sustain: number) {
    this.value = this.value * sustain + this.fader.value * (1 - sustain)
  }

  getControl() {
    return this.fader
  }

  getValue() {
    return this.value
  }
}

export class SuperSmoothFader {
  private value: number
  private targetValue: number
  private fader: Controls.Fader.Receiver

  constructor(faderSpec: Controls.Fader.Spec) {
    this.value = faderSpec.initialValue
    this.targetValue = faderSpec.initialValue
    this.fader = new Controls.Fader.Receiver(
      faderSpec
    )
  }

  update(sustain: number) {
    this.targetValue = this.targetValue * sustain + this.fader.value * (1 - sustain)
    this.value = this.value * sustain + this.targetValue * (1 - sustain)
  }

  getControl() {
    return this.fader
  }

  getValue() {
    return this.value
  }
}

export function makePatternPadPair(
  name: string,
  x: number, y: number, 
  width: number, height: number,
  color: string,
  clock: Clock, 
  onDown = (_velocity: number) => {},
  beatsPerCycle = 8,
  onUp = () => {}
) {
  const pattern = new TapPattern(
    clock, 
    (velo) => {
      onDown(velo)
    },
    () => {
      onUp()
    },
    beatsPerCycle
  )

  const halfHeight = height / 2

  return {
    [name + ' rec']: new Controls.Pad.Receiver(new Controls.Pad.Spec(
        new Controls.Base.Args(name + ' rec', x, y, width, halfHeight, color)
      ), (velo: number) => {
        pattern.tap(velo)
      }, () => {
        pattern.release()
      }),
    [name + ' manual']: new Controls.Pad.Receiver(new Controls.Pad.Spec(
        new Controls.Base.Args(name + ' manual', x, y + halfHeight, width, halfHeight, color)
      ), (velo: number) => {
        pattern.stop()
        onDown(velo)
      }, () => {
        onUp()
      })
  }
}

export class VectorFaders {
  private components: SmoothFader[] = []

  constructor(
    private name: string, 
    private componentNames: string[], 
    x: number, y: number,
    width: number, height: number,
    initialValues: number[], 
    min = 0, max = 1, 
    colors = ['#999', '#999', '#999']
  ) {
    const thirdWidth = width / 3

    componentNames.forEach((componentName, i) => {
      this.components.push(new SmoothFader(
        new Controls.Fader.Spec(
          new Controls.Base.Args(name + ' ' + componentName, x + thirdWidth * i, y, thirdWidth, height, colors[i]), 
          initialValues[i], 
          min, 
          max, 
          2
        )
      ))
    })
  }
  
  update(sustain: number) {
    this.components.forEach((component) => {
      component.update(sustain)
    })
  }

  getValues() {
    return this.components.map((component) => component.getValue())
  }

  getControls() {
    const result = {} as any
    this.componentNames.forEach((componentName: string, i: number) => {
      result[this.name + ' ' + componentName] = this.components[i].getControl()
    })
    return result
  }
}

const rgbPostfixes = [' r', ' g', ' b']
const rgbColors = ['#a44', '#4a4', '#44a']
export class RGBFaders extends VectorFaders {
  constructor(
    name: string,
    x: number, y: number,
    width: number, height: number,
    initialValues: [number, number, number], 
    min = 0, max = 1
  ) {
    super(name, rgbPostfixes, x, y, width, height, initialValues, min, max, rgbColors)
  }

}

const vec3Postfixes = [' x', ' y', ' z']
const vec3Colors = ['#399', '#939', '#993']
export class Vec3Faders extends VectorFaders {
  constructor(
    name: string,
    x: number, y: number,
    width: number, height: number,
    initialValues: [number, number, number], 
    min = 0, max = 1
  ) {
    super(name, vec3Postfixes, x, y, width, height, initialValues, min, max, vec3Colors)
  }
}
function cubicRow(x: number) {
  return [x * x * x, x * x, x, 1]
}
function pointsToColorCurve(points: number[][]) {
  return solve(
    points.map(v => cubicRow(v[0])),
    points.map(v => v[1])
  )
}

export class CubicCurve {
  private dots: Controls.Dots.Receiver
  private targetCoefficients = [0, 0, 1, 0]
  private coefficients = this.targetCoefficients

  constructor(
    baseArgs: Controls.Base.Args,
    initialValues?: Controls.Dots.Dot[], 
  ) {
    if(!initialValues) {
      // default: linear
      initialValues = [ 
        [0, 0],
        [0.3, 0.3],
        [0.7, 0.7],
        [1, 1],
      ]
    }
    this.dots = new Controls.Dots.Receiver(
      new Controls.Dots.Spec(baseArgs, initialValues), 
      (dots: Controls.Dots.Dot[]) => {
        this.targetCoefficients = pointsToColorCurve(dots)
      }
    )
  }

  update(sustain: number) {
    this.coefficients = this.coefficients.map((coefficient, i) => {
      return coefficient * sustain + this.targetCoefficients[i] * (1 - sustain)
    })
  }

  getCoefficients() {
    return this.coefficients
  }

  getControl() {
    return this.dots
  }
}

export class RGBCurves {
  private curves: CubicCurve[] = []

  constructor(
    private name: string,
    x: number, y: number,
    width: number, height: number,
  ) {
    for(let i = 0; i < 3; i++) {
      this.curves.push(new CubicCurve(
        new Controls.Base.Args(this.mkId(i, rgbPostfixes[i]), x + i * width / 3, y, width / 3, height, rgbColors[i])
      ))
    }
  }

  mkId(i: number, postfix: string) {
    return `${this.name} color curve ${postfix} ${i}`
  }

  update(sustain: number) {
    this.curves.forEach((curve) => {
      curve.update(sustain)
    })
  }

  getControls() {
    const result = {} as any 
    this.curves.forEach((curve, i) => {
      result[this.mkId(i, 'color curve')] = curve.getControl()
    })
    return result
  }

  getFloatValues() {
    return this.curves.map((curve) => curve.getCoefficients()).flat()
  }
}

