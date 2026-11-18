// Small "copy" control used next to IDs and other short values. Shows a check
// for a moment after copying, and falls back to a hidden textarea when the
// Clipboard API is unavailable (older browsers / non-secure origins).
import { useEffect, useRef, useState } from 'react'
import Icon from './Icons'

export async function copyText(value) {
  const text = String(value ?? '')
  if (!text) return false
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* fall through to the old method */ }
  try {
    const el = document.createElement('textarea')
    el.value = text
    el.setAttribute('readonly', '')
    el.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0'
    document.body.appendChild(el)
    el.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(el)
    return ok
  } catch { return false }
}

export default function CopyButton({ value, label = 'Copy', toast, className = 'copy-btn', title }) {
  const [done, setDone] = useState(false)
  const timer = useRef()
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = async e => {
    e.preventDefault(); e.stopPropagation()
    const ok = await copyText(value)
    if (!ok) return toast?.('Could not copy. Select the text and copy it manually.')
    setDone(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setDone(false), 1500)
    toast?.(`${label} copied.`)
  }
  const text = title || `Copy ${label.toLowerCase()}`
  return (
    <button type="button" className={`${className}${done ? ' done' : ''}`} onClick={copy} title={text} aria-label={text}>
      <Icon name={done ? 'check' : 'copy'} size={13} />
    </button>
  )
}
