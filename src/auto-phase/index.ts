import * as ort from 'onnxruntime-web'
import { Controls } from 'av-controls'
import { MelFrontend, MelFrontendConfig } from './mel-frontend'
import { AutoPhaseClock } from './phase-clock'
import { PhaseClock } from '../phase-clock'
import { PhaseQueue } from '../phase-queue'
import { createAudioProcessorUrl } from './audio-processor-source'

// Re-export for convenience
export { MelFrontend } from './mel-frontend'
export type { MelFrontendConfig } from './mel-frontend'
export { AutoPhaseClock } from './phase-clock'
export { createAudioProcessorUrl } from './audio-processor-source'

export interface AutoPhaseConfig {
  /** Path to the ONNX model file (in artwork's public directory) */
  modelPath: string
  /** Menu control spec - artwork defines position/size, AutoPhase manages options */
  menuSpec: Controls.Menu.Spec
  /** LocalStorage key for device preference */
  storageKey?: string
  /** Mel frontend configuration */
  melConfig?: MelFrontendConfig
  /** Target sample rate (default 24000) */
  sampleRate?: number
  /** Audio frame size (default 400) */
  frameSize?: number
  /** GRU hidden size (default 512) */
  hiddenSize?: number
  /** Number of GRU layers (default 2) */
  numLayers?: number
  /** Called when an incoming audio frame is dropped in favor of a newer one */
  onAudioFrameDropped?: () => void
}

export type AutoPhaseInputMode = 'disabled' | 'audio device input' | 'simulate'

type AudioDeviceInfo = {
  deviceId: string
  label: string
}

/**
 * AutoPhase: Automatic bar-phase detection using ONNX inference.
 *
 * Usage:
 * ```typescript
 * const autoPhase = new AutoPhase({
 *   modelPath: '/model.onnx',
 *   menuSpec: new Controls.Menu.Spec(
 *     new Controls.Base.Args('audio', 90, 55, 10, 5, '#48f'),
 *     ['Grant mic access'],
 *     'Audio input'
 *   )
 * })
 *
 * // Add menu control to your artwork's controls
 * const controls = {
 *   audio: autoPhase.getMenu(),
 *   // ... other controls
 * }
 *
 * // In render loop
 * function render() {
 *   autoPhase.tick()
 *   const phase = autoPhase.getPhase()
 *   // Use phase for animations...
 * }
 * ```
 */
export class AutoPhase implements PhaseClock {
  private readonly grantAccessLabel = 'Grant mic access'
  private readonly syntheticPhaseRate = 0.5 // 4/4 @ 120 BPM => 0.5 bars/sec

  private session: ort.InferenceSession | null = null
  private hiddenState: ort.Tensor | null = null
  private melFrontend: MelFrontend
  private phaseClock: AutoPhaseClock

  private audioContext: AudioContext | null = null
  private workletNode: AudioWorkletNode | null = null
  private streamSource: MediaStreamAudioSourceNode | null = null
  private currentStream: MediaStream | null = null

  private menuControl: Controls.Menu.Receiver
  private devices: AudioDeviceInfo[] = []
  private permissionGranted = false
  private modelLoaded = false
  private isCapturing = false
  private audioLevel = 0
  private phaseOffsetMs = 0
  private enabled = true
  private inputMode: AutoPhaseInputMode = 'audio device input'
  private selectedDeviceId: string | null = null
  private inferenceInFlight = false
  private pendingAudioFrame: Float32Array | null = null
  private droppedAudioFrames = 0
  private lastDropLogAtMs = -Infinity
  private disposed = false
  private modelLoadGeneration = 0

  private readonly config: Required<Omit<AutoPhaseConfig, 'melConfig' | 'menuSpec' | 'onAudioFrameDropped'>> & { melConfig?: MelFrontendConfig }
  private readonly storageKey: string
  private readonly onAudioFrameDropped?: () => void

