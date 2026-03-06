/**
 * Vite plugin for AutoPhase ONNX runtime support.
 *
 * Usage in artwork's vite.config.ts:
 * ```ts
 * import { autoPhaseVitePlugin } from 'time-n-controls/vite-plugin'
 * import { viteStaticCopy } from 'vite-plugin-static-copy'
 *
 * export default defineConfig({
 *   plugins: [
 *     autoPhaseVitePlugin(),
 *     // Copy WASM files for ONNX runtime
 *     viteStaticCopy({
 *       targets: [{
 *         src: 'node_modules/onnxruntime-web/dist/*.wasm',
 *         dest: '.'
 *       }]
 *     }),
 *     // ... other plugins
 *   ]
 * })
 * ```
 */

interface VitePlugin {
  name: string
  config?: () => {
    optimizeDeps?: { exclude?: string[] }
    server?: { fs?: { allow?: string[] } }
  }
}

/**
 * Vite plugin that configures onnxruntime-web to work correctly.
 * - Excludes onnxruntime-web from Vite's dependency optimization
 * - Allows serving files from parent directories (for time-n-controls' node_modules)
 */
export function autoPhaseVitePlugin(): VitePlugin {
  return {
    name: 'auto-phase-onnx',
    config() {
      return {
        optimizeDeps: {
          exclude: ['onnxruntime-web']
        },
        server: {
          fs: {
            allow: ['..']
          }
        }
      }
    }
  }
}
