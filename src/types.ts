export type ToolMode = 'brush' | 'erase'

export interface Stroke {
  mode: ToolMode
  points: number[]
  size: number
}

export interface LoadedImage {
  name: string
  src: string
  width: number
  height: number
  element: HTMLImageElement
}

export interface RoiRect {
  x: number
  y: number
  width: number
  height: number
}

export interface SessionState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  provider: 'webgpu' | 'wasm' | null
  message: string
}

export interface RuntimeStepMetric {
  label: string
  durationMs: number
}

export interface RuntimeMetrics {
  modelUrl: string | null
  modelSource: 'pending' | 'network' | 'cache' | 'memory'
  modelBytes: number | null
  downloadedBytes: number
  totalBytes: number | null
  downloadProgressPct: number | null
  sessionInitMs: number | null
  inferenceMs: number | null
  stepTimings: RuntimeStepMetric[]
}
