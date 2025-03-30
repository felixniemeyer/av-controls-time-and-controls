import { Clock, Queue } from './clock'

interface Tap {
  on: number
  velocity: number
  duration: number
}

export default class TapPattern {
  recordStart: number = -1

  preventAll = false

  tapId = 0
  pattern: Tap[] = []

  cycleStart = 0

  queue: Queue

  constructor(
    private clock: Clock, 
    public onOn: (velocity: number) => void = (_) => {},
    public onOff: () => void = () => {},
    private beatsPerCycle = 8, 
    lookAhead = 70, // ms
    private latencyCompensate = 1000 / 60, // ms
  ) {
    this.queue = new Queue(
      beatsPerCycle, 
      lookAhead
    )
    clock.registerQueue(this.queue)
  }

  tap(velocity = 1) {
    this.clock.update()
    const cycle = this.getCycle()
    let phase = cycle - this.recordStart
    if(phase >= 1) {
      this.recordStart = cycle
      phase = 0
      this.queue.cancelAll()
      this.preventAll = true
      this.tapId = 0
      this.pattern = []
      this.cycleStart = cycle + 1 - this.latencyCompensate / this.clock.getMsPB()
      this.queue.whenT(this.cycleStart, msTill => {
        setTimeout(() => {
          this.preventAll = false
          this.tapId = 0
          this.onOn(velocity)
          this.waitForOff()
        }, msTill)
      })
    } 
    this.pattern.push({
      on: phase,
      velocity,
      duration: 1 - phase, // default, if the off doesn't get set
    })
    this.onOn(velocity)
  }

  release() {
    this.clock.update()
    const cycle = this.getCycle()
    const phase = cycle - this.recordStart
    if(phase < 1) { // otherwise it get's ended automatically
      const tap = this.pattern[this.tapId]
      tap.duration = phase - tap.on 
      this.tapId++
      this.onOff()
    }
  }

  getCycle() {
    return this.clock.getBeat() / this.beatsPerCycle
  }

  // find a clean solution. use xournalpp
  waitForOn() {
    this.tapId += 1
    if(this.tapId < this.pattern.length) {
      const tap = this.pattern[this.tapId]
      const onAt = this.cycleStart + tap.on
      this.queue.whenT(onAt, msTill => {
        setTimeout(() => {
          if(!this.preventAll) {
            this.onOn(tap.velocity)
          }
        }, msTill)
        this.waitForOff()
      }) 
    } else {
      // new cycle, prevent drift
      const nextCycleStart = this.cycleStart + 1 
      this.queue.whenT(nextCycleStart, msTill => {
        this.cycleStart = nextCycleStart
        this.tapId = 0
        const tap = this.pattern[this.tapId]
        setTimeout(() => {
          if(!this.preventAll) {
            this.onOn(tap.velocity)
          }
        }, msTill)
        this.waitForOff()
      })
    }
  }

  private waitingForOff = false
  waitForOff() {
    this.waitingForOff = true
    const tap = this.pattern[this.tapId]
    const offAt = this.cycleStart + tap.on + tap.duration
    this.queue.whenT(offAt, msTill => {
      setTimeout(() => {
        if(!this.preventAll) {
          this.onOff()
        }
      }, msTill)
      this.waitForOn()
      this.waitingForOff = false
    }) 
  }

  stop() {
    if(this.waitingForOff) {
      this.onOff()
    }
    this.preventAll = true
    this.queue.cancelAll()
  }
}
