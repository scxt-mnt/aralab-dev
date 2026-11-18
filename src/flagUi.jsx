// Flags have one or more "points" (what is missing / wrong), and every point can carry files as proof or as the missing material.
import { sb } from './supabase'
import Icon from './Icons'

export const FLAG_REASONS = { missing_topics: 'Missing topics', wrong_info: 'Has wrong information', broken: 'Blank or broken page', other: 'Something else' }
import { MAX_PDF_BYTES, maxBytesFor } from './limits'
export const MAX_POINTS = 5, MAX_FILES = 3, MAX_BYTES = MAX_PDF_BYTES, maxFlagBytes = f => maxBytesFor(f.type || (/\.(md|txt)$/i.test(f.name) ? 'text/plain' : ''))
export const fileType = f => f.type || (/\.(md|txt)$/i.test(f.name) ? 'text/plain' : '')
export const pointsOf = f => !f ? [] : (Array.isArray(f.points) && f.points.length
  ? f.points.map(p => ({ reason: p.reason, note: p.note || '', files: p.files || [] }))
  : [{ reason: f.reason, note: f.note || '', files: [] }])

export async function openNote(file, toast) {
  const { data, error } = await sb.storage.from('notes').createSignedUrl(file.path, 300)
  if (error) toast(error.message); else window.open(data.signedUrl, '_blank', 'noopener')
}

// read-only list of a flag's points (admin + Astra screens)
export function FlagPointsView({ flag, toast }) {
  const pts = pointsOf(flag)
  return (
    <ol className="fpoints">{pts.map((p, i) => (
      <li key={i}>
        <b>{FLAG_REASONS[p.reason] || p.reason}</b>
        {p.note && <p>{p.note}</p>}
        {p.files.length > 0 && <div className="files">{p.files.map(f => <button key={f.path} type="button" className="btn" onClick={() => openNote(f, toast)}><Icon name="clip" size={14} /> {f.name}</button>)}</div>}
      </li>))}</ol>
  )
}
