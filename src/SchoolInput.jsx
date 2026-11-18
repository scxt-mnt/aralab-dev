import { useId, useMemo, useState } from 'react'
import { fkey } from './fuzzy'
import { findUniversities, canonicalUniversity } from './schoolSearch'

// University field: the long list is never shown. Type 2+ letters (or "PUP", "UST", "DLSU"...) and the best 8 matches appear.
// onChange receives the plain string. On blur, something typed without the right case/accents is fixed to the list spelling.
export default function SchoolInput({ value, onChange, options = [], placeholder = 'Type your university…', className = 'clay-in', hint = true, onBlur, onKeyDown, ...rest }) {
  const id = useId(), [focus, setFocus] = useState(false), [cur, setCur] = useState(-1)
  const matches = useMemo(() => (focus && !rest.readOnly ? findUniversities(value, options) : []), [focus, value, options, rest.readOnly])
  const shown = matches.filter(o => fkey(o) !== fkey(value))
  const picked = !!canonicalUniversity(value, options), typed = fkey(value).length >= 2
  const pick = o => { onChange(o); setFocus(false); setCur(-1) }
  return (
    <span className="sugg">
      <input {...rest} className={className} value={value} placeholder={placeholder} autoComplete="off" spellCheck="false" role="combobox" aria-expanded={shown.length > 0} aria-controls={id} aria-autocomplete="list"
        onChange={e => { onChange(e.target.value); setCur(-1) }}
        onFocus={() => setFocus(true)}
        onBlur={e => { setFocus(false); const c = canonicalUniversity(value, options); if (c && c !== value) onChange(c); onBlur?.(e) }}
        onKeyDown={e => {
          if (shown.length && e.key === 'ArrowDown') { e.preventDefault(); setCur(c => (c + 1) % shown.length) }
          else if (shown.length && e.key === 'ArrowUp') { e.preventDefault(); setCur(c => (c <= 0 ? shown.length - 1 : c - 1)) }
          else if (e.key === 'Enter' && cur >= 0 && shown[cur]) { e.preventDefault(); pick(shown[cur]) }
          else if (e.key === 'Escape' && shown.length) { e.stopPropagation(); setFocus(false) }
          onKeyDown?.(e)
        }} />
      {shown.length > 0 && <ul className="sugg-list" id={id} role="listbox">{shown.map((o, i) => <li key={o} role="option" aria-selected={i === cur} className={i === cur ? 'on' : ''} onMouseDown={e => { e.preventDefault(); pick(o) }}>{o}</li>)}</ul>}
      {hint && !rest.readOnly && typed && !picked && !shown.length && <small className="sugg-hint" role="status">{focus ? 'No match yet. Check the spelling, or try a short name like PUP.' : 'Pick your university from the suggestions. Not listed? Ask an admin to add it.'}</small>}
    </span>
  )
}
