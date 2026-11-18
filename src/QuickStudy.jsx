// v84: "Study 5 minutes": 3 topics, 5 cards, 3 quiz questions, one screen at a time, full screen. Missed items come back tomorrow (src/spaced.js).
import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icons'
import { dueCount, grade, itemId, loadSR, pick, saveSR } from './spaced'

export default function QuickStudy({ item, content, me, onClose }) {
  const sr = useRef(loadSR(me)), rid = item.id
  const steps = useMemo(() => {
    const cards = (content.flashcards?.length ? content.flashcards : (content.terms || []).map(t => ({ q: t.term, a: t.definition })))
    const topics = (content.sections || []).filter(s => s.heading).slice(0, 3).map(s => ({ type: 'topic', s }))
    const cs = pick(cards, sr.current, rid, c => c.q, 5).map(c => ({ type: 'card', c }))
    const qs = pick(content.quiz || [], sr.current, rid, q => q.q, 3).map(q => ({ type: 'quiz', q }))
    return [...topics, ...cs, ...qs]
  }, [content, rid])
  const [i, setI] = useState(0), [flip, setFlip] = useState(false), [pickd, setPickd] = useState(null), [res, setRes] = useState({ card: 0, cardN: 0, quiz: 0, quizN: 0 })
  const step = steps[i], done = i >= steps.length
  const topRef = useRef()
  useEffect(() => { const k = e => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  useEffect(() => { topRef.current?.scrollTo?.(0, 0) }, [i])
  const next = () => { setFlip(false); setPickd(null); setI(x => x + 1) }
  const mark = (id, ok) => { sr.current = grade(sr.current, id, ok); saveSR(me, sr.current) }
  const rateCard = ok => { mark(itemId(rid, step.c.q), ok); setRes(r => ({ ...r, card: r.card + (ok ? 1 : 0), cardN: r.cardN + 1 })); next() }
  const choose = j => { if (pickd !== null) return; setPickd(j); const ok = j === step.q.answer; mark(itemId(rid, step.q.q), ok); setRes(r => ({ ...r, quiz: r.quiz + (ok ? 1 : 0), quizN: r.quizN + 1 })) }
  const later = useMemo(() => done ? dueCount(content.quiz || [], sr.current, rid, q => q.q, Date.now() + 86400000) + dueCount(content.flashcards || [], sr.current, rid, c => c.q, Date.now() + 86400000) : 0, [done, content, rid])
  const pct = steps.length ? Math.round((Math.min(i, steps.length) / steps.length) * 100) : 100

  return (
    <div className="qs" role="dialog" aria-modal="true" aria-label="Study 5 minutes">
      <div className="qs-top">
        <button type="button" className="pf-ib" onClick={onClose} aria-label="Close"><Icon name="x" size={19} /></button>
        <div className="qs-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></div>
        <small>{done ? steps.length : i + 1}/{steps.length}</small>
      </div>
      <div className="qs-body" ref={topRef}>
        {steps.length === 0 && <div className="qs-card"><h2>Nothing to study yet</h2><p className="mute">This reviewer has no topics, cards or questions.</p></div>}
        {step?.type === 'topic' && (
          <div className="qs-card"><small className="qs-kind">Read · topic {steps.slice(0, i + 1).filter(s => s.type === 'topic').length}</small><h2>{step.s.heading}</h2>
            <ul>{step.s.points.slice(0, 6).map((p, k) => <li key={k}>{p}</li>)}</ul></div>)}
        {step?.type === 'card' && (
          <div className="qs-card"><small className="qs-kind">Recall</small>
            <button type="button" className={`qs-flip${flip ? ' on' : ''}`} onClick={() => setFlip(true)} aria-live="polite"><b>{step.c.q}</b>{flip ? <span>{step.c.a}</span> : <em>Tap to show the answer</em>}</button></div>)}
        {step?.type === 'quiz' && (
          <div className="qs-card"><small className="qs-kind">Quiz</small><h2>{step.q.q}</h2>
            <div className="qs-ch">{step.q.choices.map((c, j) => <button type="button" key={j} className={pickd === null ? '' : j === step.q.answer ? 'ok' : j === pickd ? 'no' : 'dim'} onClick={() => choose(j)} disabled={pickd !== null && j !== pickd && j !== step.q.answer}>{c}</button>)}</div>
            {pickd !== null && <p className={`qs-why ${pickd === step.q.answer ? 'ok' : 'no'}`}><b>{pickd === step.q.answer ? 'Correct.' : 'Not quite.'}</b> {step.q.why}</p>}</div>)}
        {done && steps.length > 0 && (
          <div className="qs-card qs-end"><span className="qs-trophy"><Icon name="award" size={34} /></span><h2>Nice work</h2>
            <p>{res.cardN > 0 && <>Cards: <b>{res.card}/{res.cardN}</b> · </>}{res.quizN > 0 && <>Quiz: <b>{res.quiz}/{res.quizN}</b></>}</p>
            <p className="mute">{later > 0 ? `${later} item${later === 1 ? '' : 's'} will come back for review tomorrow.` : 'Come back in a few days and AraLab will quiz you again.'}</p></div>)}
      </div>
      <div className="qs-foot">
        {step?.type === 'topic' && <button type="button" className="lg-btn pri" onClick={next}>Next</button>}
        {step?.type === 'card' && (flip ? <><button type="button" className="lg-btn ghost" onClick={() => rateCard(false)}>Not yet</button><button type="button" className="lg-btn pri" onClick={() => rateCard(true)}>Got it</button></> : <button type="button" className="lg-btn pri" onClick={() => setFlip(true)}>Show answer</button>)}
        {step?.type === 'quiz' && <button type="button" className="lg-btn pri" disabled={pickd === null} onClick={next}>{i === steps.length - 1 ? 'Finish' : 'Next'}</button>}
        {(done || steps.length === 0) && <button type="button" className="lg-btn pri" onClick={onClose}>Done</button>}
      </div>
    </div>
  )
}
