import type { LoadedImage, RoiRect, Stroke } from '../types'

export const MODEL_SIZE = 512

export async function loadImageFile(file: File): Promise<LoadedImage> {
  const src = URL.createObjectURL(file)

  try {
    const element = await loadImageElement(src)
    return {
      name: file.name,
      src,
      width: element.naturalWidth,
      height: element.naturalHeight,
      element,
    }
  } catch (error) {
    URL.revokeObjectURL(src)
    throw error
  }
}

export function revokeImageSourceUrl(image: LoadedImage) {
  URL.revokeObjectURL(image.src)
}

export function getStageMetrics(
  imageWidth: number,
  imageHeight: number,
  stageMaxWidth: number,
  stageMaxHeight = 860,
) {
  const scale = Math.min(stageMaxWidth / imageWidth, stageMaxHeight / imageHeight, 1)
  return {
    scale,
    stageWidth: Math.round(imageWidth * scale),
    stageHeight: Math.round(imageHeight * scale),
  }
}

export function getBrushBounds(strokes: Stroke[], imageScale: number): RoiRect | null {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const stroke of strokes) {
    if (stroke.mode !== 'brush') {
      continue
    }

    const radius = (stroke.size / 2) * imageScale

    for (let index = 0; index < stroke.points.length; index += 2) {
      const x = stroke.points[index]
      const y = stroke.points[index + 1]
      if (x === undefined || y === undefined) {
        continue
      }

      minX = Math.min(minX, x * imageScale - radius)
      minY = Math.min(minY, y * imageScale - radius)
      maxX = Math.max(maxX, x * imageScale + radius)
      maxY = Math.max(maxY, y * imageScale + radius)
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return null
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

export function expandToSquareRoi(
  bounds: RoiRect,
  imageWidth: number,
  imageHeight: number,
  padding = 72,
): RoiRect {
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  const side = Math.max(bounds.width, bounds.height) + padding * 2

  let x = Math.round(centerX - side / 2)
  let y = Math.round(centerY - side / 2)
  let width = Math.round(side)
  let height = Math.round(side)

  if (width > imageWidth) {
    width = imageWidth
    x = 0
  } else {
    x = clamp(x, 0, imageWidth - width)
  }

  if (height > imageHeight) {
    height = imageHeight
    y = 0
  } else {
    y = clamp(y, 0, imageHeight - height)
  }

  return { x, y, width, height }
}

export function renderMaskCanvas(
  strokes: Stroke[],
  roi: RoiRect,
  imageScale: number,
): HTMLCanvasElement {
  const canvas = createCanvas(roi.width, roi.height)
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('2D canvas is unavailable in this browser.')
  }

  context.clearRect(0, 0, canvas.width, canvas.height)
  context.strokeStyle = '#ffffff'
  context.lineCap = 'round'
  context.lineJoin = 'round'

  for (const stroke of strokes) {
    if (stroke.points.length < 2) {
      continue
    }

    context.save()
    context.globalCompositeOperation =
      stroke.mode === 'erase' ? 'destination-out' : 'source-over'
    context.lineWidth = stroke.size * imageScale
    context.beginPath()

    const [firstX, firstY] = stroke.points
    if (firstX === undefined || firstY === undefined) {
      context.restore()
      continue
    }

    context.moveTo(firstX * imageScale - roi.x, firstY * imageScale - roi.y)

    for (let index = 2; index < stroke.points.length; index += 2) {
      const x = stroke.points[index]
      const y = stroke.points[index + 1]
      if (x === undefined || y === undefined) {
        continue
      }

      context.lineTo(x * imageScale - roi.x, y * imageScale - roi.y)
    }

    context.stroke()
    context.restore()
  }

  return canvas
}

export function hasVisibleMaskPixels(canvas: HTMLCanvasElement): boolean {
  const context = canvas.getContext('2d')
  if (!context) {
    return false
  }

  const data = context.getImageData(0, 0, canvas.width, canvas.height).data
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] > 0) {
      return true
    }
  }

  return false
}

export function cropImageToCanvas(
  image: HTMLImageElement,
  roi: RoiRect,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('2D canvas is unavailable in this browser.')
  }

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, roi.x, roi.y, roi.width, roi.height, 0, 0, width, height)
  return canvas
}

