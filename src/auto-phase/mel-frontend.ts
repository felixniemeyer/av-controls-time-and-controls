/**
 * Mel spectrogram frontend for audio processing.
 * Replicates the mel computation from the dance model.
 */

/**
 * Simple real FFT implementation using Cooley-Tukey algorithm.
 * Returns [real0, imag0, real1, imag1, ...] for positive frequencies.
 */
function realFFT(input: Float32Array): Float32Array {
  const n = input.length

  // Ensure power of 2
  if ((n & (n - 1)) !== 0) {
    throw new Error('FFT size must be power of 2')
  }

  // Bit-reversal permutation
  const real = new Float32Array(n)
  const imag = new Float32Array(n)

  for (let i = 0; i < n; i++) {
    let j = 0
    let x = i
    for (let k = 0; k < Math.log2(n); k++) {
      j = (j << 1) | (x & 1)
      x >>= 1
    }
    real[j] = input[i]!
  }

  // Cooley-Tukey FFT
  for (let size = 2; size <= n; size *= 2) {
    const halfSize = size / 2
    const angleStep = -2 * Math.PI / size

    for (let i = 0; i < n; i += size) {
      for (let j = 0; j < halfSize; j++) {
        const angle = angleStep * j
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)

        const evenIdx = i + j
        const oddIdx = i + j + halfSize

        const tReal = cos * real[oddIdx]! - sin * imag[oddIdx]!
        const tImag = sin * real[oddIdx]! + cos * imag[oddIdx]!

        real[oddIdx] = real[evenIdx]! - tReal
        imag[oddIdx] = imag[evenIdx]! - tImag
        real[evenIdx] = real[evenIdx]! + tReal
        imag[evenIdx] = imag[evenIdx]! + tImag
      }
    }
  }

  // Return positive frequencies only (n/2 + 1 complex values)
  const nFreqs = n / 2 + 1
  const result = new Float32Array(nFreqs * 2)
  for (let i = 0; i < nFreqs; i++) {
    result[i * 2] = real[i]!
    result[i * 2 + 1] = imag[i]!
  }

  return result
}

/**
 * Convert frequency in Hz to mel scale.
 */
function hzToMel(f: number): number {
  return 2595 * Math.log10(1 + f / 700)
}

/**
 * Convert mel scale to frequency in Hz.
 */
function melToHz(m: number): number {
  return 700 * (Math.pow(10, m / 2595) - 1)
}

/**
 * Build a Hann window of the specified size.
 */
function buildHannWindow(size: number): Float32Array {
  const window = new Float32Array(size)
  for (let i = 0; i < size; i++) {
    // Periodic Hann window (matching torch.hann_window default)
    window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / size))
  }
  return window
}

/**
 * Build a mel filterbank matrix.
 * @returns Flattened array [nMels * nFreqs] representing the filterbank
 */
function buildMelFilterbank(
  nMels: number,
  nFreqs: number,
  sampleRate: number,
  fMin: number,
  fMax: number
): Float32Array {
  const filterbank = new Float32Array(nMels * nFreqs)

  // Create mel-spaced center frequencies
  const melMin = hzToMel(fMin)
  const melMax = hzToMel(fMax)
  const melPoints = new Float32Array(nMels + 2)

  for (let i = 0; i < nMels + 2; i++) {
    melPoints[i] = melMin + (melMax - melMin) * i / (nMels + 1)
  }

  // Convert mel points back to Hz
  const hzPoints = melPoints.map(m => melToHz(m))

  // Create frequency axis
  const freqs = new Float32Array(nFreqs)
  const nyquist = sampleRate / 2
  for (let i = 0; i < nFreqs; i++) {
    freqs[i] = nyquist * i / (nFreqs - 1)
  }

  // Build triangular filters
  for (let m = 0; m < nMels; m++) {
    const lo = hzPoints[m]!
    const ctr = hzPoints[m + 1]!
    const hi = hzPoints[m + 2]!

    let sum = 0
    for (let f = 0; f < nFreqs; f++) {
      const freq = freqs[f]!
      let val = 0

      if (freq >= lo && freq <= ctr) {
        // Rising edge
        val = (freq - lo) / (ctr - lo + 1e-8)
      } else if (freq > ctr && freq <= hi) {
        // Falling edge
        val = (hi - freq) / (hi - ctr + 1e-8)
      }

      filterbank[m * nFreqs + f] = val
      sum += val
    }

    // Normalize filter
    if (sum > 1e-8) {
      for (let f = 0; f < nFreqs; f++) {
        filterbank[m * nFreqs + f] /= sum
      }
    }
  }

  return filterbank
}

