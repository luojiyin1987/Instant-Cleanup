import type { LoadedImage, RoiRect, RuntimeStepMetric, Stroke } from '../types'
import {
  MODEL_SIZE,
  blendPatchIntoImage,
  canvasToObjectUrl,
  cropImageToCanvas,
  expandToSquareRoi,
  getBrushBounds,
  getStageMetrics,
  hasVisibleMaskPixels,
  imageCanvasToTensorData,
  maskCanvasToTensorData,
  renderMaskCanvas,
  resizeCanvas,
  tensorToCanvas,
} from './image-utils'

interface RunInpaintArgs {
  image: LoadedImage
  ort: typeof import('onnxruntime-web/webgpu')
  session: import('onnxruntime-web/webgpu').InferenceSession
  strokes: Stroke[]
  stageMaxWidth: number
  onProgress?: (message: string) => void
}

export async function runInpaint({
  image,
  ort,
  session,
  strokes,
  stageMaxWidth,
  onProgress,
}: RunInpaintArgs): Promise<{
  downloadUrl: string
  fileName: string
  roi: RoiRect
  totalDurationMs: number
  stepTimings: RuntimeStepMetric[]
}> {
  const totalStart = performance.now()
  const stepTimings: RuntimeStepMetric[] = []
  const pushStep = (label: string, stepStart: number) => {
    stepTimings.push({
      label,
      durationMs: performance.now() - stepStart,
    })
  }

  let stepStart = performance.now()
  onProgress?.('Calculating mask ROI…')
  const { stageWidth } = getStageMetrics(image.width, image.height, stageMaxWidth)
  const imageScale = image.width / stageWidth
  const brushBounds = getBrushBounds(strokes, imageScale)

  if (!brushBounds) {
    throw new Error('The current mask is empty.')
  }

  const roi = expandToSquareRoi(brushBounds, image.width, image.height)
  onProgress?.(`Preparing ${roi.width}×${roi.height} local patch…`)
  const maskRoiCanvas = renderMaskCanvas(strokes, roi, imageScale)

  if (!hasVisibleMaskPixels(maskRoiCanvas)) {
    throw new Error('The mask was fully erased. Paint a visible area before running again.')
  }
  pushStep('ROI + mask', stepStart)

  await yieldToMain()
  stepStart = performance.now()
  onProgress?.('Resizing ROI to 512×512…')
  const modelImageCanvas = cropImageToCanvas(image.element, roi, MODEL_SIZE, MODEL_SIZE)
  const modelMaskCanvas = resizeCanvas(maskRoiCanvas, MODEL_SIZE, MODEL_SIZE, false)
  pushStep('Resize to 512', stepStart)

  await yieldToMain()
  stepStart = performance.now()
  onProgress?.('Creating input tensors…')
  const feeds = {
    image: new ort.Tensor('float32', imageCanvasToTensorData(modelImageCanvas), [
      1,
      3,
      MODEL_SIZE,
      MODEL_SIZE,
    ]),
    mask: new ort.Tensor('float32', maskCanvasToTensorData(modelMaskCanvas), [
      1,
      1,
      MODEL_SIZE,
      MODEL_SIZE,
    ]),
  }
  pushStep('Tensor creation', stepStart)

  await yieldToMain()
  stepStart = performance.now()
  onProgress?.('Running LaMa inference…')
  const outputs = await session.run(feeds)
  pushStep('Inference', stepStart)
  const firstOutput = Object.values(outputs)[0]
  if (!firstOutput) {
    throw new Error('The model returned no output tensor.')
  }

  await yieldToMain()
  stepStart = performance.now()
  onProgress?.('Blending repaired patch back into the original image…')
  const restoredPatch = tensorToCanvas(
    firstOutput.data as Float32Array | Uint8Array,
    MODEL_SIZE,
    MODEL_SIZE,
  )
  const resizedPatch = resizeCanvas(restoredPatch, roi.width, roi.height)
  const finalCanvas = blendPatchIntoImage(image.element, roi, resizedPatch, maskRoiCanvas)
  const downloadUrl = await canvasToObjectUrl(finalCanvas)
  pushStep('Blend + export', stepStart)

  return {
    downloadUrl,
    fileName: image.name.replace(/\.[^.]+$/, '') + '-cleanup.png',
    roi,
    totalDurationMs: performance.now() - totalStart,
    stepTimings,
  }
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0)
  })
}
