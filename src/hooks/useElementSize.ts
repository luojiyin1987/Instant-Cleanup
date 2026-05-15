import { useEffect, useState, type RefObject } from 'react'

export function useElementSize<T extends HTMLElement>(ref: RefObject<T | null>,
): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) {
        return
      }

      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      })
    })

    observer.observe(element)
    setSize({
      width: element.clientWidth,
      height: element.clientHeight,
    })

    return () => observer.disconnect()
  }, [ref])

  return size
}
