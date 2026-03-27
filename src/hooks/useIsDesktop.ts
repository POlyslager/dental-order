import { useState, useEffect } from 'react'

export function useIsDesktop(breakpoint = 500): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth >= breakpoint
  )
  useEffect(() => {
    function check() { setIsDesktop(window.innerWidth >= breakpoint) }
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [breakpoint])
  return isDesktop
}
