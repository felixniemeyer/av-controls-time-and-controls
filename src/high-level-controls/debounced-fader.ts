import { Controls } from 'av-controls'

export class DebouncedFader {
  private fader: Controls.Fader.Receiver
  private timeout: any

  constructor(
    faderSpec: Controls.Fader.Spec, 
    private onValueChange: (value: number) => void,
    private debounceTime: number = 200) {
    this.fader = new Controls.Fader.Receiver(
      faderSpec, 
      (value: number) => {
        if(this.timeout) {
          clearTimeout(this.timeout)
        }

        this.timeout = setTimeout(() => {
          this.onValueChange(value)
        }, this.debounceTime)
      }
    )
  }

  getControl() {
    return this.fader
  }

  getValue() {
    return this.fader.value
  }
}
