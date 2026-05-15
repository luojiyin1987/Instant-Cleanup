import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import './App.css'
import { MaskStage } from './components/MaskStage'
import { useElementSize } from './hooks/useElementSize'
import { runInpaint } from './lib/inpaint'
import { getInpaintSession } from './lib/ort'
import {
  loadImageFile,
  revokeImageSourceUrl,
} from './lib/image-utils'
import type { LoadedImage, RuntimeMetrics, SessionState, Stroke, ToolMode } from './types'

const DEFAULT_BRUSH_SIZE = 40
const SESSION_TIMEOUT_MS = 90_000
const INFERENCE_TIMEOUT_MS = 120_000

function App() {
  const [sourceImage, setSourceImage] = useState<LoadedImage | null>(null)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [toolMode, setToolMode] = useState<ToolMode>('brush')
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH_SIZE)
  const [sessionState, setSessionState] = useState<SessionState>({
    status: 'idle',
    provider: null,
    message: 'Model not loaded yet. First run will download and initialize LaMa in your browser.',
  })
  const [runState, setRunState] = useState<{
    status: 'idle' | 'running' | 'error' | 'done'
    message: string
  }>({
    status: 'idle',
    message: 'Upload an image, paint the object you want removed, then run local repair.',
  })
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [resultName, setResultName] = useState<string>('instant-cleanup.png')
  const [runtimeMetrics, setRuntimeMetrics] = useState<RuntimeMetrics>({
    modelUrl: null,
    modelSource: 'pending',
    modelBytes: null,
    downloadedBytes: 0,
    totalBytes: null,
    downloadProgressPct: null,
    sessionInitMs: null,
    inferenceMs: null,
    stepTimings: [],
  })

  const editorRef = useRef<HTMLDivElement | null>(null)
  const { width: editorWidth } = useElementSize(editorRef)
  const imageStageMaxWidth = Math.max(editorWidth - 36, 320)

  const sourceImageRef = useRef<LoadedImage | null>(null)
  const resultUrlRef = useRef<string | null>(null)
  const sessionPromiseRef = useRef<ReturnType<typeof getInpaintSession> | null>(null)

  useEffect(() => {
    sourceImageRef.current = sourceImage
  }, [sourceImage])

  useEffect(() => {
    resultUrlRef.current = resultUrl
  }, [resultUrl])

  useEffect(() => {
    return () => {
      if (sourceImageRef.current) {
        revokeImageSourceUrl(sourceImageRef.current)
      }
      if (resultUrlRef.current) {
        URL.revokeObjectURL(resultUrlRef.current)
      }
    }
  }, [])

  const ensureSession = () => {
    if (!sessionPromiseRef.current) {
      sessionPromiseRef.current = getInpaintSession(
        (status) => {
          setSessionState(status)
        },
        (update) => {
          setRuntimeMetrics((previous) => ({
            ...previous,
            ...update,
          }))
        },
      )
    } else {
      setRuntimeMetrics((previous) => ({
        ...previous,
        modelSource: previous.modelSource === 'pending' ? 'memory' : previous.modelSource,
      }))
    }

    return sessionPromiseRef.current
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    try {
      const image = await loadImageFile(file)
      setSourceImage((previous) => {
        if (previous) {
          revokeImageSourceUrl(previous)
        }
        return image
      })
      setStrokes([])
      setRunState({
        status: 'idle',
        message:
          'Mask the unwanted area. First run will initialize the model; later runs reuse the same session.',
      })

      setResultUrl((previous) => {
        if (previous) {
          URL.revokeObjectURL(previous)
        }
        return null
      })
      setResultName(file.name.replace(/\.[^.]+$/, '') + '-cleanup.png')
    } catch (error) {
      setRunState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unable to load the selected image.',
      })
    } finally {
      event.target.value = ''
    }
  }

  const handleRun = async () => {
    if (!sourceImage) {
      setRunState({
        status: 'error',
        message: 'Select an image first.',
      })
      return
    }

    if (!strokes.length) {
      setRunState({
        status: 'error',
        message: 'Paint at least one mask stroke before running inference.',
      })
      return
    }

    try {
      setRunState({
        status: 'running',
        message: 'Preparing model session…',
      })
      setRuntimeMetrics((previous) => ({
        ...previous,
        inferenceMs: null,
        stepTimings: [],
      }))

      const { ort, provider, session } = await withTimeout(
        ensureSession(),
        SESSION_TIMEOUT_MS,
        'Model initialization timed out. This usually means the model download or session creation stalled.',
      )
      setRunState({
        status: 'running',
        message:
          provider === 'webgpu'
            ? 'WebGPU session ready. Cropping ROI and running local repair…'
            : 'WASM session ready. Cropping ROI and running local repair…',
      })
      const result = await withTimeout(
        runInpaint({
          image: sourceImage,
          ort,
          session,
          strokes,
          stageMaxWidth: imageStageMaxWidth,
          onProgress: (message) => {
            setRunState({
              status: 'running',
              message,
            })
          },
        }),
        INFERENCE_TIMEOUT_MS,
        'Inference timed out. Try a smaller mask area or verify WebGPU is available.',
      )
      setRuntimeMetrics((previous) => ({
        ...previous,
        inferenceMs: result.totalDurationMs,
        stepTimings: result.stepTimings,
      }))

      setResultUrl((previous) => {
        if (previous) {
          URL.revokeObjectURL(previous)
        }
        return result.downloadUrl
      })
      setResultName(result.fileName)
      setRunState({
        status: 'done',
        message: `Finished with ${provider.toUpperCase()} on a ${result.roi.width}×${result.roi.height} local patch.`,
      })
    } catch (error) {
      setRunState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Local inference failed.',
      })
    }
  }

  const handleUseResult = async () => {
    if (!resultUrl) {
      return
    }

    try {
      const adopted = await loadImageFile(
        new File([await (await fetch(resultUrl)).blob()], resultName, { type: 'image/png' }),
      )
      setSourceImage((previous) => {
        if (previous) {
          revokeImageSourceUrl(previous)
        }
        return adopted
      })
      setStrokes([])
      setRunState({
        status: 'idle',
        message: 'Result promoted to the new base image.',
      })
    } catch (error) {
      setRunState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unable to reuse the generated image.',
      })
    }
  }

  const statusTone =
    sessionState.status === 'error' || runState.status === 'error'
      ? 'danger'
      : runState.status === 'done'
        ? 'success'
        : 'neutral'

  return (
    <main className="shell">
      <section className="hero-panel">
        <p className="eyebrow">Cloudflare Pages · Local ONNX Inpainting</p>
        <h1>Instant Cleanup</h1>
        <p className="hero-copy">
          LaMa runs entirely in the browser. Users paint a mask, the app crops only the
          affected region, normalizes it to 512×512, executes ONNX Runtime Web with
          WebGPU first and WASM as fallback, then feathers the repaired patch back into
          the original image.
        </p>
      </section>

      <section className="workspace">
        <aside className="control-panel">
          <div className="panel-card">
            <h2>Source</h2>
            <label className="upload-button">
              <input accept="image/*" type="file" onChange={handleFileChange} />
              <span>{sourceImage ? 'Replace Image' : 'Upload Image'}</span>
            </label>
            <p className="panel-note">
              Default model path: <code>/models/lama_fp32.onnx</code>
            </p>
            {sourceImage ? (
              <dl className="meta-grid">
                <div>
                  <dt>Name</dt>
                  <dd>{sourceImage.name}</dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>
                    {sourceImage.width}×{sourceImage.height}
                  </dd>
                </div>
              </dl>
            ) : null}
          </div>

          <div className="panel-card">
            <h2>Mask</h2>
            <div className="segmented">
              <button
                type="button"
                className={toolMode === 'brush' ? 'active' : ''}
                onClick={() => setToolMode('brush')}
              >
                Brush
              </button>
              <button
                type="button"
                className={toolMode === 'erase' ? 'active' : ''}
                onClick={() => setToolMode('erase')}
              >
                Erase
              </button>
            </div>
            <label className="range-field">
              <span>Brush size</span>
              <input
                min={8}
                max={180}
                step={2}
                type="range"
                value={brushSize}
                onChange={(event) => setBrushSize(Number(event.target.value))}
              />
              <strong>{brushSize}px</strong>
            </label>
            <div className="inline-actions">
              <button
                type="button"
                onClick={() => setStrokes((previous) => previous.slice(0, -1))}
                disabled={!strokes.length}
              >
                Undo
              </button>
              <button
                type="button"
                onClick={() => setStrokes([])}
                disabled={!strokes.length}
              >
                Clear
              </button>
            </div>
          </div>

          <div className="panel-card">
            <h2>Runtime</h2>
            <dl className="meta-grid">
              <div>
                <dt>Engine</dt>
                <dd>{sessionState.provider ? sessionState.provider.toUpperCase() : 'Pending'}</dd>
              </div>
              <div>
                <dt>Session</dt>
                <dd>{sessionState.status}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>{formatModelSource(runtimeMetrics.modelSource)}</dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>{runtimeMetrics.modelBytes ? formatBytes(runtimeMetrics.modelBytes) : 'Pending'}</dd>
              </div>
              <div>
                <dt>Download</dt>
                <dd>{formatDownload(runtimeMetrics)}</dd>
              </div>
              <div>
                <dt>Init</dt>
                <dd>
                  {runtimeMetrics.sessionInitMs !== null
                    ? formatDuration(runtimeMetrics.sessionInitMs)
                    : 'Pending'}
                </dd>
              </div>
              <div>
                <dt>Inference</dt>
                <dd>
                  {runtimeMetrics.inferenceMs !== null
                    ? formatDuration(runtimeMetrics.inferenceMs)
                    : 'Pending'}
                </dd>
              </div>
            </dl>
            <button
              type="button"
              className="primary-action"
              onClick={handleRun}
              disabled={
                !sourceImage ||
                sessionState.status === 'loading' ||
                runState.status === 'running'
              }
            >
              {runState.status === 'running' ? 'Running…' : 'Run Cleanup'}
            </button>
            <p className={`status-banner ${statusTone}`}>
              {runState.status === 'running' || runState.status === 'done'
                ? runState.message
                : sessionState.message}
            </p>
            {runtimeMetrics.stepTimings.length ? (
              <div className="timing-list">
                {runtimeMetrics.stepTimings.map((step) => (
                  <div key={step.label} className="timing-row">
                    <span>{step.label}</span>
                    <strong>{formatDuration(step.durationMs)}</strong>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {resultUrl ? (
            <div className="panel-card">
              <h2>Output</h2>
              <div className="inline-actions">
                <a className="download-link" href={resultUrl} download={resultName}>
                  Download PNG
                </a>
                <button type="button" onClick={handleUseResult}>
                  Use Result
                </button>
              </div>
            </div>
          ) : null}
        </aside>

        <section className="editor-panel">
          <div className="editor-card" ref={editorRef}>
            {sourceImage ? (
              <MaskStage
                brushSize={brushSize}
                image={sourceImage}
                stageMaxWidth={imageStageMaxWidth}
                strokes={strokes}
                toolMode={toolMode}
                onChange={setStrokes}
                disabled={runState.status === 'running'}
              />
            ) : (
              <div className="empty-state">
                <h2>Load an image to start</h2>
                <p>
                  Paint the unwanted object in red. The app keeps everything on-device and
                  only runs the selected patch through the 512×512 LaMa model.
                </p>
              </div>
            )}
          </div>

          {resultUrl ? (
            <div className="result-card">
              <div className="result-heading">
                <h2>Latest Result</h2>
                <p>Feather-blended patch, ready to download.</p>
              </div>
              <img src={resultUrl} alt="Inpainting result preview" />
            </div>
          ) : null}
        </section>
      </section>
    </main>
  )
}

export default App

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
    }),
  ])
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${Math.round(durationMs)} ms`
  }

  return `${(durationMs / 1000).toFixed(2)} s`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatModelSource(source: RuntimeMetrics['modelSource']): string {
  switch (source) {
    case 'network':
      return 'Network'
    case 'cache':
      return 'Browser Cache'
    case 'memory':
      return 'Current Session'
    default:
      return 'Pending'
  }
}

function formatDownload(metrics: RuntimeMetrics): string {
  if (metrics.modelSource === 'cache' && metrics.modelBytes) {
    return `Cached ${formatBytes(metrics.modelBytes)}`
  }

  if (metrics.modelSource === 'memory' && metrics.modelBytes) {
    return `Reused ${formatBytes(metrics.modelBytes)}`
  }

  if (metrics.downloadProgressPct !== null) {
    return `${metrics.downloadProgressPct}%`
  }

  if (metrics.downloadedBytes > 0) {
    const total = metrics.totalBytes ? ` / ${formatBytes(metrics.totalBytes)}` : ''
    return `${formatBytes(metrics.downloadedBytes)}${total}`
  }

  return 'Pending'
}
