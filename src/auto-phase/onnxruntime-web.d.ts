/**
 * Type declarations for onnxruntime-web.
 * This is a minimal declaration for the types used by AutoPhase.
 * Full types are available when onnxruntime-web is installed.
 */
declare module 'onnxruntime-web' {
  export class Tensor {
    constructor(
      type: string,
      data: Float32Array | Int32Array | Uint8Array | BigInt64Array,
      dims: number[]
    )
    readonly data: Float32Array | Int32Array | Uint8Array | BigInt64Array
    readonly dims: readonly number[]
    readonly type: string
    dispose(): void
  }

  export interface RunOptions {
    [key: string]: unknown
  }

  export interface InferenceSession {
    run(
      feeds: { [name: string]: Tensor },
      options?: RunOptions
    ): Promise<{ [name: string]: Tensor }>
    inputNames: readonly string[]
    outputNames: readonly string[]
    dispose?(): Promise<void>
  }

  export namespace InferenceSession {
    function create(path: string): Promise<InferenceSession>
    function create(buffer: ArrayBuffer): Promise<InferenceSession>
  }
}
