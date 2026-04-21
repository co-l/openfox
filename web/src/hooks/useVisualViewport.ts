import { useState, useEffect, useRef } from 'react'

export interface VisualViewportState {
  offsetTop: number
  height: number
  keyboardVisible: boolean
}

export function useVisualViewport() {
  const [state, setState] = useState<VisualViewportState>({
    offsetTop: 0,
    height: window.innerHeight,
    keyboardVisible: false,
  })
  const baseHeightRef = useRef(window.innerHeight)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    const update = () => {
      const offsetTop = vv.offsetTop
      const height = vv.height
      const keyboardVisible = baseHeightRef.current - height > 100

      setState({ offsetTop, height, keyboardVisible })
    }

    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)

    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return state
}