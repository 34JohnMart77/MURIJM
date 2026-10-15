import { useEffect, useState } from 'react'

/** True when the viewport is phone-sized. Laptop/desktop gets `false`. */
export function useIsMobile(breakpoint = 860): boolean {
  const query = `(max-width: ${breakpoint}px)`
  const [mobile, setMobile] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  )

  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setMobile(media.matches)
    update()
    media.addEventListener('change', update)
    window.addEventListener('resize', update)
    return () => {
      media.removeEventListener('change', update)
      window.removeEventListener('resize', update)
    }
  }, [query])

  return mobile
}
