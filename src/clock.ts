interface Waiter {
  t: number
  callback: (msTill: number) => void
}

export class Queue {
  private waiters: Waiter[] = []

  constructor(
    private beatsPerCycle = 4, 
    private lookAhead = 70, // ms 
  ) {}

  public notify(beats: number, msPB: number) {
    const t = beats / this.beatsPerCycle
    const toMsFactor = this.beatsPerCycle * msPB
    const toTFactor = 1 / toMsFactor
    while(this.waiters.length > 0) {
      const waiter = this.waiters[0]
      const lookAheadBar = this.lookAhead * toTFactor
      if(t + lookAheadBar > waiter.t) {
        const msTill = (waiter.t - t) * toMsFactor 
        waiter.callback(msTill)
        this.waiters.shift()
      } else {
        break
      }
    }
  }

  cancelAll() {
    this.waiters = []
  }

  whenT(t: number, callback: (msTill: number) => void) {
    this.waiters.push({
      t,
      callback,
    })
  }
}

export class DynamicTime {

  private accumulatedTime = 0;

  constructor(
    private speedFactor: number,
  ) {
  }

  tick(delta: number) {
    this.accumulatedTime += delta * this.speedFactor;
  }

  setSpeedFactor(factor: number) {
    this.speedFactor = factor;
  }

  getTime() {
    return this.accumulatedTime;
  }
}

type BpsChangeListener = ((bps: number) => void)

export class Clock {
  private ms = 0
  private beat = 0
  private bar = 0

  private tickDeltaMS = 0
  private tickDeltaS = 0

  private seconds = 0

  private BPS = 2
  private msPB = 1000 / this.BPS

  private queues: Queue[] = []
  private dynamicTimes: DynamicTime[] = []
  // private beatSyncedDynamicTimes: DynamicTime[] = []

  private onBPSChange: BpsChangeListener[] = []


  constructor() {
  }

  // tick shall be called once per frame, especially for tickDelta
  private FPS = 0
  private smoothFPS = 0
  private previousTick = Date.now()
  tick() {
    const now = Date.now()
    this.tickDeltaMS = now - this.previousTick
    this.tickDeltaS = this.tickDeltaMS * 0.001
    this.previousTick = now

    this.FPS = 1 / this.tickDeltaS
    this.smoothFPS = this.smoothFPS * 0.9 + 0.1 * this.FPS

    this.update()
    this.notifyQueues()
    this.updatedDynamicTimes(this.tickDeltaS)
  }

  getTickFPS() {
    return this.FPS
  }

  getTickSmoothFPS() {
    return this.smoothFPS
  }

  addOnBPSChangeListener(f: BpsChangeListener) {
    this.onBPSChange.push(f)
  }

  // can be called multiple times per frame
  // called for time sensitive things
  private previousTime = Date.now()
  update() {
    const now = Date.now()
    const deltaMs = now - this.previousTime
    this.previousTime = now

    this.previousTime = now
    this.ms += deltaMs
    this.seconds = this.ms * 0.001

    const beatShiftMs = this.beatShiftUntil - this.ms
    if(beatShiftMs > 0) {
      this.beat += this.beatShiftPerMs * Math.min(beatShiftMs, deltaMs)
    }
    
    this.beat += deltaMs / this.msPB

    this.bar = this.beat / 4
  }

  private beatShiftUntil = 0
  private beatShiftPerMs = 0

  private lastTap = -Infinity
  private changeFactor = 0.1
  private shiftFactor = 0.4

  private lastType = ''

  bpmTap(
    type = 'default',
    factorReduction = 1,
    gap = 7,
    initialShiftFactor = 0.5, 
    initialChangeFactor = 0.2,
  ) {
    const now = Date.now()
    if(this.lastType !== type || this.lastTap < now - this.msPB * gap) {
      // first tap
      this.lastType = type
      this.lastTap = now
      this.changeFactor = initialChangeFactor
      this.shiftFactor = initialShiftFactor
    } else {
      const delta = now - this.lastTap

      this.update()

      this.msPB = this.msPB * (1-this.changeFactor) + delta * this.changeFactor
      this.lastTap = now

      const phase = this.beat % 1
      if(phase < 0.5) {
        this.beatShiftPerMs = - (phase * this.shiftFactor) / this.msPB
      } else {
        this.beatShiftPerMs = + ((1 - phase) * this.shiftFactor) / this.msPB
      }
      this.beatShiftUntil = this.ms + this.msPB

      this.changeFactor *= factorReduction
      this.shiftFactor *= factorReduction

      this.BPS = 1000 / this.msPB
      this.onBPSChange.forEach(f => {
        f(this.BPS) 
      })
    }
  }

  getSeconds() {
    return this.seconds
  }

  getBeat() {
    return this.beat
  }

  getBar() {
    return this.bar
  }

  getStrophe() {
    return this.bar / 4
  }

  getSustain(exponent: number = 0.3) {
    return Math.pow(exponent, this.tickDeltaS)
  }

  setBar() {
    this.update()
    let phase = (this.bar % 1) * 4
    let target = Math.round(phase)
    if(target > 2) {
      this.beat += 4 - target
    } else {
      this.beat -= target
    }
  }

  setStrophe() {
    this.update()
    let phase = (this.bar / 4 % 1) * 16
    let target = Math.round(phase)
    if(target > 8) {
      this.beat += 16 - target
    } else {
      this.beat -= target
    }
  }

  getTickDeltaMS() {
    return this.tickDeltaMS
  }

  getTickDeltaS() {
    return this.tickDeltaS 
  }

  getTickDeltaBeat() {
    return this.tickDeltaMS / this.msPB
  }

  registerQueue(queue: Queue) {
    this.queues.push(queue)
  }

  removeQueue(queue: Queue) {
    const index = this.queues.indexOf(queue)
    if(index > -1) {
      this.queues.splice(index, 1)
    }
  }

  notifyQueues() {
    this.queues.forEach(queue => {
      queue.notify(this.beat, this.msPB)
    })
  }

  registerDynamicTime(dynamicTime: DynamicTime) {
    this.dynamicTimes.push(dynamicTime)
  }

  removeDynamicTime(dynamicTime: DynamicTime) {
    const index = this.dynamicTimes.indexOf(dynamicTime)
    if(index > -1) {
      this.dynamicTimes.splice(index, 1)
    }
  }

  updatedDynamicTimes(delta: number) {
    this.dynamicTimes.forEach(dynamicTime => {
      dynamicTime.tick(delta)
    })
  }

  getMsPB() {
    return this.msPB
  }

  repeatBeat() {
    this.beat -= 1
  }

  skipBeat() {
    this.beat += 1
  }

}