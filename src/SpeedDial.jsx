// Speed dial (v70): a floating "Quick start" button in the corner of every screen.
// Tap it and a short list of shortcuts opens (Create a reviewer, Google Classroom, Library, Feed, Astra, a tour), each with one line
// saying what it does, so a student who does not know where anything is can find it. Until it is opened once it shows the words
// "Quick start" next to the + so it is noticed; after that it is a small round button. Items come from speedDialLogic.js.
import { useEffect, useRef, useState } from 'react'
import Icon from './Icons'
import { dialItems } from './speedDialLogic'

const KEY = 'rl-dial-seen'
const read = () => { try { return localStorage.getItem(KEY) === '1' } catch { return true } }   // storage blocked: skip the label instead of nagging every visit

export default function SpeedDial({ tab, onGo, onGuide }) {
  const [open, setOpen] = useState(false), [seen, setSeen] = useState(read)
  const fab = useRef(null), list = useRef(null)
  const items = dialItems(tab)

  useEffect(() => { setOpen(false) }, [tab])                       // moving to another screen closes it
  useEffect(() => {
    if (!open) return
    list.current?.querySelector('button')?.focus()
    const k = e => { if (e.key === 'Escape') { setOpen(false); fab.current?.focus() } }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [open])

  const toggle = () => {
    if (!open && !seen) { setSeen(true); try { localStorage.setItem(KEY, '1') } catch { /* ignore */ } }
    setOpen(o => !o)
  }
  const pick = it => { setOpen(false); if (it.guide !== undefined) onGuide(it.guide); else onGo(it) }
  // the list is drawn bottom-up (first item next to the button), so ArrowUp goes to the NEXT item in the DOM
  const arrows = e => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    const b = [...list.current.querySelectorAll('button')], i = b.indexOf(document.activeElement)
    if (i < 0) return
    e.preventDefault(); b[(i + (e.key === 'ArrowUp' ? 1 : -1) + b.length) % b.length].focus()
  }

  return (
    <div className={`sd${open ? ' open' : ''}${seen ? ' seen' : ''}`}>
      {open && <div className="sd-scrim" onClick={() => setOpen(false)} aria-hidden="true" />}
      {open && (
        <ul className="sd-list" role="menu" aria-label="Quick shortcuts" ref={list} onKeyDown={arrows}>
          {items.map((it, n) => (
            <li key={it.id} role="none" style={{ '--i': n }}>
              <button type="button" role="menuitem" className={n === 0 ? 'sd-item main' : 'sd-item'} onClick={() => pick(it)}>
                <span className="sd-ic"><Icon name={it.icon} size={20} /></span>
                <span className="sd-tx"><b>{it.label}</b><small>{it.hint}</small></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button ref={fab} type="button" className="sd-fab" aria-haspopup="menu" aria-expanded={open} aria-label="Quick start: shortcuts and help" onClick={toggle}>
        <Icon name="plus" size={26} />
        {!seen && !open && <span className="sd-fab-t">Quick start</span>}
      </button>
    </div>
  )
}
