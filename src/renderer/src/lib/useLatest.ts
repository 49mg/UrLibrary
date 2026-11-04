import { useLayoutEffect, useRef } from 'react'

/** A ref that always holds the latest value, for use inside long-lived callbacks and effects. */
export function useLatest<T>(value: T): React.RefObject<T> {
  const ref = useRef(value)
  useLayoutEffect(() => {
    ref.current = value
  })
  return ref
}
