import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import type { FileItem } from '@/data/drive-data'

export function useFileInteraction(onOpen?: (file: FileItem) => void, onSelect?: (file: FileItem) => void, onMenu?: (event: MouseEvent<HTMLElement>, file: FileItem) => void) {
  const gesture = useRef<{ timer?: ReturnType<typeof setTimeout>; x: number; y: number; consumed: boolean }>({ x: 0, y: 0, consumed: false })
  function cancel() { clearTimeout(gesture.current.timer) }
  useEffect(() => () => clearTimeout(gesture.current.timer), [])
  return (file: FileItem) => ({
    onPointerDown(event: PointerEvent<HTMLElement>) {
      cancel()
      gesture.current = { x: event.clientX, y: event.clientY, consumed: false }
      if (event.button !== 0 || (event.target as HTMLElement).closest('input, button, a')) return
      if (onSelect) gesture.current.timer = setTimeout(() => { gesture.current.consumed = true; onSelect(file) }, 550)
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      if (Math.hypot(event.clientX - gesture.current.x, event.clientY - gesture.current.y) > 10) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel() { cancel(); gesture.current.consumed = true },
    onPointerLeave: cancel,
    onContextMenu(event: MouseEvent<HTMLElement>) {
      cancel()
      if (gesture.current.consumed) { event.preventDefault(); event.stopPropagation(); return }
      onMenu?.(event, file)
    },
    onClick(event: MouseEvent<HTMLElement>) {
      cancel()
      if ((event.target as HTMLElement).closest('input, button, a')) return
      if (gesture.current.consumed) { gesture.current.consumed = false; return }
      onOpen?.(file)
    },
    onKeyDown(event: KeyboardEvent<HTMLElement>) {
      if (event.target !== event.currentTarget) return
      if (event.key === 'Enter') { event.preventDefault(); onOpen?.(file) }
      if (event.key === ' ' && onSelect) { event.preventDefault(); onSelect(file) }
    },
  })
}
