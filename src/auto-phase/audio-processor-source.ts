/**
 * Audio processor source code as a string.
 * This is converted to a Blob URL at runtime for AudioWorklet.addModule().
 */
export const audioProcessorSource = `
class PhaseAudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.frameSize = options.processorOptions?.frameSize ?? 400;
    this.monoBuffer = new Float32Array(this.frameSize);
    this.bufferIndex = 0;
  }

  process(inputs, _outputs, _parameters) {
    if (inputs.length === 0 || inputs[0].length === 0) {
      return true;
    }

    const input = inputs[0];
    const numChannels = input.length;
    const numSamples = Math.min(...input.map(ch => ch.length));

    for (let i = 0; i < numSamples; i++) {
      let sum = 0;
      for (let ch = 0; ch < numChannels; ch++) {
        sum += input[ch][i];
      }
      this.monoBuffer[this.bufferIndex] = sum / numChannels;
      this.bufferIndex++;

      if (this.bufferIndex === this.frameSize) {
        this.port.postMessage(new Float32Array(this.monoBuffer));
        this.bufferIndex = 0;
      }
    }

    return true;
  }
}

registerProcessor('phase-audio-processor', PhaseAudioProcessor);
`;

/**
 * Create a Blob URL for the audio processor that can be used with AudioWorklet.addModule().
 */
export function createAudioProcessorUrl(): string {
  const blob = new Blob([audioProcessorSource], { type: 'application/javascript' });
  return URL.createObjectURL(blob);
}
