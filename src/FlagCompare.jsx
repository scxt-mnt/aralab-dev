// Flag edits: the flagger (or the AI) proposes a corrected reviewer. Student, Astra and admin compare original vs edited.
import { callAi } from './aiRun'
import AiBar from './AiBar'
import { useEffect, useMemo, useState } from 'react'
import { sb } from './supabase'
import { normalizeContent, renderReviewer, FULL_CAPS } from './render'
import useAppDark from './useAppDark'
import Icon from './Icons'

const lines = c => !c ? [] : [
  c.summary && `Summary: ${c.summary}`,
  ...c.sections.flatMap(s => [`Section: ${s.heading}`, ...s.points.map(p => `  • ${p}`)]),
  ...c.terms.map(t => `Term: ${t.term} — ${t.definition}`),
  ...c.flashcards.map(f => `Card: ${f.q} → ${f.a}`),
  ...c.quiz.map(q => `Quiz: ${q.q} [${q.choices.join(' | ')}] answer: ${q.choices[q.answer]}`),
].filter(Boolean)

export const changed = (a, b) => JSON.stringify(normalizeContent(a, FULL_CAPS)) !== JSON.stringify(normalizeContent(b, FULL_CAPS))

// ---- editor: edit what is wrong, in place ----
export function ContentEditor({ value, onChange }) {
  const c = value, up = patch => onChange({ ...c, ...patch })
  const setIn = (key, i, patch) => up({ [key]: c[key].map((x, j) => (j === i ? { ...x, ...patch } : x)) })
  const del = (key, i) => up({ [key]: c[key].filter((_, j) => j !== i) })
  const T = (v, f, rows = 2) => <textarea className="clay-in" rows={rows} value={v} onChange={e => f(e.target.value)} />
  return (
    <div className="ced">
      <label>Summary{T(c.summary, v => up({ summary: v }))}</label>
      <h4>Sections</h4>
      {c.sections.map((s, i) => (
        <div className="fpoint" key={i}>
          <input className="clay-in" value={s.heading} onChange={e => setIn('sections', i, { heading: e.target.value })} aria-label="Heading" />
          {T(s.points.join('\n'), v => setIn('sections', i, { points: v.split('\n').filter(x => x.trim()) }), 4)}
          <button type="button" className="btn dng" onClick={() => del('sections', i)}><Icon name="trash" size={14} /> Remove section</button>
        </div>))}
      <button type="button" className="btn" onClick={() => up({ sections: [...c.sections, { heading: 'New section', points: [] }] })}><Icon name="plus" size={14} /> Add section</button>
      <h4>Terms</h4>
      {c.terms.map((t, i) => (
        <div className="row" key={i}>
          <input className="clay-in" value={t.term} onChange={e => setIn('terms', i, { term: e.target.value })} aria-label="Term" />
          <input className="clay-in" value={t.definition} onChange={e => setIn('terms', i, { definition: e.target.value })} aria-label="Definition" />
          <button type="button" className="icon-btn" onClick={() => del('terms', i)} aria-label="Remove term"><Icon name="trash" size={14} /></button>
        </div>))}
      <button type="button" className="btn" onClick={() => up({ terms: [...c.terms, { term: '', definition: '' }] })}><Icon name="plus" size={14} /> Add term</button>
      <h4>Flashcards</h4>
      {c.flashcards.map((f, i) => (
        <div className="row" key={i}>
          <input className="clay-in" value={f.q} onChange={e => setIn('flashcards', i, { q: e.target.value })} aria-label="Question" />
          <input className="clay-in" value={f.a} onChange={e => setIn('flashcards', i, { a: e.target.value })} aria-label="Answer" />
          <button type="button" className="icon-btn" onClick={() => del('flashcards', i)} aria-label="Remove card"><Icon name="trash" size={14} /></button>
        </div>))}
      <button type="button" className="btn" onClick={() => up({ flashcards: [...c.flashcards, { q: '', a: '' }] })}><Icon name="plus" size={14} /> Add flashcard</button>
      <h4>Quiz</h4>
      {c.quiz.map((q, i) => (
        <div className="fpoint" key={i}>
          <input className="clay-in" value={q.q} onChange={e => setIn('quiz', i, { q: e.target.value })} aria-label="Question" />
          {q.choices.map((ch, k) => (
            <label className="row" key={k}><input type="radio" checked={q.answer === k} onChange={() => setIn('quiz', i, { answer: k })} aria-label={`Correct answer is choice ${k + 1}`} />
              <input className="clay-in" value={ch} onChange={e => setIn('quiz', i, { choices: q.choices.map((x, j) => (j === k ? e.target.value : x)) })} /></label>))}
          <input className="clay-in" value={q.why} placeholder="Why" onChange={e => setIn('quiz', i, { why: e.target.value })} />
          <button type="button" className="btn dng" onClick={() => del('quiz', i)}><Icon name="trash" size={14} /> Remove question</button>
        </div>))}
    </div>
  )
}

