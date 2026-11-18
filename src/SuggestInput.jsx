import { useId, useMemo, useState } from 'react'
import { suggest, canonical, tidy } from './fuzzy'

// A text field that suggests what already exists and catches typos, so "Biolgy" does not become a second "Biology".
// onChange receives the plain string (not an event).
export default function SuggestInput({ value, onChange, options = [], className = 'clay-in', onBlur, onKeyDown, ...rest }) {
  const id = useId(), [focus, setFocus] = useState(false), [cur, setCur] = useState(-1)
  const info = useMemo(() => suggest(value, options), [value, options])
  const shown = focus ? info.matches.filter(o => o !== tidy(value)) : []
  const pick = o => { onChange(o); setFocus(false); setCur(-1) }
  return (
    <span className="sugg">
      <input {...rest} className={className} value={value} autoComplete="off" spellCheck="true" role="combobox" aria-expanded={shown.length > 0} aria-controls={id} aria-autocomplete="list"
        onChange={e => { onChange(e.target.value); setCur(-1) }}
        onFocus={() => setFocus(true)}
        onBlur={e => { setFocus(false); const c = canonical(value, options); if (c !== value) onChange(c); onBlur?.(e) }}
        onKeyDown={e => {
          if (shown.length && e.key === 'ArrowDown') { e.preventDefault(); setCur(c => (c + 1) % shown.length) }
          else if (shown.length && e.key === 'ArrowUp') { e.preventDefault(); setCur(c => (c <= 0 ? shown.length - 1 : c - 1)) }
          else if (e.key === 'Enter' && cur >= 0 && shown[cur]) { e.preventDefault(); pick(shown[cur]) }
          else if (e.key === 'Escape' && shown.length) { e.stopPropagation(); setFocus(false) }
          onKeyDown?.(e)
        }} />
      {shown.length > 0 && <ul className="sugg-list" id={id} role="listbox">{shown.map((o, i) => <li key={o} role="option" aria-selected={i === cur} className={i === cur ? 'on' : ''} onMouseDown={e => { e.preventDefault(); pick(o) }}>{o}</li>)}</ul>}
      {info.near && <small className="sugg-hint" role="status">Did you mean <button type="button" onClick={() => pick(info.near)}>{info.near}</button>?</small>}
    </span>
  )
}