export interface MelFrontendConfig {
  sampleRate?: number
  frameSize?: number
  fftFrames?: number
  nMels?: number
  fMin?: number
  fMax?: number
}

/**
 * Mel spectrogram frontend that processes raw audio frames.
 * Matches the Python implementation in dance/models/mel_frontend.py.
 */
export class MelFrontend {
  readonly sampleRate: number
  readonly frameSize: number
  readonly fftFrames: number
  readonly nFft: number
  readonly nFreqs: number
  readonly nMels: number
  readonly fMin: number
  readonly fMax: number

  private filterbank: Float32Array
  private hannWindow: Float32Array
  private causalBuffer: Float32Array
  private fftSize: number  // Padded to power of 2 for FFT

  constructor(config: MelFrontendConfig = {}) {
    // Default parameters from checkpoint sweep_L2_H512_M96/26.pt
    this.sampleRate = config.sampleRate ?? 24000
    this.frameSize = config.frameSize ?? 400
    this.fftFrames = config.fftFrames ?? 2
    this.nMels = config.nMels ?? 96
    this.fMin = config.fMin ?? 27.5
    this.fMax = config.fMax ?? 8000

    this.nFft = this.fftFrames * this.frameSize

    // Pad to next power of 2 for FFT
    this.fftSize = 1
    while (this.fftSize < this.nFft) {
      this.fftSize *= 2
    }
    this.nFreqs = this.fftSize / 2 + 1

    // Pre-compute window (for original nFft) and filterbank (for padded fftSize)
    this.hannWindow = buildHannWindow(this.nFft)
    this.filterbank = buildMelFilterbank(
      this.nMels,
      this.nFreqs,
      this.sampleRate,
      this.fMin,
      this.fMax
    )

    // Causal buffer for previous frames
    this.causalBuffer = new Float32Array((this.fftFrames - 1) * this.frameSize)
  }

  /**
   * Process a single audio frame and return mel features.
   * @param frame Raw audio samples [frameSize]
   * @returns Log-mel features [nMels]
   */
  process(frame: Float32Array): Float32Array {
    if (frame.length !== this.frameSize) {
      throw new Error(`Expected frame size ${this.frameSize}, got ${frame.length}`)
    }

    // Concatenate causal buffer with new frame
    const audio = new Float32Array(this.nFft)
    audio.set(this.causalBuffer, 0)
    audio.set(frame, this.causalBuffer.length)

    // Update causal buffer (shift left by frameSize, append new frame)
    if (this.fftFrames > 2) {
      // Shift existing content
      for (let i = 0; i < (this.fftFrames - 2) * this.frameSize; i++) {
        this.causalBuffer[i] = this.causalBuffer[i + this.frameSize]!
      }
    }
    if (this.fftFrames > 1) {
      // Append new frame to causal buffer
      this.causalBuffer.set(frame, (this.fftFrames - 2) * this.frameSize)
    }

    // Apply Hann window and zero-pad to power-of-2 for FFT
    const windowed = new Float32Array(this.fftSize)
    for (let i = 0; i < this.nFft; i++) {
      windowed[i] = audio[i]! * this.hannWindow[i]!
    }
    // Remaining samples are already 0 (zero-padding)

    // Compute FFT
    const spectrum = realFFT(windowed)

    // Compute power spectrum
    const power = new Float32Array(this.nFreqs)
    for (let i = 0; i < this.nFreqs; i++) {
      const re = spectrum[i * 2]!
      const im = spectrum[i * 2 + 1]!
      power[i] = re * re + im * im
    }

    // Apply mel filterbank: [nMels] = [nMels x nFreqs] @ [nFreqs]
    const mel = new Float32Array(this.nMels)
    for (let m = 0; m < this.nMels; m++) {
      let sum = 0
      for (let f = 0; f < this.nFreqs; f++) {
        sum += this.filterbank[m * this.nFreqs + f]! * power[f]!
      }
      // Log compression with epsilon to avoid log(0)
      mel[m] = Math.log(sum + 1e-6)
    }

    return mel
  }

  /**
   * Reset the causal buffer (call when audio stream restarts).
   */
  reset() {
    this.causalBuffer.fill(0)
  }

  /**
   * Process a silence frame (all zeros).
   */
  processSilence(): Float32Array {
    const silence = new Float32Array(this.frameSize)
    return this.process(silence)
  }
}
