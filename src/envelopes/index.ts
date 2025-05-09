import { Clock } from '../clock'

export abstract class Envelope {
  constructor(
  ) {
  }
  abstract trigger(v: number): void
  abstract release(): void
  abstract getValue(): number
}

export class ExponentialDecay extends Envelope {
  private lastTriggerBeat 
  private base: number = 0
  private stretch: number = 1

  constructor(
    private decayInBeats: number,
    private clock: Clock, 
    private sink = 0.001, 
    private stackTriggers = 0.5
  ) {
    super()
    this.lastTriggerBeat = -decayInBeats
    this.setEnvelope(sink, decayInBeats)
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
    this.lastTriggerBeat = this.clock.getBeat() - t
  }

  release() {
  }

  getValue() {
    const t = this.clock.getBeat() - this.lastTriggerBeat
    if(t < this.decayInBeats) {
      return (this.base ** t - this.sink) * this.stretch
    } else {
      return 0
    }
  }
}

export class LinearDecay extends Envelope {
  private lastTriggerBeat
  private slope: number

  constructor(
    private decayInBeats: number,
    private clock: Clock, 
    private stackTriggers = 0.5
  ) {
    super()
    this.lastTriggerBeat = -decayInBeats
    this.slope = 1 / decayInBeats
  }

  trigger(v: number) {
    const nowValue = this.getValue() * this.stackTriggers + v 
    // I)   v(t) = 1 - t * slope
    // II)  v(now) = nowValue
    // nowValue = 1 - t * slope
    const t = (1 - nowValue) / this.slope
    this.lastTriggerBeat = this.clock.getBeat() - t
  }

  release() {
  }

  getValue() {
    const t = this.clock.getBeat() - this.lastTriggerBeat
    if(t < this.decayInBeats) {
      return 1 - t * this.slope
    } else {
      return 0
    }
  }
}
