// v75: the reviewer settings panel. One component, used by "Create reviewer" and by Google Classroom, so a lesson
// generated from Classroom can be shaped exactly like a normal request (subject, prompt, study aids, pictures, colour).
import SuggestInput from './SuggestInput'
import Icon from './Icons'
import { AIDS, STRATEGIES } from './aids'
import { THEMES } from './render'
import { PROMPTS, PROMPT_HINT, PROMPT_MAX, VISUALS, VISUAL_ORDER, addPrompt, hasPrompt } from './reviewSettings'

const sameSet = (a, b) => a.length === b.length && b.every(x => a.includes(x))

export default function ReviewSettings({ value, onChange, subjectOptions = [], idPrefix = 'rs', hidePrompt = false }) {
  const s = value || {}
  const set = patch => onChange({ ...s, ...patch })
  const ids = k => `${idPrefix}-${k}`
  return (
    <div className="rset">
      <label htmlFor={ids('subject')}>Subject <small className="mute">optional · the AI picks one when blank</small>
        <SuggestInput id={ids('subject')} maxLength={60} value={s.subject || ''} options={subjectOptions} onChange={v => set({ subject: v })} placeholder="e.g. Biology" />
      </label>

      {!hidePrompt && <>
      <div className="lbl" id={ids('prompt-lbl')}>Tell the AI what you need <small className="mute">{(s.prompt || '').length}/{PROMPT_MAX}</small></div>
      <textarea id={ids('prompt')} className="clay-in rset-prompt" rows="3" maxLength={PROMPT_MAX} value={s.prompt || ''} onChange={e => set({ prompt: e.target.value })} placeholder={PROMPT_HINT} aria-labelledby={ids('prompt-lbl')} />
      <div className="chips rset-chips" aria-label="Quick instructions">
        {PROMPTS.map(p => <button type="button" key={p.key} className={hasPrompt(s.prompt, p.text) ? 'chip on' : 'chip'} aria-pressed={hasPrompt(s.prompt, p.text)} onClick={() => set({ prompt: addPrompt(s.prompt, p.text) })}>{p.label}</button>)}
      </div>

      </>}

      <div className="lbl">Study strategy <small className="mute">extra sections for how you study</small></div>
      <div className="chips">
        {Object.entries(STRATEGIES).map(([k, st]) => <button type="button" key={k} title={st.hint} className={sameSet(s.aids || [], st.aids) ? 'chip on' : 'chip'} onClick={() => set({ aids: st.aids })}>{st.label}</button>)}
        <button type="button" className={(s.aids || []).length ? 'chip' : 'chip on'} onClick={() => set({ aids: [] })}>Standard</button>
      </div>
      {(s.aids || []).length > 0 && <small className="mute rset-more">Includes: {(s.aids || []).map(k => AIDS[k]?.label).filter(Boolean).join(' · ')}</small>}

      <div className="lbl">Pictures in the reviewer <small className="mute">your images and video slides</small></div>
      <div className="chips">
        {VISUAL_ORDER.map(k => <button type="button" key={k} title={VISUALS[k].hint} className={s.visuals === k ? 'chip on' : 'chip'} onClick={() => set({ visuals: k })}>{VISUALS[k].label}</button>)}
      </div>
      {s.visuals && s.visuals !== 'none' && <small className="mute rset-note"><Icon name="eye" size={13} /> They become part of the Library copy, so only include pictures you are happy to share.</small>}

      <div className="lbl">Colour</div>
      <div className="swatches">{Object.entries(THEMES).map(([k, t]) => <button type="button" key={k} title={k} aria-label={k} aria-pressed={s.theme === k} className={s.theme === k ? 'sw on' : 'sw'} style={{ background: t.bg, color: t.acc }} onClick={() => set({ theme: k })}><i style={{ background: t.acc }} /></button>)}</div>
    </div>
  )
}
