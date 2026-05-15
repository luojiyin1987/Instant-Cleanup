import { loadModelBuffer } from './model-cache'
import type { SessionState } from '../types'

type RuntimeProvider = 'webgpu' | 'wasm'
type OrtModule = typeof import('onnxruntime-web/webgpu')

const DEFAULT_LOCAL_MODEL_URL = '/models/lama_fp32.onnx'
const DEFAULT_PRODUCTION_MODEL_URL =
  'https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx'
const ORT_CDN_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/'
const ORT_CDN_WASM_MJS_URL = `${ORT_CDN_BASE}ort-wasm-simd-threaded.jsep.mjs`
const ORT_CDN_WASM_BIN_URL = `${ORT_CDN_BASE}ort-wasm-simd-threaded.jsep.wasm`

let sessionPromise:
  | Promise<{
      ort: OrtModule
      provider: RuntimeProvider
      session: import('onnxruntime-web/webgpu').InferenceSession
    }>
  | null = null

interface SessionMetricsUpdate {
  modelUrl?: string
  modelSource?: 'network' | 'cache'
  modelBytes?: number
  downloadedBytes?: number
  totalBytes?: number | null
  downloadProgressPct?: number | null
  sessionInitMs?: number
}

export function getInpaintSession(
  onStatus?: (status: SessionState) => void,
  onMetrics?: (update: SessionMetricsUpdate) => void,
) {
  if (!sessionPromise) {
    sessionPromise = createInpaintSession(onStatus, onMetrics)
  }

  return sessionPromise
}

export function getConfiguredModelUrl() {
  return (
    import.meta.env.VITE_MODEL_URL ||
    (import.meta.env.DEV ? DEFAULT_LOCAL_MODEL_URL : DEFAULT_PRODUCTION_MODEL_URL)
  )
}

async function createInpaintSession(
  onStatus?: (status: SessionState) => void,
  onMetrics?: (update: SessionMetricsUpdate) => void,
): Promise<{
  ort: OrtModule
  provider: RuntimeProvider
  session: import('onnxruntime-web/webgpu').InferenceSession
}> {
  const updateStatus = (status: SessionState) => {
    onStatus?.(status)
  }

  updateStatus({
    status: 'loading',
    provider: null,
    message: 'Loading ONNX Runtime…',
  })

  const ort = await import('onnxruntime-web/webgpu')
  const wasmPaths = await resolveOrtWasmPaths()
  ort.env.logLevel = 'warning'
  ort.env.wasm.numThreads = 1
  ort.env.wasm.wasmPaths = wasmPaths

  const modelUrl = getConfiguredModelUrl()
  const cacheBustedModelUrl = `${modelUrl}${modelUrl.includes('?') ? '&' : '?'}v=2026-05-15`

  onMetrics?.({
    modelUrl,
    downloadProgressPct: null,
  })

  updateStatus({
    status: 'loading',
    provider: null,
    message: 'Loading model binary…',
  })

  const sessionInitStart = performance.now()
  const { buffer, byteLength, source } = await loadModelBuffer(cacheBustedModelUrl, {
    onProgress: ({ downloadedBytes, percent, source, totalBytes }) => {
      onMetrics?.({
        modelSource: source,
        downloadedBytes,
        totalBytes,
        downloadProgressPct: percent,
      })
      updateStatus({
        status: 'loading',
        provider: null,
        message:
          source === 'cache'
            ? 'Loading model from browser cache…'
            : `Downloading model…${percent !== null ? ` ${percent}%` : ''}`,
      })
    },
  })

  onMetrics?.({
    modelSource: source,
    modelBytes: byteLength,
    downloadedBytes: byteLength,
    totalBytes: byteLength,
    downloadProgressPct: 100,
  })

  const webGpuCapable =
    typeof navigator !== 'undefined' &&
    'gpu' in navigator &&
    typeof navigator.gpu?.requestAdapter === 'function'

  if (webGpuCapable) {
    try {
      ort.env.wasm.proxy = false
      updateStatus({
        status: 'loading',
        provider: 'webgpu',
        message: 'Initializing WebGPU session…',
      })
      const session = await ort.InferenceSession.create(buffer, {
        executionProviders: ['webgpu'],
      })
      onMetrics?.({
        sessionInitMs: performance.now() - sessionInitStart,
      })
      updateStatus({
        status: 'ready',
        provider: 'webgpu',
        message: 'WebGPU session ready.',
      })
      return {
        ort,
        provider: 'webgpu',
        session,
      }
    } catch (error) {
      console.warn('WebGPU session failed, falling back to WASM.', error)
    }
  }

  ort.env.wasm.proxy = false
  updateStatus({
    status: 'loading',
    provider: 'wasm',
    message: 'WebGPU unavailable. Starting single-threaded WASM session…',
  })
  const session = await ort.InferenceSession.create(buffer, {
    executionProviders: ['wasm'],
  })
  onMetrics?.({
    sessionInitMs: performance.now() - sessionInitStart,
  })
  updateStatus({
    status: 'ready',
    provider: 'wasm',
    message: 'Single-threaded WASM session ready.',
  })

  return {
    ort,
    provider: 'wasm',
    session,
  }
}

async function resolveOrtWasmPaths() {
  if (import.meta.env.DEV) {
    const [{ default: localMjsUrl }, { default: localWasmUrl }] = await Promise.all([
      import('../generated/ort/ort-wasm-simd-threaded.jsep.mjs?url'),
      import('../generated/ort/ort-wasm-simd-threaded.jsep.wasm?url'),
    ])

    return {
      mjs: localMjsUrl,
      wasm: localWasmUrl,
    }
  }

  return {
    mjs: ORT_CDN_WASM_MJS_URL,
    wasm: ORT_CDN_WASM_BIN_URL,
  }
}
