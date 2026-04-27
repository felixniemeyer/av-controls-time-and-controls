import { TimeClock } from '../phase-clock'

export abstract class Envelope {
  constructor(
  ) {
  }
  abstract trigger(v: number): void
  abstract release(): void
  abstract getValue(): number
}

export class ExponentialDecay extends Envelope {
  private lastTriggerTime: number
  private base: number = 0
  private stretch: number = 1

  constructor(
    private decaySeconds: number,
    private clock: TimeClock,
    private sink = 0.001,
    private stackTriggers = 0.5
  ) {
    super()
    this.lastTriggerTime = -decaySeconds
    this.setEnvelope(sink, decaySeconds)
  }

  setEnvelope(sink: number, decay: number) {
    this.base = sink ** (1 / decay)
    this.stretch = 1 / (1 - sink)
  }

  trigger(v: number) {
    const nowValue = this.getValue() * this.stackTriggers + v
    // figure out decay start (can be in the future to allow v > 1)
    // ok the function is usually v(t) = base ** t
    // now we know v(now) = nowValue
    // what is now?
    // nowValue = base ** t
    // t = log(nowValue) / log(base)
    const t = Math.log(nowValue) / Math.log(this.base)
    this.lastTriggerTime = this.clock.getSeconds() - t
  }

  release() {
  }

  getValue() {
    const t = Math.max(0, this.clock.getSeconds() - this.lastTriggerTime)
    if(t < this.decaySeconds) {
      return (this.base ** t - this.sink) * this.stretch
    } else {
      return 0
    }
  }
}

export class LinearDecay extends Envelope {
  private lastTriggerTime: number
  private slope: number

  constructor(
    private decaySeconds: number,
    private clock: TimeClock,
    private stackTriggers = 0.5
  ) {
    super()
    this.lastTriggerTime = -decaySeconds
    this.slope = 1 / decaySeconds
  }

  trigger(v: number) {
    const nowValue = this.getValue() * this.stackTriggers + v
    // I)   v(t) = 1 - t * slope
    // II)  v(now) = nowValue
    // nowValue = 1 - t * slope
    const t = (1 - nowValue) / this.slope
    this.lastTriggerTime = this.clock.getSeconds() - t
  }

  release() {
  }

  getValue() {
    const t = Math.max(0, this.clock.getSeconds() - this.lastTriggerTime)
    if(t < this.decaySeconds) {
      return 1 - t * this.slope
    } else {
      return 0
    }
  }
}