export function resizeCanvas(
  source: CanvasImageSource,
  width: number,
  height: number,
  smoothing = true,
): HTMLCanvasElement {
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('2D canvas is unavailable in this browser.')
  }

  context.imageSmoothingEnabled = smoothing
  context.imageSmoothingQuality = 'high'
  context.drawImage(source, 0, 0, width, height)
  return canvas
}

export function imageCanvasToTensorData(canvas: HTMLCanvasElement): Float32Array {
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('2D canvas is unavailable in this browser.')
  }

  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  const area = canvas.width * canvas.height
  const tensor = new Float32Array(area * 3)

  for (let index = 0; index < area; index += 1) {
    const offset = index * 4
    tensor[index] = data[offset] / 255
    tensor[area + index] = data[offset + 1] / 255
    tensor[area * 2 + index] = data[offset + 2] / 255
  }

  return tensor
}

export function maskCanvasToTensorData(canvas: HTMLCanvasElement): Float32Array {
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('2D canvas is unavailable in this browser.')
  }

  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  const area = canvas.width * canvas.height
  const tensor = new Float32Array(area)

  for (let index = 0; index < area; index += 1) {
    tensor[index] = data[index * 4 + 3] > 0 ? 1 : 0
  }

  return tensor
}

export function tensorToCanvas(
  tensorData: Float32Array | Uint8Array,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('2D canvas is unavailable in this browser.')
  }

  const output = context.createImageData(width, height)
  const area = width * height

  let maxValue = 0
  for (let index = 0; index < tensorData.length; index += 1) {
    maxValue = Math.max(maxValue, tensorData[index] ?? 0)
  }

  const scale = maxValue <= 1.5 ? 255 : 1

  for (let index = 0; index < area; index += 1) {
    output.data[index * 4] = clamp(Math.round((tensorData[index] ?? 0) * scale), 0, 255)
    output.data[index * 4 + 1] = clamp(
      Math.round((tensorData[area + index] ?? 0) * scale),
      0,
      255,
    )
    output.data[index * 4 + 2] = clamp(
      Math.round((tensorData[area * 2 + index] ?? 0) * scale),
      0,
      255,
    )
    output.data[index * 4 + 3] = 255
  }

  context.putImageData(output, 0, 0)
  return canvas
}

export async function canvasToObjectUrl(canvas: HTMLCanvasElement): Promise<string> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((created) => {
      if (created) {
        resolve(created)
        return
      }
      reject(new Error('Unable to create an output blob.'))
    }, 'image/png')
  })

  return URL.createObjectURL(blob)
}

export function blendPatchIntoImage(
  image: HTMLImageElement,
  roi: RoiRect,
  patchCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  featherRadius = 12,
): HTMLCanvasElement {
  const finalCanvas = createCanvas(image.naturalWidth, image.naturalHeight)
  const finalContext = finalCanvas.getContext('2d')
  if (!finalContext) {
    throw new Error('2D canvas is unavailable in this browser.')
  }

  finalContext.drawImage(image, 0, 0)

  const featherMask = createCanvas(maskCanvas.width, maskCanvas.height)
  const featherContext = featherMask.getContext('2d')
  if (!featherContext) {
    throw new Error('2D canvas is unavailable in this browser.')
  }

  featherContext.filter = `blur(${featherRadius}px)`
  featherContext.drawImage(maskCanvas, 0, 0)

  const maskedPatch = createCanvas(patchCanvas.width, patchCanvas.height)
  const maskedPatchContext = maskedPatch.getContext('2d')
  if (!maskedPatchContext) {
    throw new Error('2D canvas is unavailable in this browser.')
  }

  maskedPatchContext.drawImage(patchCanvas, 0, 0)
  maskedPatchContext.globalCompositeOperation = 'destination-in'
  maskedPatchContext.drawImage(featherMask, 0, 0)

  finalContext.drawImage(maskedPatch, roi.x, roi.y)
  return finalCanvas
}

async function loadImageElement(src: string): Promise<HTMLImageElement> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const nextImage = new Image()
    nextImage.decoding = 'async'
    nextImage.onload = () => resolve(nextImage)
    nextImage.onerror = () => reject(new Error('Unable to decode the selected image.'))
    nextImage.src = src
  })

  return image
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
