import { useEffect, useState } from 'react'

// True while the app is in dark mode (App.jsx sets data-theme on <html>). Follows live changes, so anything drawn from it (reviewer previews, the reader) stays in step.
const read = () => typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark'
export default function useAppDark() {
  const [dark, setDark] = useState(read)
  useEffect(() => {
    const mo = new MutationObserver(() => setDark(read()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    setDark(read())
    return () => mo.disconnect()
  }, [])
  return dark
}