  constructor(config: AutoPhaseConfig) {
    this.config = {
      modelPath: config.modelPath,
      storageKey: config.storageKey ?? 'avonx-autophase-device',
      sampleRate: config.sampleRate ?? 24000,
      frameSize: config.frameSize ?? 400,
      hiddenSize: config.hiddenSize ?? 512,
      numLayers: config.numLayers ?? 2,
      melConfig: config.melConfig
    }
    this.storageKey = this.config.storageKey
    this.onAudioFrameDropped = config.onAudioFrameDropped

    // Initialize mel frontend
    this.melFrontend = new MelFrontend({
      sampleRate: this.config.sampleRate,
      frameSize: this.config.frameSize,
      ...this.config.melConfig
    })

    // Initialize phase clock
    this.phaseClock = new AutoPhaseClock()

    // Create menu control for device selection using artwork-provided spec
    this.menuControl = new Controls.Menu.Receiver(
      config.menuSpec,
      (index, _value) => this.handleMenuSelection(index)
    )
    this.menuControl.setOptions([this.grantAccessLabel], 0)
    this.menuControl.setDescription('Audio input device')

    const savedDeviceId = localStorage.getItem(this.storageKey)
    if (savedDeviceId) {
      this.selectedDeviceId = savedDeviceId
    }

    // Start loading the model
    this.loadModel()
  }

  private disposeTensor(tensor: ort.Tensor | null | undefined) {
    if (!tensor) {
      return
    }
    try {
      tensor.dispose()
    } catch (err) {
      console.warn('[AutoPhase] Failed to dispose tensor:', err)
    }
  }

  private logDroppedAudioFrames() {
    if (this.droppedAudioFrames <= 0) {
      return
    }
    const nowMs = performance.now()
    if (nowMs - this.lastDropLogAtMs < 1000) {
      return
    }
    this.lastDropLogAtMs = nowMs
    console.warn(`[AutoPhase] Dropping audio frames, keeping latest only. Dropped=${this.droppedAudioFrames}`)
    this.droppedAudioFrames = 0
  }

  private enqueueAudioFrame(audioFrame: Float32Array) {
    if (this.inferenceInFlight) {
      if (this.pendingAudioFrame) {
        this.droppedAudioFrames++
        this.onAudioFrameDropped?.()
      }
      this.pendingAudioFrame = audioFrame
      this.logDroppedAudioFrames()
      return
    }

    this.inferenceInFlight = true
    void this.processQueuedAudioFrames(audioFrame)
  }

  private async processQueuedAudioFrames(initialFrame: Float32Array) {
    let frame: Float32Array | null = initialFrame

    try {
      while (frame && !this.isDisposed()) {
        await this.processFrame(frame)
        frame = this.pendingAudioFrame
        this.pendingAudioFrame = null
      }
    } finally {
      this.inferenceInFlight = false
      if (!this.isDisposed() && this.pendingAudioFrame) {
        const latestFrame = this.pendingAudioFrame
        this.pendingAudioFrame = null
        this.inferenceInFlight = true
        void this.processQueuedAudioFrames(latestFrame)
      }
    }
  }

  private isDisposed() {
    return this.disposed
  }

  private async loadModel() {
    const loadGeneration = ++this.modelLoadGeneration
    try {
      // Force the lighter single-threaded WASM runtime. The threaded build
      // can fail on constrained browsers/dev setups with executable-memory
      // allocation errors and then poison later backend initialization.
      ort.env.wasm.wasmPaths = './'
      ort.env.wasm.numThreads = 1
      ort.env.wasm.proxy = false

      const session = await ort.InferenceSession.create(this.config.modelPath)
      const disposableSession = session as ort.InferenceSession & { dispose?: () => Promise<void> }
      if (this.disposed || loadGeneration !== this.modelLoadGeneration) {
        if (disposableSession.dispose) {
          void disposableSession.dispose().catch((err: unknown) => {
            console.warn('[AutoPhase] Failed to dispose superseded session:', err)
          })
        }
        return
      }

      this.session = session
      this.resetHiddenState()

      this.modelLoaded = true
      console.log('[AutoPhase] Model loaded successfully')
    } catch (err) {
      console.error('[AutoPhase] Failed to load model:', err)
    }
  }

