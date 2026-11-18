// v82: zoom + move a photo inside a frame before it is uploaded (round for the profile photo, wide for the cover photo).
// No library: pointer events (drag, pinch), mouse wheel, a zoom slider and arrow keys. Exports a JPEG of exactly what the frame shows.
import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icons'

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

export default function PhotoCropper({ file, shape = 'circle', onCancel, onDone }) {
  const wide = shape === 'wide'
  const FW = Math.min(wide ? 360 : 280, (typeof window !== 'undefined' ? window.innerWidth : 360) - 56), FH = wide ? Math.round(FW / 3) : FW
  const OUT = wide ? { w: 1200, h: 400 } : { w: 512, h: 512 }
  const url = useMemo(() => URL.createObjectURL(file), [file])
  const [img, setImg] = useState(null), [zoom, setZoom] = useState(1), [pos, setPos] = useState({ x: 0, y: 0 }), [busy, setBusy] = useState(false)
  const pts = useRef(new Map()), last = useRef(null)
  useEffect(() => { const i = new Image(); i.onload = () => setImg(i); i.src = url; return () => URL.revokeObjectURL(url) }, [url])

  const base = img ? Math.max(FW / img.width, FH / img.height) : 1, s = base * zoom
  const fit = (p, z = zoom) => { if (!img) return p; const sc = base * z; return { x: clamp(p.x, FW - img.width * sc, 0), y: clamp(p.y, FH - img.height * sc, 0) } }
  useEffect(() => { if (img) setPos({ x: (FW - img.width * base) / 2, y: (FH - img.height * base) / 2 }) }, [img])   // eslint-disable-line react-hooks/exhaustive-deps
  const zoomTo = z => { z = clamp(z, 1, 4); const cx = FW / 2, cy = FH / 2, k = (base * z) / s; setZoom(z); setPos(p => fit({ x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k }, z)) }

  const down = e => { e.currentTarget.setPointerCapture?.(e.pointerId); pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); last.current = null }
  const move = e => {
    if (!pts.current.has(e.pointerId)) return
    const prev = pts.current.get(e.pointerId); pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()], d = Math.hypot(a.x - b.x, a.y - b.y)
      if (last.current) zoomTo(zoom * (d / last.current)); last.current = d
    } else setPos(p => fit({ x: p.x + e.clientX - prev.x, y: p.y + e.clientY - prev.y }))
  }
  const up = e => { pts.current.delete(e.pointerId); last.current = null }
  const key = e => { const st = 12; const m = { ArrowLeft: [st, 0], ArrowRight: [-st, 0], ArrowUp: [0, st], ArrowDown: [0, -st] }[e.key]; if (m) { e.preventDefault(); setPos(p => fit({ x: p.x + m[0], y: p.y + m[1] })) } else if (e.key === '+' || e.key === '=') zoomTo(zoom + 0.2); else if (e.key === '-') zoomTo(zoom - 0.2) }

  const done = async () => {
    if (!img) return
    setBusy(true)
    const c = document.createElement('canvas'); c.width = OUT.w; c.height = OUT.h
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, OUT.w, OUT.h)
    g.drawImage(img, -pos.x / s, -pos.y / s, FW / s, FH / s, 0, 0, OUT.w, OUT.h)
    c.toBlob(b => { setBusy(false); b ? onDone(b) : onCancel() }, 'image/jpeg', 0.88)
  }

  return (
    <div className="crop-scrim" role="dialog" aria-modal="true" aria-label={wide ? 'Adjust cover photo' : 'Adjust profile photo'} onKeyDown={e => e.key === 'Escape' && onCancel()}>
      <div className="crop-card">
        <h3>{wide ? 'Adjust your cover photo' : 'Adjust your profile photo'}</h3>
        <p className="mute">Drag to move. Pinch, scroll or use the slider to zoom.</p>
        <div className={`crop-frame ${wide ? 'wide' : 'round'}`} style={{ width: FW, height: FH }} tabIndex={0} onKeyDown={key} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={e => zoomTo(zoom - e.deltaY * 0.002)} role="img" aria-label="Photo preview, drag to reposition">
          {img ? <img src={url} alt="" draggable="false" style={{ width: img.width * s, height: img.height * s, transform: `translate(${pos.x}px, ${pos.y}px)` }} /> : <span className="spin" />}
        </div>
        <label className="crop-zoom"><Icon name="image" size={14} /><input type="range" min="1" max="4" step="0.01" value={zoom} onChange={e => zoomTo(Number(e.target.value))} aria-label="Zoom" /><Icon name="image" size={22} /></label>
        <div className="crop-actions">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn" onClick={() => { setZoom(1); if (img) setPos({ x: (FW - img.width * base) / 2, y: (FH - img.height * base) / 2 }) }}>Reset</button>
          <button type="button" className="btn pri" disabled={!img || busy} onClick={done}>{busy ? 'Saving…' : 'Use photo'}</button>
        </div>
      </div>
    </div>
  )
}
