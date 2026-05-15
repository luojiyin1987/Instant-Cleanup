import { useMemo, useRef, type Dispatch, type SetStateAction } from 'react'
import { Image as KonvaImage, Layer, Line, Stage } from 'react-konva'
import type Konva from 'konva'
import { getStageMetrics } from '../lib/image-utils'
import type { LoadedImage, Stroke, ToolMode } from '../types'

interface MaskStageProps {
  image: LoadedImage
  strokes: Stroke[]
  brushSize: number
  toolMode: ToolMode
  stageMaxWidth: number
  disabled?: boolean
  onChange: Dispatch<SetStateAction<Stroke[]>>
}

const MAX_STAGE_HEIGHT = 860

export function MaskStage({
  image,
  strokes,
  brushSize,
  toolMode,
  stageMaxWidth,
  disabled = false,
  onChange,
}: MaskStageProps) {
  const stageRef = useRef<Konva.Stage | null>(null)
  const drawingRef = useRef(false)

  const { stageWidth, stageHeight } = useMemo(() => {
    return getStageMetrics(image.width, image.height, stageMaxWidth, MAX_STAGE_HEIGHT)
  }, [image.height, image.width, stageMaxWidth])

  const startStroke = () => {
    if (disabled) {
      return
    }

    const stage = stageRef.current
    const point = stage?.getPointerPosition()
    if (!point) {
      return
    }

    drawingRef.current = true
    onChange((previous) => [
      ...previous,
      {
        mode: toolMode,
        size: brushSize,
        points: [point.x, point.y, point.x, point.y],
      },
    ])
  }

  const extendStroke = () => {
    if (!drawingRef.current || disabled) {
      return
    }

    const stage = stageRef.current
    const point = stage?.getPointerPosition()
    if (!point) {
      return
    }

    onChange((previous) => {
      const latest = previous.at(-1)
      if (!latest) {
        return previous
      }

      return [
        ...previous.slice(0, -1),
        {
          ...latest,
          points: [...latest.points, point.x, point.y],
        },
      ]
    })
  }

  const stopStroke = () => {
    drawingRef.current = false
  }

  return (
    <div className="editor-stage-shell">
      <div className="stage-header">
        <div>
          <h2>Mask Editor</h2>
          <p className="stage-hint">
            Brush the removal area. Erase trims the mask before the ROI patch is restored.
          </p>
        </div>
        <p className="stage-hint">
          Stage {stageWidth}×{stageHeight}
        </p>
      </div>
      <div className="stage-board">
        <Stage
          ref={stageRef}
          width={stageWidth}
          height={stageHeight}
          onMouseDown={startStroke}
          onMouseMove={extendStroke}
          onMouseUp={stopStroke}
          onMouseLeave={stopStroke}
          onTouchStart={startStroke}
          onTouchMove={extendStroke}
          onTouchEnd={stopStroke}
        >
          <Layer listening={false}>
            <KonvaImage image={image.element} width={stageWidth} height={stageHeight} />
          </Layer>
          <Layer opacity={0.88}>
            {strokes.map((stroke, index) => (
              <Line
                key={`${stroke.mode}-${index}`}
                points={stroke.points}
                stroke={stroke.mode === 'brush' ? 'rgba(207, 67, 40, 0.92)' : '#000000'}
                strokeWidth={stroke.size}
                tension={0}
                lineCap="round"
                lineJoin="round"
                globalCompositeOperation={
                  stroke.mode === 'erase' ? 'destination-out' : 'source-over'
                }
              />
            ))}
          </Layer>
        </Stage>
      </div>
    </div>
  )
}
