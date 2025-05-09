import { Controls } from 'av-controls'
import { Clock } from './clock'

export class BPMBasics {
  private barCake = new Controls.Cake.Receiver(new Controls.Cake.Spec(
    new Controls.Base.Args(
    'bar', 0, 0, 50, 20, '#f0f'
    ), 0, 1, 0, 2
  ))
  private stropheCake = new Controls.Cake.Receiver(new Controls.Cake.Spec(
    new Controls.Base.Args(
    '4bars', 50, 0, 50, 20, '#f0f'
    ), 0, 1, 0, 2
  ))

  private controlsGroup: Controls.Group.Receiver

  getControlGroup() {
    return this.controlsGroup
  }

  constructor(private clock: Clock, x: number, y: number, w: number, h: number) {

    const bStart = 20
    const bHeight = 80 / 5

    this.controlsGroup = new Controls.Group.Receiver(new Controls.Group.SpecWithoutControls(

      new Controls.Base.Args(
        'bpm basics', x, y, w, h, '#f00'
      )),
      {
        'bar cake': this.barCake, 
        'strophe cake': this.stropheCake, 
        'bar set': new Controls.Pad.Receiver(new Controls.Pad.Spec(
          new Controls.Base.Args(
            'set bar start', 0, bStart, 100, bHeight, '#fa5'
          )), 
          () => {
            this.clock.setBar()
          }
        ),
        'set strophe': new Controls.Pad.Receiver(new Controls.Pad.Spec(
          new Controls.Base.Args(
            'set strophe', 0, bStart + bHeight, 100, bHeight, '#2af'
          )), 
          () => {
            this.clock.setStrophe()
          }
        ),
        'bpm tap live': new Controls.Pad.Receiver(new Controls.Pad.Spec(
          new Controls.Base.Args(
            'bpm tap live', 0, bStart + bHeight*2, 100, bHeight, '#aa3'
        )), 
          () => {
            this.clock.bpmTap()
          }
        ),
        'bpm tap accu': new Controls.Pad.Receiver(new Controls.Pad.Spec(
          new Controls.Base.Args(
            'bpm tap accu', 0, bStart + bHeight*3, 100, bHeight, '#0a9'
          )), 
        () => {
          this.clock.bpmTap(
            'accu', 0.8, 7, 1, 1
          )
        }), 
        'bpm tap slight': new Controls.Pad.Receiver(new Controls.Pad.Spec(
          new Controls.Base.Args(
          'bpm tap adjust', 0, bStart + bHeight*4, 100, bHeight, '#a03'
        )), 
        () => {
          this.clock.bpmTap(
            'adjust', 1, 3, 0.15, 0.01
          )
        })
      },
    )
  }
  sendValues() {
    this.barCake.sendValue(this.clock.getBar())
    this.stropheCake.sendValue(this.clock.getStrophe())
  }
}
