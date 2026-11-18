// v84: the real reviewer, shrunk into the card. Desktop: it slowly scrolls while the mouse is over the card.
// Phone: it scrolls while the card is in the middle of the screen. Only a few cards load/animate at once.
// The page is the same sandboxed, CSP-locked HTML the reader uses; the scroll is a CSS transform on the frame (no access to its inside needed).
import { useEffect, useMemo, useRef, useState } from 'react'
import { loadReviewerRec } from './reviewerCache'
import { prepareReviewer } from './lib'
import { renderReviewer } from './render'
import useAppDark from './useAppDark'
import MiniReviewer from './MiniReviewer'

const PAGE_W = 820, PAGE_H = 2600            // logical page size inside the frame
const loading = { n: 0 }, MAX_LOADING = 3     // never fetch more than 3 reviewers at the same time
let active = null                             // only one preview animates at a time
const reduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false } }
const canHover = () => { try { return window.matchMedia('(hover: hover)').matches } catch { return false } }

export default function LivePreview({ item, ratio = 0.62 }) {
  const box = useRef(null), frame = useRef(null), raf = useRef(0), y = useRef(0), dir = useRef(1)
  const [seen, setSeen] = useState(false), [rec, setRec] = useState(null), [ready, setReady] = useState(false), [w, setW] = useState(0)
  const [on, setOn] = useState(false)
  const dark = useAppDark()

  // 1. load only when the card is near the screen
  useEffect(() => {
    const el = box.current
    if (!el) return
    setW(el.clientWidth)
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { setSeen(true); io.disconnect() } }, { rootMargin: '200px' })
    io.observe(el); return () => io.disconnect()
  }, [])
  useEffect(() => {
    if (!seen || rec) return
    let live = true, t
    const go = () => {
      if (loading.n >= MAX_LOADING) { t = setTimeout(go, 250); return }
      loading.n++
      loadReviewerRec(item.id).then(r => live && setRec(r)).catch(() => {}).finally(() => { loading.n-- })
    }
    go(); return () => { live = false; clearTimeout(t) }
  }, [seen, item.id, rec])
  useEffect(() => {
    const el = box.current; if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); return () => ro.disconnect()
  }, [])

  const html = useMemo(() => {
    if (!rec) return ''
    try { return prepareReviewer(rec.content ? renderReviewer(rec.content, 'studyflow', rec.theme || 'indigo') : rec.html, { dark }) } catch { return '' }
  }, [rec, dark])

  // 2. when to animate: hover on desktop, "card is in the middle" on touch screens
  useEffect(() => {
    const el = box.current; if (!el || !ready || reduced()) return
    const me = {}
    const start = () => { if (active && active !== me) active.stop?.(); active = me; me.stop = () => setOn(false); setOn(true) }
    const stop = () => { if (active === me) active = null; setOn(false) }
    if (canHover()) {
      const card = el.closest('.card') || el
      card.addEventListener('mouseenter', start); card.addEventListener('mouseleave', stop); card.addEventListener('focusin', start); card.addEventListener('focusout', stop)
      return () => { card.removeEventListener('mouseenter', start); card.removeEventListener('mouseleave', stop); card.removeEventListener('focusin', start); card.removeEventListener('focusout', stop); stop() }
    }
    if (typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(es => { es.forEach(e => (e.isIntersecting ? start() : stop())) }, { rootMargin: '-38% 0px -38% 0px', threshold: 0 })
    io.observe(el); return () => { io.disconnect(); stop() }
  }, [ready])

  // 3. the slow scroll (transform only, so it stays smooth and cheap)
  const scale = w ? w / PAGE_W : 0.4, viewH = w * ratio, maxY = Math.max(0, PAGE_H * scale - viewH)
  const paint = () => { if (frame.current) frame.current.style.transform = `translate3d(0,${-y.current}px,0) scale(${scale})` }
  useEffect(() => {
    cancelAnimationFrame(raf.current)
    if (!w) return
    if (!on) {   // glide back to the top
      const back = () => { y.current = Math.max(0, y.current - Math.max(2, y.current * 0.12)); paint(); if (y.current > 0) raf.current = requestAnimationFrame(back) }
      if (y.current > 0) raf.current = requestAnimationFrame(back); else paint()
      return () => cancelAnimationFrame(raf.current)
    }
    let last = 0, pause = 0
    const step = ts => {
      const dt = last ? Math.min(64, ts - last) : 16; last = ts
      if (pause > 0) pause -= dt
      else {
        y.current += dir.current * dt * 0.045 * Math.max(1, scale * 2)
        if (y.current >= Math.min(maxY, 1400 * scale)) { y.current = Math.min(maxY, 1400 * scale); dir.current = -1; pause = 500 }
        else if (y.current <= 0) { y.current = 0; dir.current = 1; pause = 400 }
        paint()
      }
      raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
  }, [on, w, scale, maxY]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!on) { y.current = 0; paint() } }, [scale]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <span ref={box} className={`lp${ready ? ' ready' : ''}${on ? ' on' : ''}`} style={{ height: w ? viewH : undefined, paddingTop: w ? undefined : `${ratio * 100}%` }} aria-hidden="true">
      {!ready && <span className="lp-ph"><MiniReviewer item={item} /></span>}
      {html && w > 0 && (
        <iframe ref={frame} className="lp-frame" title="" tabIndex={-1} srcDoc={html} sandbox="allow-scripts" loading="lazy"
          style={{ width: PAGE_W, height: PAGE_H, transform: `scale(${scale})` }} onLoad={() => setReady(true)} />
      )}
    </span>
  )
}