  private resetHiddenState() {
    this.disposeTensor(this.hiddenState)

    // Initialize hidden state: [numLayers, 1, hiddenSize]
    const stateSize = this.config.numLayers * 1 * this.config.hiddenSize
    this.hiddenState = new ort.Tensor(
      'float32',
      new Float32Array(stateSize),
      [this.config.numLayers, 1, this.config.hiddenSize]
    )
  }

  private async handleMenuSelection(index: number) {
    if (!this.permissionGranted) {
      // Before permission the only option is "Grant mic access"
      await this.requestPermission()
    } else {
      const device = this.devices[index]
      if (device) {
        await this.selectDevice(device.deviceId)
      }
    }
  }

  private async requestPermission() {
    try {
      // Request permission with any audio device
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // Stop the temporary stream
      stream.getTracks().forEach(track => track.stop())

      this.permissionGranted = true
      await this.enumerateDevices()
    } catch (err) {
      console.error('[AutoPhase] Microphone permission denied:', err)
      this.menuControl.setDescription('Microphone access denied')
    }
  }

  private async enumerateDevices() {
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices()
      this.devices = allDevices
        .filter(d => d.kind === 'audioinput')
        .map(d => ({
          deviceId: d.deviceId,
          label: d.label || `Device ${d.deviceId.slice(0, 8)}`
        }))

      // Update menu options
      const options = this.devices.map(d => d.label)
      this.menuControl.setOptions(options, 0)
      this.menuControl.setDescription('Select audio input device')

      // Restore saved preference
      const savedDeviceId = localStorage.getItem(this.storageKey)
      if (savedDeviceId) {
        const idx = this.devices.findIndex(d => d.deviceId === savedDeviceId)
        if (idx >= 0) {
          this.menuControl.setOptions(options, idx)
          await this.selectDevice(savedDeviceId)
        }
      }
    } catch (err) {
      console.error('[AutoPhase] Failed to enumerate devices:', err)
    }
  }

  private async selectDevice(deviceId: string) {
    // Save preference
    localStorage.setItem(this.storageKey, deviceId)
    this.selectedDeviceId = deviceId

    if (this.inputMode === 'audio device input') {
      // Start or switch audio capture
      await this.startCapture(deviceId)
    }
  }

  private stopCapture() {
    if (this.currentStream) {
      this.currentStream.getTracks().forEach(track => track.stop())
      this.currentStream = null
    }
    if (this.streamSource) {
      this.streamSource.disconnect()
      this.streamSource = null
    }
    this.isCapturing = false
    this.audioLevel = 0
  }

  private async startCapture(deviceId: string) {
    try {
      // Create audio context at target sample rate if not exists
      if (!this.audioContext) {
        this.audioContext = new AudioContext({ sampleRate: this.config.sampleRate })
      }

      // Resume if suspended
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume()
      }

      // Register worklet if not already registered
      if (!this.workletNode) {
        const processorUrl = createAudioProcessorUrl()
        await this.audioContext.audioWorklet.addModule(processorUrl)
        URL.revokeObjectURL(processorUrl)
      }

      // Stop previous stream
      this.stopCapture()

      // Get new stream
      this.currentStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId },
          sampleRate: { ideal: this.config.sampleRate },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      })

      // Create source node
      this.streamSource = this.audioContext.createMediaStreamSource(this.currentStream)

      // Create or reuse worklet node
      if (!this.workletNode) {
        this.workletNode = new AudioWorkletNode(this.audioContext, 'phase-audio-processor', {
          processorOptions: { frameSize: this.config.frameSize }
        })

        this.workletNode.port.onmessage = (event) => {
          this.enqueueAudioFrame(event.data as Float32Array)
        }
      }

      // Connect
      this.streamSource.connect(this.workletNode)
      this.isCapturing = true

      console.log('[AutoPhase] Audio capture started')
    } catch (err) {
      console.error('[AutoPhase] Failed to start audio capture:', err)
      this.isCapturing = false
    }
  }

  private async processFrame(audioFrame: Float32Array) {
    // Compute RMS audio level
    let sumSquares = 0
    for (let i = 0; i < audioFrame.length; i++) {
      sumSquares += audioFrame[i]! * audioFrame[i]!
    }
    const rms = Math.sqrt(sumSquares / audioFrame.length)
    // Convert to dB-like scale (0-1 range, with some headroom)
    this.audioLevel = Math.min(1, rms * 5)

    if (this.inputMode !== 'audio device input') {
      return
    }
    if (!this.session || !this.hiddenState || !this.modelLoaded) {
      return
    }
    if (!this.enabled) {
      return
    }

    try {
      // Compute mel spectrogram from audio frame
      const mel = this.melFrontend.process(audioFrame)

      // Create input tensor: [batch=1, seq_len=1, n_mels]
      const melTensor = new ort.Tensor(
        'float32',
        mel,
        [1, 1, this.melFrontend.nMels]
      )

      // Run inference with mel features
      const feeds: Record<string, ort.Tensor> = {
        mel: melTensor,
        state_h: this.hiddenState
      }

      let results: Record<string, ort.Tensor> | null = null
      try {
        results = await this.session.run(feeds)

        // Extract outputs
        const phaseOut = results.phase_out
        const stateHOut = results.state_h_out

        if (phaseOut && stateHOut) {
          const previousHiddenState = this.hiddenState
          this.hiddenState = stateHOut as ort.Tensor

        // Decode phase output: [batch, seq_len, 3] = [sin, cos, log(bar_duration_seconds)]
        const data = phaseOut.data as Float32Array
        const sinPhase = data[0]!
        const cosPhase = data[1]!
        const logBarDuration = data[2]!

        // Decode phase from sin/cos
        const rawPhase = (Math.atan2(sinPhase, cosPhase) / (2 * Math.PI) + 1) % 1

        // Update phase clock
        this.phaseClock.updateFromInference(rawPhase, logBarDuration)

          this.disposeTensor(previousHiddenState)
        }
      } finally {
        this.disposeTensor(melTensor)
        if (results) {
          for (const [name, tensor] of Object.entries(results)) {
            if (name === 'state_h_out' && tensor === this.hiddenState) {
              continue
            }
            this.disposeTensor(tensor)
          }
        }
      }
    } catch (err) {
      console.error('[AutoPhase] Inference error:', err)
    }
  }

  // PhaseClock interface implementation

  getPhase(): number {
    // Apply phase offset: offset_cycles = offset_ms / 1000 * phaseRate
    const offsetCycles = (this.phaseOffsetMs / 1000) * this.phaseClock.getPhaseRate()
    const phase = this.phaseClock.getPhase() + offsetCycles
    // Wrap to [0, 1)
    return ((phase % 1) + 1) % 1
  }

  getUnwrappedPhase(): number {
    const offsetCycles = (this.phaseOffsetMs / 1000) * this.phaseClock.getPhaseRate()
    return this.phaseClock.getUnwrappedPhase() + offsetCycles
  }

  getPredictedUnwrappedPhase(): number {
    const offsetCycles = (this.phaseOffsetMs / 1000) * this.phaseClock.getPhaseRate()
    return this.phaseClock.getPredictedUnwrappedPhase() + offsetCycles
  }

  getPhaseRate(): number {
    return this.phaseClock.getPhaseRate()
  }

  getSeconds(): number {
    return this.phaseClock.getSeconds()
  }

  getTickDeltaS(): number {
    return this.phaseClock.getTickDeltaS()
  }

  getCappedTickDeltaS(amount?: number): number {
    return this.phaseClock.getCappedTickDeltaS(amount)
  }

  tick(): void {
    this.phaseClock.tick()
    if (this.enabled && this.inputMode === 'simulate') {
      this.phaseClock.advance(this.syntheticPhaseRate)
    }
  }

  registerQueue(queue: PhaseQueue): void {
    this.phaseClock.registerQueue(queue)
  }

  removeQueue(queue: PhaseQueue): void {
    this.phaseClock.removeQueue(queue)
  }

  reset(): void {
    this.phaseClock.reset()
    this.melFrontend.reset()
    this.resetHiddenState()
  }

  // Public API

  /**
   * Get the Menu control for device selection.
   * Add this to your artwork's controls dictionary.
   */
  getMenu(): Controls.Menu.Receiver {
    return this.menuControl
  }

  setInputMode(mode: AutoPhaseInputMode): void {
    if (this.inputMode === mode) {
      return
    }

    this.inputMode = mode
    this.reset()

    if (mode === 'disabled') {
      this.stopCapture()
      return
    }

    if (mode === 'simulate') {
      this.stopCapture()
      this.phaseClock.setPhaseRate(this.syntheticPhaseRate)
      return
    }

    // mode === 'audio device input'
    if (this.permissionGranted && this.selectedDeviceId) {
      void this.startCapture(this.selectedDeviceId)
    } else {
      this.stopCapture()
    }
  }

  getInputMode(): AutoPhaseInputMode {
    return this.inputMode
  }

  /**
   * Check if the model is loaded and ready.
   */
  isReady(): boolean {
    return this.modelLoaded
  }

  /**
   * Check if audio capture is active.
   */
  isActive(): boolean {
    return this.isCapturing
  }

  /**
   * Get the current audio input level (0-1 range).
   */
  getAudioLevel(): number {
    return this.audioLevel
  }

  /**
   * Set the phase offset in milliseconds for latency compensation.
   * Positive values shift the phase forward (compensate for visual delay).
   * Negative values shift the phase backward.
   */
  setPhaseOffset(ms: number): void {
    this.phaseOffsetMs = ms
  }

  /**
   * Get the current phase offset in milliseconds.
   */
  getPhaseOffset(): number {
    return this.phaseOffsetMs
  }

  setPhaseSmoothing(value: number): void {
    this.phaseClock.setPhaseSmoothing(value)
  }

  getPhaseSmoothing(): number {
    return this.phaseClock.getPhaseSmoothing()
  }

  /**
   * Enable auto phase inference.
   */
  async start(): Promise<void> {
    this.enabled = true
    if (this.inputMode === 'simulate') {
      this.phaseClock.setPhaseRate(this.syntheticPhaseRate)
    }
  }

  /**
   * Disable auto phase inference while keeping audio input active.
   */
  stop(): void {
    this.enabled = false
    this.reset()
  }

  /**
   * Check if auto phase detection is enabled.
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Feed a silence frame (for background tab or no audio).
   */
  feedSilence() {
    if (!this.modelLoaded || !this.enabled) return

    // Process silence through mel frontend and inference
    const silenceFrame = new Float32Array(this.config.frameSize)
    this.enqueueAudioFrame(silenceFrame)
  }

  /**
   * Stop audio capture and release resources.
   */
  dispose() {
    this.disposed = true
    this.modelLoadGeneration += 1
    this.modelLoaded = false
    this.stopCapture()

    if (this.workletNode) {
      this.workletNode.port.onmessage = null
      this.workletNode.disconnect()
      this.workletNode = null
    }

    if (this.audioContext) {
      void this.audioContext.close().catch((err: unknown) => {
        console.warn('[AutoPhase] Failed to close audio context:', err)
      })
      this.audioContext = null
    }

    this.pendingAudioFrame = null
    this.inferenceInFlight = false
    this.droppedAudioFrames = 0

    this.disposeTensor(this.hiddenState)
    this.hiddenState = null

    const session = this.session as (ort.InferenceSession & { dispose?: () => Promise<void> }) | null
    if (session?.dispose) {
      void session.dispose().catch((err: unknown) => {
        console.warn('[AutoPhase] Failed to dispose session:', err)
      })
    }
    this.session = null

    this.isCapturing = false
  }
}
