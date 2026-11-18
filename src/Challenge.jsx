// Quiz Challenge (v64): a timed quiz built from the open reviewer. Screens: intro, play, result, review answers, leaderboard.
// v69: Easy / Medium / Hard, a compact sticky timer bar while playing (the question and answers fit on a phone without scrolling the timer away),
// the intro title can no longer be covered by the facts card, the page behind is locked while the Challenge is open, and "Share score" sends a link
// whose preview is a score card. Colours, radii and chunky edges are the app's own tokens, so it follows light / dark mode.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sb } from './supabase'
import Icon from './Icons'
import Avatar from './UserAvatar'
import { buildQuestions, computeScore, answerSheetHtml, fmtClock, shareText, levelOf, LEVELS, DIFFICULTIES, DEFAULT_LEVEL, PERIODS, MAX_POINTS_PER_REVIEWER, POINTS_PER } from './challengeLogic'
import { scoreUrl } from './shareLink'

const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Manila' } catch { return 'Asia/Manila' } })()
const pad = n => String(n).padStart(2, '0')
const missingSql = m => /submit_quiz_attempt|quiz_leaderboard|quiz_attempts/.test(m || '')
const LEVEL_KEY = 'rl-ch-level'
const readLevel = () => { try { const v = localStorage.getItem(LEVEL_KEY); return LEVELS.includes(v) ? v : DEFAULT_LEVEL } catch { return DEFAULT_LEVEL } }   // storage can be blocked (private mode): just use the default
const saveLevel = v => { try { localStorage.setItem(LEVEL_KEY, v) } catch { /* ignore */ } }
const buzz = ms => { try { navigator.vibrate?.(ms) } catch { /* not supported */ } }
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

// The page behind a full-screen Challenge must not scroll or bounce: that is the "background shows up when I scroll" effect.
function useBodyLock() {
  useEffect(() => {
    const b = document.body, prev = b.style.overflow
    b.style.overflow = 'hidden'
    return () => { b.style.overflow = prev }
  }, [])
}
// Counts up to `to` once (skipped with reduced motion).
function useCountUp(to, ms = 700) {
  const [n, setN] = useState(reduced() ? to : 0)
  useEffect(() => {
    if (reduced()) { setN(to); return }
    let raf = 0; const t0 = performance.now()
    const tick = t => { const p = Math.min(1, (t - t0) / ms); setN(Math.round(to * (1 - Math.pow(1 - p, 3)))); if (p < 1) raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf)
  }, [to, ms])
  return n
}

// Prints a page of our own making (escaped, see answerSheetHtml) from a hidden frame: the browser's "Save as PDF" does the rest.
function printHtml(html, toast) {
  const f = document.createElement('iframe')
  f.setAttribute('aria-hidden', 'true'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print() } catch { toast('Printing is blocked here. Try Share instead.') } setTimeout(() => f.remove(), 60000) }
  f.srcdoc = html; document.body.appendChild(f)
}

function Hero({ onBack, children, right, tall }) {
  return (
    <div className={tall ? 'ch-hero tall' : 'ch-hero'}>
      <i className="ch-bub b1" /><i className="ch-bub b2" /><i className="ch-bub b3" />
      <div className="ch-top">
        <button type="button" className="ch-ic" onClick={onBack} aria-label="Back"><Icon name="back" size={20} /></button>
        <div className="ch-top-r">{right}</div>
      </div>
      {children}
    </div>
  )
}

