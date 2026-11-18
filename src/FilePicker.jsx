// Drag & drop file picker. Shows a thumbnail/icon, name and size for every file, and each one can be removed (new ones and already-uploaded ones).
import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icons'

export const sizeText = n => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB')
const ext = n => (n.split('.').pop() || '').slice(0, 4).toUpperCase()

export default function FilePicker({ files, onChange, stored = [], onRemoveStored, max, maxBytes = 5 * 1024 * 1024, accept, isOk, onError, label = 'Add files', hint, convert }) {
  const input = useRef(), [drag, setDrag] = useState(false), [busy, setBusy] = useState(false)
  const urls = useMemo(() => files.map(f => (f.type?.startsWith('image/') ? URL.createObjectURL(f) : null)), [files])
  useEffect(() => () => urls.forEach(u => u && URL.revokeObjectURL(u)), [urls])
  const room = max - stored.length - files.length

  // v62: `convert(file)` (optional) turns Word / Excel / PowerPoint / CSV ... into a text file before it is checked and listed; it throws an Error with a sentence for the student
  const add = async list => {
    const next = [...files]
    setBusy(true)
    try {
      for (const f0 of list) {
        if (next.some(x => x.name === f0.name && x.size === f0.size || x.source === f0.name + f0.size)) continue
        if (!isOk(f0)) return (onChange(next), onError(`${f0.name}: that file type isn’t supported.`))
        let f = f0
        if (convert) {
          try { f = await convert(f0) } catch (e) { return (onChange(next), onError(e?.convert ? e.message : `${f0.name}: could not be read.`)) }
          if (f !== f0) { try { f.source = f0.name + f0.size } catch { /* ignore */ } }
        }
        const lim = typeof maxBytes === 'function' ? maxBytes(f) : maxBytes
        if (f.size > lim) return (onChange(next), onError(`${f.name} is over ${sizeText(lim)}.`))
        if (stored.length + next.length >= max) return (onChange(next), onError(`Up to ${max} files.`))
        next.push(f)
      }
      onChange(next)
    } finally { setBusy(false) }
  }
  const Row = ({ name, size, thumb, tag, onRemove }) => (
    <li className="fp-row">
      {thumb ? <img src={thumb} alt="" /> : <span className="fp-ext">{ext(name)}</span>}
      <span className="fp-name"><b>{name}</b><small className="mute">{size ? sizeText(size) : ''}{tag && <em className="fp-tag">{tag}</em>}</small></span>
      <button type="button" className="icon-btn" aria-label={`Remove ${name}`} title="Remove" onClick={onRemove}><Icon name="trash" size={15} /></button>
    </li>
  )
  return (
    <div className="fpick">
      {room > 0 && (
        <div className={drag ? 'fp-zone drag' : 'fp-zone'} onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); add([...e.dataTransfer.files]) }}>
          <button type="button" className="fp-btn" disabled={busy} onClick={() => input.current.click()}><Icon name="plus" size={16} /> {label}</button>
          <small className="mute">{busy ? 'Reading your files…' : `or drag files here · ${room} more allowed${hint ? ` · ${hint}` : ''}`}</small>
          <input ref={input} type="file" multiple hidden accept={accept} onChange={e => { add([...e.target.files]); e.target.value = '' }} />
        </div>)}
      {(stored.length > 0 || files.length > 0) && (
        <ul className="fp-list">
          {stored.map(f => <Row key={f.path} name={f.name} size={f.size} tag="uploaded" onRemove={() => onRemoveStored(f)} />)}
          {files.map((f, i) => <Row key={f.name + f.size + i} name={f.name} size={f.size} thumb={urls[i]} tag={f.importContent ? 'finished reviewer — kept as-is' : f.fromLink ? `from ${f.fromLink}` : f.source ? 'converted to text' : ''} onRemove={() => onChange(files.filter((_, j) => j !== i))} />)}
        </ul>)}
    </div>
  )
}