async function call(mode, flagId, extra = {}, onUpdate) {
  const { data: s } = await sb.auth.getSession()
  const { ok, status, body: j } = await callAi('/api/fix-reviewer', s.session.access_token, { flagId, mode, ...extra }, onUpdate)
  if (!ok) throw new Error(j.error || `Request failed (${status}).`)
  return j
}

// ---- compare: original vs flagged edit, side by side ----
// canAct: Astra of the student's school or the admin. A student only views.
export function CompareModal({ item, flag: f0, canAct, onClose, onDone, toast }) {
  const dark = useAppDark()
  const [flag, setFlag] = useState(f0), [rec, setRec] = useState(null), [editing, setEditing] = useState(null), [busy, setBusy] = useState(false), [prog, setProg] = useState(null), [view, setView] = useState('changes')
  useEffect(() => { sb.from('reviewers').select('content,template,theme').eq('id', item.id).maybeSingle().then(({ data }) => setRec(data || {})) }, [item.id])
  const original = useMemo(() => (flag.original || rec?.content) ? normalizeContent(flag.original || rec.content, FULL_CAPS) : null, [flag.original, rec])
  const proposed = useMemo(() => flag.proposed ? normalizeContent(flag.proposed, FULL_CAPS) : null, [flag.proposed])
  const tpl = 'studyflow', theme = rec?.theme || 'indigo'
  const diff = useMemo(() => {
    const a = lines(original), b = lines(proposed), A = new Set(a), B = new Set(b)
    return { removed: a.filter(x => !B.has(x)), added: b.filter(x => !A.has(x)) }
  }, [original, proposed])
  const run = async (fn, okMsg) => { setBusy(true); try { const r = await fn(); toast(typeof okMsg === 'function' ? okMsg(r) : okMsg) } catch (e) { toast(e.message) } setBusy(false); setProg(null) }
  const reloadFlag = async () => { const { data } = await sb.from('reviewer_flags').select('*').eq('id', flag.id).maybeSingle(); if (data) setFlag(data) }
  const draftAI = () => run(async () => { const j = await call('draft', flag.id, {}, setProg); await reloadFlag(); return j }, j => j?.subject ? `AI drafted a fix and set the subject to “${j.subject}”. Check it below.` : 'AI drafted a fix. Compare it below.')
  const apply = () => run(async () => { await call('apply', flag.id, {}, setProg); onDone?.() }, 'Edit applied. The reviewer is updated for everyone.')
  const saveEdit = () => run(async () => { await call('save', flag.id, { proposed: editing }); await reloadFlag(); setEditing(null) }, 'Edit saved.')
  const by = flag.fixed_by === 'ai' ? 'AI' : flag.fixed_by === 'person' ? 'a person' : null

  return (
    <div className="scrim" onClick={onClose}>
      <div className="clay modal wide-modal cmp" onClick={e => e.stopPropagation()}>
        {busy && <AiBar p={prog} />}
        <h3 className="h-ic"><Icon name="flag" size={18} /> Compare “{item.title}”{by && <small className="mute"> · edit by {by}</small>}</h3>
        {editing ? <>
          <ContentEditor value={editing} onChange={setEditing} />
          <div className="row"><button className="btn" onClick={() => setEditing(null)}>Cancel</button><button className="btn pri" disabled={busy} onClick={saveEdit}>{busy ? 'Saving…' : 'Save edit'}</button></div>
        </> : <>
          {!proposed ? <p className="mute">No edit has been proposed on this flag yet.{canAct && ' Let the AI draft one, or write it yourself.'}</p> : <>
            <div className="row">{[['changes', 'What changed'], ['side', 'Side by side']].map(([k, l]) => <button key={k} type="button" className={view === k ? 'chip on' : 'chip'} onClick={() => setView(k)}>{l}</button>)}</div>
            {view === 'changes'
              ? <div className="diff">
                {!diff.removed.length && !diff.added.length && <p className="mute">No text differences.</p>}
                {diff.removed.map((x, i) => <p key={'r' + i} className="d-rem">− {x}</p>)}
                {diff.added.map((x, i) => <p key={'a' + i} className="d-add">+ {x}</p>)}
              </div>
              : <div className="cmp-cols">
                <div><b>Original</b>{original && <iframe title="Original" srcDoc={renderReviewer(original, tpl, theme, { dark })} sandbox="" />}</div>
                <div><b>Flagged edit</b><iframe title="Flagged edit" srcDoc={renderReviewer(proposed, tpl, theme, { dark })} sandbox="" /></div>
              </div>}
          </>}
          <div className="row spread">
            <button type="button" className="btn" onClick={onClose}>Close</button>
            {canAct && <span className="row">
              <button type="button" className="btn" disabled={busy} onClick={draftAI}><Icon name="sparkles" size={15} /> {busy ? 'Working…' : proposed ? 'Redo with AI' : 'Draft with AI'}</button>
              <button type="button" className="btn" disabled={busy || !(proposed || original)} onClick={() => setEditing(proposed || original)}><Icon name="edit" size={15} /> Edit by hand</button>
              {proposed && <button type="button" className="btn pri" disabled={busy} onClick={apply}><Icon name="check" size={15} /> Apply this edit</button>}
            </span>}
          </div>
        </>}
      </div>
    </div>
  )
}