export default function Challenge({ item, content, startAt = 'intro', shareable = false, toast, onClose }) {
  useBodyLock()
  const [view, setView] = useState(startAt === 'board' ? 'board' : 'intro'), [run, setRun] = useState(null), [res, setRes] = useState(null)
  const [level, setLevelState] = useState(readLevel)
  const setLevel = v => { setLevelState(v); saveLevel(v) }
  const [stats, setStats] = useState({ best: 0, awarded: 0, attempts: 0 })
  const [period, setPeriod] = useState('all')
  const loadStats = useCallback(() => {
    sb.from('quiz_attempts').select('score,points').eq('reviewer_id', item.id).then(({ data, error }) => {
      if (error) return
      const rows = data || []
      setStats({ best: rows.reduce((m, r) => Math.max(m, r.score), 0), awarded: rows.reduce((s, r) => s + r.points, 0), attempts: rows.length })
    })
  }, [item.id])
  useEffect(() => { loadStats() }, [loadStats])

  const start = () => { const questions = buildQuestions(content, { level }); if (!questions.length) return toast('This reviewer does not have enough questions yet.'); setRun({ questions, level }); setRes(null); setView('play') }
  const finish = async answers => {
    const correct = answers.filter(a => a.ok).length, total = answers.length, seconds = Math.round(answers.reduce((s, a) => s + a.spent, 0))
    const local = { score: computeScore({ correct, total, seconds }), points: 0, best_before: stats.best, best: Math.max(stats.best, 0), saved: false }
    setRun(r => ({ ...r, answers, correct, total, seconds })); setRes(local); setView('result')
    const { data, error } = await sb.rpc('submit_quiz_attempt', { _reviewer: item.id, _correct: correct, _total: total, _seconds: seconds })
    if (error) { setRes({ ...local, note: missingSql(error.message) ? 'Run the latest supabase-setup.sql to save challenge scores.' : error.message }); return }
    setRes({ ...data, saved: true }); loadStats()
  }
  const leave = () => { if (view === 'play' && !window.confirm('Leave this challenge? This run will not be saved.')) return; onClose() }
  const leaveRef = useRef(leave); leaveRef.current = leave
  useEffect(() => { const k = e => { if (e.key === 'Escape') leaveRef.current() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [])

  return (
    <div className="ch" role="dialog" aria-modal="true" aria-label={`Challenge: ${item.title}`}>
      <div className="ch-col">
        {view === 'intro' && <Intro item={item} content={content} stats={stats} level={level} setLevel={setLevel} onStart={start} onBoard={() => setView('board')} onBack={onClose} />}
        {view === 'play' && run && <Play questions={run.questions} level={run.level} onDone={finish} onBack={leave} />}
        {view === 'result' && run?.answers && <Result item={item} run={run} res={res} shareable={shareable} onAgain={() => setView('intro')} onReview={() => setView('review')} onBoard={() => setView('board')} onHome={onClose} toast={toast} />}
        {view === 'review' && run?.answers && <Review run={run} onBack={() => setView('result')} />}
        {view === 'board' && <Board item={item} period={period} setPeriod={setPeriod} onBack={() => setView(run?.answers ? 'result' : 'intro')} toast={toast} />}
      </div>
    </div>
  )
}

function Intro({ item, content, stats, level, setLevel, onStart, onBoard, onBack }) {
  const cfg = levelOf(level)
  const pool = useMemo(() => buildQuestions(content, { max: 99 }).length, [content])
  const n = Math.min(pool, cfg.max)
  return (
    <>
      <Hero onBack={onBack} tall>
        <div className="ch-intro-t"><span className="ch-kicker"><Icon name="zap" size={14} /> Challenge</span><h2 className="ch-title">{item.title}</h2></div>
      </Hero>
      <div className="ch-body up">
        <div className="clay ch-card ch-facts">
          <div><b>{n}</b><small>questions</small></div>
          <div><b>{cfg.secs}s</b><small>per question</small></div>
          <div><b>{stats.best || '–'}</b><small>your best{stats.best ? ' pt' : ''}</small></div>
        </div>
        <div className="ch-levels" role="radiogroup" aria-label="Difficulty">
          {LEVELS.map(k => { const d = DIFFICULTIES[k]; return (
            <button type="button" key={k} role="radio" aria-checked={level === k} className={level === k ? `ch-lv on ${k}` : `ch-lv ${k}`} onClick={() => setLevel(k)}>
              <b>{d.label}</b><small>{d.hint}</small>
            </button>) })}
        </div>
        <ul className="ch-rules">
          <li><Icon name="target" size={16} /> Score up to 100: right answers count most, quick answers add a bonus.</li>
          <li><Icon name="award" size={16} /> Beat your own best to earn profile points (1 per {POINTS_PER} score points, up to {MAX_POINTS_PER_REVIEWER} per reviewer).</li>
          <li><Icon name="refresh" size={16} /> Questions and answers are shuffled every time. The leaderboard counts every level together.</li>
        </ul>
        {stats.attempts > 0 && <p className="mute ch-center">{stats.attempts} run{stats.attempts === 1 ? '' : 's'} so far · {stats.awarded} profile point{stats.awarded === 1 ? '' : 's'} earned here</p>}
        <button type="button" className="btn pri big ch-wide" onClick={onStart}><Icon name="zap" size={18} /> {stats.attempts ? 'Play again' : 'Start challenge'}</button>
        <button type="button" className="btn ch-wide" onClick={onBoard}><Icon name="award" size={16} /> Leaderboard</button>
      </div>
    </>
  )
}

function Ring({ left, total }) {
  const r = 21, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, left / total))
  return (
    <svg className={left <= 5 ? 'ch-ring low' : 'ch-ring'} width="52" height="52" viewBox="0 0 52 52" role="timer" aria-label={`${Math.ceil(left)} seconds left`}>
      <circle cx="26" cy="26" r={r} fill="none" stroke="rgba(255,255,255,.28)" strokeWidth="5" />
      <circle cx="26" cy="26" r={r} fill="none" className="ch-ring-fg" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${p * c} ${c}`} transform="rotate(-90 26 26)" />
      <text x="26" y="31" textAnchor="middle" className="ch-ring-n">{Math.ceil(left)}</text>
    </svg>
  )
}

function Play({ questions, level, onDone, onBack }) {
  const cfg = levelOf(level), SECS = cfg.secs
  const [i, setI] = useState(0), [picked, setPicked] = useState(null), [answers, setAnswers] = useState([]), [left, setLeft] = useState(SECS)
  const t0 = useRef(performance.now()), locked = useRef(false), q = questions[i], total = questions.length
  const ok = answers.filter(a => a.ok).length, bad = answers.length - ok
  const lock = useCallback((pick, spent) => {
    if (locked.current) return           // one answer per question, whether it came from a tap or from the clock
    locked.current = true
    setPicked(pick)
    buzz(pick === q.answer ? 12 : [20, 30, 20])
    setAnswers(a => [...a, { q: q.q, choices: q.choices, pick, right: q.answer, ok: pick === q.answer, spent, why: q.why }])
  }, [q])
  useEffect(() => {   // the clock for this question
    t0.current = performance.now(); locked.current = false; setLeft(SECS)
    const id = setInterval(() => {
      if (locked.current) { clearInterval(id); return }
      const spent = (performance.now() - t0.current) / 1000, l = Math.max(0, SECS - spent)
      setLeft(l)
      if (l <= 0) { clearInterval(id); lock(-1, SECS) }
    }, 100)
    return () => clearInterval(id)
  }, [i, lock, SECS])
  const choose = j => { if (picked !== null) return; const spent = Math.min(SECS, (performance.now() - t0.current) / 1000); lock(j, spent) }
  const next = () => { if (i + 1 >= total) onDone(answers); else { setI(i + 1); setPicked(null) } }
  useEffect(() => {
    const k = e => {
      if (e.target.closest?.('input,textarea,select')) return
      if (picked === null && /^[1-4]$/.test(e.key)) { const j = +e.key - 1; if (j < q.choices.length) choose(j) }
      else if (picked !== null && e.key === 'Enter') { e.preventDefault(); next() }
    }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  })
  // the timer stops the moment an answer is locked: freeze the clock display
  const shown = picked === null ? left : Math.max(0, SECS - answers[answers.length - 1].spent)
  const lastDone = i + 1 >= total
  return (
    <>
      <div className="ch-bar">
        <button type="button" className="ch-ic" onClick={onBack} aria-label="Back"><Icon name="back" size={20} /></button>
        <div className="ch-prog">
          <span><b>Question {i + 1}/{total}</b><em className={`ch-lvtag ${level}`}>{cfg.label}</em></span>
          <i><u style={{ width: `${((i + (picked !== null ? 1 : 0)) / total) * 100}%` }} /></i>
        </div>
        <Ring left={shown} total={SECS} />
      </div>
      <div className="ch-body play" key={i}>
        <div className="clay ch-card ch-q">
          <div className="ch-score-row" aria-label={`${ok} correct, ${bad} wrong`}>
            <span className="ch-cnt good"><b>{pad(ok)}</b><i><u style={{ width: `${(ok / total) * 100}%` }} /></i></span>
            <span className="ch-cnt bad"><i><u style={{ width: `${(bad / total) * 100}%` }} /></i><b>{pad(bad)}</b></span>
          </div>
          <p className="ch-qt">{q.q}</p>
        </div>
        <div className="ch-opts" role="group" aria-label="Answers">
          {q.choices.map((c, j) => {
            const mine = picked === j, right = picked !== null && j === q.answer
            const cls = right ? 'ch-opt right' : mine ? 'ch-opt wrong' : picked !== null ? 'ch-opt dim' : 'ch-opt'
            return (
              <button type="button" key={j} className={cls} disabled={picked !== null} onClick={() => choose(j)}>
                <span className="ch-key">{j + 1}</span><span className="ch-ot">{c}</span>
                <span className="ch-mark" aria-hidden="true">{right ? <Icon name="check" size={14} /> : mine ? <Icon name="x" size={14} /> : null}</span>
                {right && <span className="sr-only">Correct answer</span>}{mine && !right && <span className="sr-only">Your answer, wrong</span>}
              </button>
            )
          })}
        </div>
        {picked !== null && (
          <div className="ch-after" aria-live="polite">
            <p className={picked === q.answer ? 'ch-verdict good' : 'ch-verdict bad'}>{picked === q.answer ? 'Correct!' : picked === -1 ? 'Time is up.' : 'Not quite.'}</p>
            {q.why && <p className="mute">{q.why}</p>}
            <button type="button" className="btn pri big ch-wide" onClick={next} autoFocus>{lastDone ? 'See my score' : 'Next question'}</button>
          </div>
        )}
      </div>
    </>
  )
}

function Result({ item, run, res, shareable, onAgain, onReview, onBoard, onHome, toast }) {
  const { correct, total, seconds, answers, level } = run, wrong = total - correct
  const shown = useCountUp(res.score)
  const share = async () => {
    const text = shareText(item.title, res.score, level)
    const url = shareable ? scoreUrl(item.id, { score: res.score, level }) : ''     // the link is what makes the chat app draw the score card
    try {
      if (navigator.share) await navigator.share(url ? { title: 'AraLab Challenge', text, url } : { title: 'AraLab Challenge', text })
      else { await navigator.clipboard.writeText(url ? `${text} ${url}` : text); toast(url ? 'Link copied. Paste it anywhere and it shows your score card.' : 'Copied. Paste it anywhere to share.') }
    } catch (e) { if (e?.name !== 'AbortError') toast('Could not share this.') }
  }
  const sheet = () => printHtml(answerSheetHtml({ title: item.title, score: res.score, correct, total, seconds, rows: answers.map(a => ({ q: a.q, picked: a.pick >= 0 ? a.choices[a.pick] : '', right: a.choices[a.right], ok: a.ok, why: a.why })) }), toast)
  const gain = res.saved ? res.score > res.best_before : false
  const banner = !res.saved ? (res.note ? res.note : 'Saving your score…')
    : res.points > 0 ? `New personal best! +${res.points} point${res.points === 1 ? '' : 's'} added to your profile.`
    : gain ? `New personal best: ${res.score} pt. Improve a little more to earn the next point.`
    : res.best_before > 0 ? `Your best here is ${res.best_before} pt. Beat it to earn points.` : ''
  const acts = [
    ['t1', 'refresh', 'Play again', onAgain], ['t2', 'eye', 'Review answers', onReview], ['t3', 'share', 'Share score', share],
    ['t4', 'printer', 'Save PDF', sheet], ['t5', 'home', 'Back to reviewer', onHome], ['t6', 'award', 'Leaderboard', onBoard],
  ]
  return (
    <>
      <Hero onBack={onHome} tall>
        <div className="ch-score" role="img" aria-label={`Your score ${res.score} points`}><div><small>Your score · {levelOf(level).label}</small><b>{shown}<em> pt</em></b></div></div>
      </Hero>
      <div className="ch-body up2">
        <div className="clay ch-card ch-stats">
          <div><b>{Math.round((correct / total) * 100)}%</b><small>Accuracy</small></div>
          <div><b>{total}</b><small>Total questions</small></div>
          <div className="good"><b>{pad(correct)}</b><small>Correct</small></div>
          <div className="bad"><b>{pad(wrong)}</b><small>Wrong</small></div>
        </div>
        <p className="mute ch-center"><Icon name="clock" size={14} /> {fmtClock(seconds)} total</p>
        {banner && <p className={res.points > 0 ? 'ch-banner win' : 'ch-banner'} aria-live="polite">{banner}</p>}
        <div className="ch-acts">
          {acts.map(([t, ic, label, fn]) => <button type="button" key={label} className="ch-act" onClick={fn}><span className={`ch-actic ${t}`}><Icon name={ic} size={20} /></span><small>{label}</small></button>)}
        </div>
      </div>
    </>
  )
}

function Review({ run, onBack }) {
  return (
    <>
      <Hero onBack={onBack}><div className="ch-intro-t"><span className="ch-kicker"><Icon name="eye" size={14} /> Review</span><h2>Your answers</h2></div></Hero>
      <div className="ch-body up">
        {run.answers.map((a, n) => (
          <div key={n} className={a.ok ? 'clay ch-card ch-rv good' : 'clay ch-card ch-rv bad'}>
            <small className="ch-qn">Question {n + 1}</small><p className="ch-qt">{a.q}</p>
            <p><span className="ch-tag">{a.ok ? 'Correct' : 'Your answer'}</span> {a.pick >= 0 ? a.choices[a.pick] : 'No answer (time ran out)'}</p>
            {!a.ok && <p><span className="ch-tag ok">Right answer</span> {a.choices[a.right]}</p>}
            {a.why && <p className="mute">{a.why}</p>}
          </div>
        ))}
        <button type="button" className="btn big ch-wide" onClick={onBack}>Back to my score</button>
      </div>
    </>
  )
}

function Board({ item, period, setPeriod, onBack, toast }) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    let live = true; setRows(null)
    sb.rpc('quiz_leaderboard', { _reviewer: item.id, _period: period, _limit: 20, _tz: TZ }).then(({ data, error }) => {
      if (!live) return
      if (error) { toast(missingSql(error.message) ? 'Run the latest supabase-setup.sql first.' : error.message); return setRows([]) }
      setRows(data || [])
    })
    return () => { live = false }
  }, [item.id, period, toast])
  const top = (rows || []).filter(r => Number(r.rank) <= 3), rest = (rows || []).filter(r => Number(r.rank) > 3)
  const slot = { 2: top.find(r => Number(r.rank) === 2), 1: top.find(r => Number(r.rank) === 1), 3: top.find(r => Number(r.rank) === 3) }
  return (
    <>
      <Hero onBack={onBack} tall>
        <div className="ch-tabs" role="tablist" aria-label="Period">
          {PERIODS.map(([k, label]) => <button type="button" role="tab" aria-selected={period === k} key={k} className={period === k ? 'on' : ''} onClick={() => setPeriod(k)}>{label}</button>)}
        </div>
        <div className="ch-podium">
          {[2, 1, 3].map(n => { const r = slot[n]; return (
            <div key={n} className={`ch-pod p${n}`}>
              {r ? <><Avatar person={r} size={n === 1 ? 54 : 44} /><small className="ch-pn">{r.is_me ? 'You' : (r.display_name || 'Student').split(' ')[0]}</small></> : <span className="ch-av-empty" />}
              <div className="ch-block"><b>{n}</b><small>{r ? `${r.score}pt` : '–'}</small></div>
            </div>) })}
        </div>
      </Hero>
      <div className="ch-body up3">
        <div className="clay ch-card ch-list">
          {rows === null && <p className="mute ch-center">Loading…</p>}
          {rows && !rows.length && <p className="mute ch-center">Nobody has played {period === 'today' ? 'today' : period === 'month' ? 'this month' : 'this reviewer'} yet. Be the first!</p>}
          {rest.map(r => (
            <div key={r.user_id}>
              {r.is_me && Number(r.rank) > 20 && <p className="ch-gap" aria-hidden="true">· · ·</p>}
              <div className={r.is_me ? 'ch-row me' : 'ch-row'}>
                <span className="ch-rn">{pad(r.rank)}</span><Avatar person={r} size={36} />
                <span className="ch-nm"><b>{r.is_me ? 'You' : r.display_name || 'Student'}</b><small className="mute">{r.attempts} run{r.attempts === 1 ? '' : 's'} · {fmtClock(r.seconds)}</small></span>
                <span className="ch-pt">{r.score}pt</span>
              </div>
            </div>
          ))}
          {rows && rows.length > 0 && !rest.length && <p className="mute ch-center">The podium is open. Play to take a spot!</p>}
        </div>
      </div>
    </>
  )
}
