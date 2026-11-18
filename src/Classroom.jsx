// Google Classroom -> reviewers. Connect once, see every lesson your teachers posted, press Generate on the ones you want.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sb } from './supabase'
import AiBar from './AiBar'
import Icon from './Icons'
import { RowsSkeleton } from './Skeleton'
import { canonical, uniqueOptions } from './fuzzy'
import { API_KEY, CLIENT_ID, connect, disconnect, downloadDriveFile, fetchLessonFiles, loadCourses, loadLessons, pickFiles, saved } from './googleClassroom'
import { byLesson, cleanTranscript, groupBySubject, kindLabel, lessonState, safeName, titleKey, topicKey, transcriptInfo } from './classroomLogic'
import { isMediaName, maxMediaSeconds, transcribeMedia } from './transcribe'
import { loadTitles, nameLessons } from './lessonTitles'
import { checkFiles, discardRequest, generateNow, sendRequest } from './makeReviewer'
import { cancelTask, isCancel, startTask, throwIfCancelled } from './tasks'
import { cleanAids } from './aids'
import ReviewSettings from './ReviewSettingsPanel'
import { cleanSettings, readSettings, writeSettings, promptForRow } from './reviewSettings'
import { makeThumb, buildVisuals } from './visuals'

const PAGE = 5          // lessons shown per subject before "Show more"
const STATE = { done: ['In Library', '#6fcf97'], busy: ['Generating…', '#8b9bff'], failed: ['Failed', '#e8788a'], rejected: ['Not generated', '#e8788a'], duplicate: ['Already in Library', '#7fd4ba'] }
const when = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString() }
// v73: pasted transcripts survive a reload, so a long YouTube transcript is not lost when the tab closes.
const TR_MAX = 60000, TR_KEEP = 30
const trStoreKey = me => `rl-gc-tr:${me}`
const readTrStore = me => {
  try {
    const raw = JSON.parse(localStorage.getItem(trStoreKey(me)) || '{}')
    const out = {}
    if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw)) if (typeof v === 'string' && v.trim()) out[k] = v.slice(0, TR_MAX)
    return out
  } catch { return {} }
}

export default function Classroom({ session, admin, toast, items = [], onOpenLibrary, onChanged }) {
  const me = session.user.id
  const [conn, setConn] = useState(saved), [connecting, setConnecting] = useState(false), [err, setErr] = useState('')
  const [courses, setCourses] = useState(null), [byCourse, setByCourse] = useState({})
  const [q, setQ] = useState(''), [exp, setExp] = useState(null), [openMap, setOpenMap] = useState({}), [more, setMore] = useState({}), [show, setShow] = useState('todo')
  const [titles, setTitles] = useState(loadTitles), [naming, setNaming] = useState(false)
  const [rows, setRows] = useState([]), [busy, setBusy] = useState(null), [prog, setProg] = useState(null)
  // v71: pick many lessons, confirm their Drive files once, then build them one after another in a visible queue
  const [sel, setSel] = useState(() => new Set()), [queue, setQueue] = useState(null)
  // v73: paste a video's transcript once; it is cleaned, kept in this browser and used automatically by Generate
  const [transcripts, setTranscripts] = useState(() => readTrStore(me))
  const [pasteFor, setPasteFor] = useState(null), [draft, setDraft] = useState(''), [trNotice, setTrNotice] = useState('')
  // v74: a Drive video can be written down by our AI instead of pasted. `trBusy` shows the piece being read.
  const [trBusy, setTrBusy] = useState(null)
  // v75: before a lesson is built, the same settings panel as "Create reviewer" opens (prompt, aids, pictures, colour).
  const [plan, setPlan] = useState(null)
  const stopBatch = useRef(false)

  useEffect(() => {
    try {
      const keep = Object.entries(transcripts).slice(-TR_KEEP)
      localStorage.setItem(trStoreKey(me), JSON.stringify(Object.fromEntries(keep)))
    } catch { /* private mode: the transcript still works for this visit */ }
  }, [transcripts, me])
  useEffect(() => {
    if (!pasteFor) return
    const k = e => { if (e.key === 'Escape') { setPasteFor(null); setDraft(''); setTrNotice('') } }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [pasteFor])

  const subjectOptions = useMemo(() => { const m = {}; items.forEach(i => { if (i.subject && i.subject !== 'Unsorted') m[i.subject] = (m[i.subject] || 0) + 1 }); return uniqueOptions(Object.entries(m)) }, [items])

  // which lessons already have a request (the lesson marker is stored in the request's `topic`)
  const loadRows = useCallback(async () => {
    const { data } = await sb.from('reviewer_requests').select('id,topic,status,reviewer_id,title,admin_note,error,created_at').eq('user_id', me).order('created_at', { ascending: false }).limit(400)
    setRows(data || [])
  }, [me])
  useEffect(() => {
    loadRows()
    let t = null
    const ch = sb.channel('gc-rq').on('postgres_changes', { event: '*', schema: 'public', table: 'reviewer_requests' }, () => { clearTimeout(t); t = setTimeout(loadRows, 1200) }).subscribe()
    return () => { clearTimeout(t); sb.removeChannel(ch) }
  }, [loadRows])
  const state = useMemo(() => byLesson(rows), [rows])

  const lost = useCallback(e => { if (e?.status === 401) { setConn(null); setCourses(null); setErr(e.message); return true } return false }, [])
  const loadAll = useCallback(async t => {
    setErr(''); setCourses(null); setByCourse({}); setMore({})
    try {
      const cs = await loadCourses(t); setCourses(cs)
      let i = 0
      const worker = async () => {
        while (i < cs.length) {
          const c = cs[i++]
          try { const r = await loadLessons(t, c); setByCourse(m => ({ ...m, [c.id]: r })) }
          catch (e) { if (e.status === 401) throw e; setByCourse(m => ({ ...m, [c.id]: { lessons: [], hidden: 0, error: e.message } })) }
        }
      }
      await Promise.all([worker(), worker(), worker()])
    } catch (e) { if (!lost(e)) { setErr(e.message); setCourses(c => c || []) } }
  }, [lost])
  useEffect(() => { if (conn) loadAll(conn) }, [conn, loadAll])

  const doConnect = async () => {
    setConnecting(true); setErr('')
    try { setConn(await connect()) } catch (e) { setErr(e.message) }
    setConnecting(false)
  }
  const doDisconnect = () => { disconnect(conn); setConn(null); setCourses(null); setByCourse({}); setErr('') }

  const loaded = Object.keys(byCourse).length, total = courses?.length || 0
  const all = useMemo(() => Object.values(byCourse).flatMap(r => r.lessons), [byCourse])
  const nice = useCallback(l => titles[titleKey(l)] || l.title, [titles])      // the AI's title, or the teacher's own until the AI has named it

  // once every class is loaded, the AI names the lessons it has not named yet (remembered in this browser, so this happens once per lesson)
  useEffect(() => {
    if (!conn || !total || loaded < total || !all.length) return
    if (!all.some(l => !titles[titleKey(l)])) return
    let stop = false
    setNaming(true)
    ;(async () => {
      const { data: s } = await sb.auth.getSession()
      await nameLessons(all, s.session?.access_token || session.access_token, titles, m => { if (!stop) setTitles(m) })
      if (!stop) setNaming(false)
    })()
    return () => { stop = true; setNaming(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, total, loaded, all])

  // v66: lessons still to do (not in the Library yet) vs already done; the list opens on "To do" so finished lessons do not crowd it
  const isTodo = l => ['new', 'failed'].includes(lessonState(state[topicKey(l.courseId, l.id)]))
  const todoN = all.filter(isTodo).length
  const groups = useMemo(() => {
    const w = q.trim().toLowerCase()
    let list = w ? all.filter(l => `${nice(l)} ${l.title} ${l.courseName} ${l.description}`.toLowerCase().includes(w)) : all
    if (show !== 'all') list = list.filter(l => isTodo(l) === (show === 'todo'))
    return groupBySubject(list, name => canonical(name, subjectOptions) || name)
  }, [all, q, nice, subjectOptions, show, state])

  const keyOf = l => topicKey(l.courseId, l.id)
  const toggleSel = key => setSel(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })
  const todoLessons = useMemo(() => all.filter(isTodo), [all, state])   // eslint-disable-line react-hooks/exhaustive-deps
  const toggleAll = () => setSel(s => (s.size >= todoLessons.length ? new Set() : new Set(todoLessons.map(keyOf))))

  // v73: the pasted transcript is cleaned once, then Generate picks it up without any extra step.
  const transcriptOf = l => String(transcripts[keyOf(l)] || '')
  const saveTranscript = (l, raw) => {
    const key = keyOf(l), text = cleanTranscript(raw).slice(0, TR_MAX)
    setTranscripts(t => {
      const next = { ...t }
      if (text) next[key] = text; else delete next[key]
      return Object.fromEntries(Object.entries(next).slice(-TR_KEEP))
    })
  }
  const openPaste = l => { setPasteFor(l); setDraft(transcriptOf(l)); setTrNotice('') }
  const closePaste = () => { setPasteFor(null); setDraft(''); setTrNotice('') }
  const onPasteTranscript = e => {
    const raw = e.clipboardData?.getData('text')
    if (!raw) return
    e.preventDefault()
    const clean = cleanTranscript(raw)
    const ta = e.currentTarget, s = ta.selectionStart ?? draft.length, en = ta.selectionEnd ?? draft.length
    const next = (draft.slice(0, s) + clean + draft.slice(en)).slice(0, TR_MAX)
    setDraft(next)
    setTrNotice(clean !== raw.trim() ? 'Cleaned timestamps and repeated caption lines automatically.' : '')
    requestAnimationFrame(() => { try { ta.selectionStart = ta.selectionEnd = Math.min(next.length, s + clean.length) } catch { /* the field is gone */ } })
  }

  // v74: a Drive video/audio file can be written down by our AI. The browser decodes and chunks the audio;
  // each 90-second piece goes to /api/transcribe. The finished text lands in the same transcript slot as a paste.
  const videoFileOf = l => l.files.find(f => isMediaName(f.title))
  const listenToVideo = async (l, step = () => {}, signal) => {
    const f = videoFileOf(l)
    if (!f) throw Object.assign(new Error('This lesson has no video file AraLab can listen to.'), { media: true })
    step('Downloading the video…', 1)
    // v77: the download shows a percentage and can be cancelled; the first half of the bar is the download, the second half the listening
    const { blob } = await downloadDriveFile(conn, f.id, { signal, onProgress: (line, pct) => step(line, pct == null ? undefined : pct * 0.5) })
    throwIfCancelled(signal)
    const text = await transcribeMedia(blob, { token: session.access_token, onStep: (line, pct) => step(line, pct == null ? undefined : 50 + pct * 0.5), signal })
    if (!text.trim()) throw Object.assign(new Error('No speech was found in this video. Paste the transcript instead.'), { media: true })
    saveTranscript(l, text)
    return text
  }
  const transcribeVideo = async (l, onText) => {
    const f = videoFileOf(l)
    if (!f) { toast('This lesson has no video file AraLab can listen to. Paste the transcript instead.'); return }
    if (trBusy) return
    const key = keyOf(l)
    const task = startTask(`Transcribing “${nice(l)}”`)
    const step = (line, pct) => { setTrBusy({ key, line, taskId: task.id }); task.update(line, pct) }
    step('Opening the video…', 1)
    try {
      if (API_KEY) {
        step('Confirm the video in the Google window…')
        const allowed = await pickFiles(conn, [f.id])
        if (!allowed) { task.close(); setTrBusy(null); return }
      }
      const text = await listenToVideo(l, step, task.signal)
      if (task.cancelled()) return
      onText?.(text)
      task.done('Transcript ready. Press Generate to build the reviewer.')
    } catch (e) {
      if (isCancel(e) || task.cancelled()) { /* the toast already says it was cancelled */ }
      else if (!e?.api && lost(e)) task.close()
      else task.fail(e.message || 'Could not transcribe this video.')
    }
    setTrBusy(null)
  }

  // One lesson: download its readable files (or the ones the student confirmed once for the batch), add an optional
  // transcript, upload, then let the server build the reviewer. `step(line)` reports progress to the single or batch UI.
  const prepare = async (l, allowedIds, step = () => {}, trText = null, settings = null, ctl = {}) => {
    const key = keyOf(l), signal = ctl.signal
    const st = (line, pct) => step(line, pct == null ? undefined : pct * 0.45)      // downloads fill the first 45% of the toast bar
    const s = cleanSettings(settings || readSettings(me, 'classroom'))
    const transcript = cleanTranscript(trText == null ? transcriptOf(l) : trText)
    let lesson = l
    if (Array.isArray(allowedIds)) lesson = { ...l, files: l.files.filter(f => allowedIds.includes(f.id)) }
    else if (l.files.length && !API_KEY) lesson = { ...l, files: [] }
    // v74: when the video was already written down, do not download it a second time just for slide pictures
    const heard = videoFileOf(l)
    if (transcript && heard) lesson = { ...lesson, files: lesson.files.filter(f => f.id !== heard.id) }
    step('Getting your files from Google…', 2)
    const { files, skipped } = await fetchLessonFiles(conn, lesson, st, signal)
    throwIfCancelled(signal)
    if (transcript) files.push(new File([transcript], `${safeName(nice(l))} (transcript).txt`, { type: 'text/plain' }))
    if (!files.length) throw new Error(l.files.length && !API_KEY && !transcript ? 'This lesson’s files need the Google file picker, which isn’t switched on yet. Ask the admin.' : skipped.length ? `AraLab can’t read anything in this lesson: “${skipped[0].name}” ${skipped[0].why}.` : 'This lesson has nothing AraLab can read yet. Press Transcribe on the video (or paste its transcript), then press Generate again.')
    const bad = await checkFiles(files)
    if (bad) throw new Error(bad)
    if (skipped.length) toast(`Skipped “${skipped[0].name}”${skipped.length > 1 ? ` and ${skipped.length - 1} more` : ''}: it ${skipped[0].why}.`)
    step('Uploading…', 48)
    // v75: a lesson uses the course's own subject unless the student typed one in the settings panel.
    const subject = (canonical(s.subject, subjectOptions) || s.subject || canonical(l.courseName, subjectOptions) || l.courseName || 'Unsorted').slice(0, 60)
    const body = { title: nice(l).slice(0, 120), subject, topic: key, coverage: promptForRow(s), template: 'studyflow', theme: s.theme, aids: cleanAids(s.aids) }
    const rid = await sendRequest({ me, label: `Uploading “${nice(l)}”`, files, body, signal })
    ctl.rid = rid
    throwIfCancelled(signal)
    loadRows()
    step('Building your reviewer…', 52)
    // v75: pictures from the lesson (its images and video slides) travel with the generate call when the student asked
    const visuals = await buildVisuals(files, s.visuals, { onStep: line => step(line, 53), signal })
    throwIfCancelled(signal)
    const onProg = p => { setProg(p); step(p.line, 55 + p.pct * 0.45) }
    const { ok, status, body: j } = await generateNow(rid, session.access_token, onProg, undefined, { visuals, thumb: await makeThumb(visuals[0]?.url), signal })
    throwIfCancelled(signal)
    if (!ok) throw new Error(j.error || `Generation failed (${status}).`)
    return rid
  }

  const generate = async (l, trText = null, settings = null) => {
    if (busy || queue?.running) return
    const key = keyOf(l)
    // v77: the whole build is one cancellable toast: download (with %), transcribe, upload, AI. Cancel removes the half-made request.
    const task = startTask(`Building “${nice(l)}”`), ctl = { signal: task.signal, rid: null }
    task.onCancel(() => discardRequest(ctl.rid, session.access_token).then(loadRows))
    const step = (line, pct) => { setBusy(b => b && { ...b, line }); task.update(line, pct) }
    setBusy({ key, line: 'Getting your files from Google…', taskId: task.id }); setProg(null); setExp(l.id)
    try {
      let allowed = null
      if (l.files.length && API_KEY) {          // the student confirms the lesson's files in Google's picker (this is what lets AraLab read them)
        step('Confirm the files in the Google window…')
        allowed = await pickFiles(conn, l.files.map(f => f.id))
        if (!allowed) { task.close(); setBusy(null); return }
      }
      // v74: no transcript yet but the lesson has a video? Write it down automatically, then build.
      let tr = trText
      if (tr == null && !transcriptOf(l) && videoFileOf(l)) {
        try { tr = await listenToVideo(l, (line, pct) => step(line, pct == null ? undefined : pct * 0.3), task.signal) }
        catch (e) { if (!e?.media) throw e; toast(e.message + ' Building from the slides instead.') }
      }
      await prepare(l, allowed, step, tr, settings, ctl)
      task.done('Your reviewer is ready in the Library.'); onChanged?.()
    } catch (e) {
      if (isCancel(e) || task.cancelled()) { /* the toast already says it was cancelled */ }
      else if (!lost(e)) task.fail(e.message || 'Could not build this reviewer.')
      else task.close()
    }
    setBusy(null); setProg(null); loadRows()
  }

  // v75: the settings panel is shown BEFORE anything is built, exactly like "Create reviewer".
  const startGenerate = (l, trText = null) => {
    if (busy || queue?.running) return
    const saved = readSettings(me, 'classroom')
    const own = canonical(l.courseName, subjectOptions) || l.courseName || ''
    setPlan({ mode: 'one', lesson: l, trText, draft: { ...saved, subject: own } })
  }
  const startBatch = () => {
    if (busy || queue?.running) return
    const list = all.filter(l => sel.has(keyOf(l)) && isTodo(l))
    if (!list.length) return
    setPlan({ mode: 'batch', list, draft: { ...readSettings(me, 'classroom'), subject: '' } })
  }
  const confirmPlan = () => {
    if (!plan) return
    const s = cleanSettings(plan.draft)
    writeSettings(me, { ...s, subject: '' }, 'classroom')   // the subject belongs to each lesson, not to the panel
    setPlan(null)
    if (plan.mode === 'batch') generateBatch(s)
    else generate(plan.lesson, plan.trText ?? null, s)
  }

  // v71: one Google confirmation for the whole batch, then a queue (one build at a time, so Gemini and the browser are not flooded).
  const generateBatch = async settings => {
    if (busy || queue?.running) return
    const list = all.filter(l => sel.has(keyOf(l)) && isTodo(l))
    if (!list.length) return
    const ids = [...new Set(list.flatMap(l => l.files.map(f => f.id)))]
    let allowed = null
    if (ids.length && API_KEY) {
      try { allowed = await pickFiles(conn, ids) } catch (e) { if (!lost(e)) toast(e.message); return }
      if (!allowed) return
    }
    stopBatch.current = false
    setProg(null)
    const task = startTask(`Building ${list.length} reviewer${list.length === 1 ? '' : 's'}`), ctl = { signal: task.signal, rid: null }
    task.onCancel(() => discardRequest(ctl.rid, session.access_token).then(loadRows))
    setQueue({ running: true, taskId: task.id, items: list.map(l => ({ key: keyOf(l), title: nice(l), state: 'waiting', line: '' })) })
    let okN = 0, lastErr = ''
    for (const [idx, l] of list.entries()) {
      if (stopBatch.current || task.cancelled()) break
      const key = keyOf(l)
      ctl.rid = null
      const patch = p => setQueue(q => (q ? { ...q, items: q.items.map(i => (i.key === key ? { ...i, ...p } : i)) } : q))
      const step = (line, pct) => { patch({ line }); task.update(`${idx + 1}/${list.length} · ${nice(l)}: ${line}`, ((idx + (pct || 0) / 100) / list.length) * 100) }
      patch({ state: 'working', line: 'Getting your files from Google…' })
      try {
        // v73: a video lesson needs a pasted transcript before it can be built; say so instead of a failed upload.
        if (!l.files.length && !transcriptOf(l) && l.description.length < 20) throw new Error('Transcribe the video (or paste its transcript) first, then try again.')
        await prepare(l, allowed, step, null, settings, ctl)
        patch({ state: 'done', line: 'Ready in the Library' }); okN++
        onChanged?.()
      } catch (e) {
        if (isCancel(e) || task.cancelled()) { patch({ state: 'failed', line: 'Cancelled' }); break }
        lastErr = e.message || 'Could not build this reviewer.'
        patch({ state: 'failed', line: lastErr })
        if (lost(e)) break
      }
      loadRows()
    }
    if (!task.cancelled()) { if (okN) task.done(`${okN} of ${list.length} reviewer${list.length === 1 ? '' : 's'} ready in the Library.`); else task.fail(lastErr || 'Nothing was built.') }
    setQueue(q => (q ? { ...q, running: false } : q))
    setProg(null); setSel(new Set())
  }
  const openExisting = r => onOpenLibrary(items.find(i => i.id === r.reviewer_id)?.title || '')

  // ---------- not connected ----------
  if (!conn) {
    return (
      <div className="gc">
        <div className="clay tile gc-connect">
          <span className="gc-ic"><Icon name="school" size={28} /></span>
          <h3>Bring your lessons from Google Classroom</h3>
          <p className="mute">Connect your account and AraLab lists every lesson your teachers posted. Press <b>Generate</b> on any of them to turn it into a reviewer.</p>
          <ul className="gc-points">
            <li><Icon name="check" size={15} /> Read-only. Nothing is posted, changed or deleted in Classroom.</li>
            <li><Icon name="check" size={15} /> You confirm each lesson’s files in a Google window. Works with Google Docs, Slides, PDFs, images and text.</li>
            <li><Icon name="check" size={15} /> You choose which lessons become reviewers.</li>
          </ul>
          {CLIENT_ID
            ? <button className="btn pri big" onClick={doConnect} disabled={connecting}>{connecting ? 'Waiting for Google…' : 'Connect Google Classroom'}</button>
            : <div className="note" role="note">Google Classroom isn’t switched on yet.{admin ? <> Set <code>VITE_GOOGLE_CLIENT_ID</code> (see the README, v56), then redeploy.</> : ' Ask the admin to turn it on.'}</div>}
          {err && <p className="login-err" role="alert">{err}</p>}
          <small className="mute">Read how your data is used in our <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>. Use the Google account your school gave you, the one you see your classes in.</small>
        </div>
      </div>
    )
  }

  // ---------- connected ----------
  return (
    <div className="gc">
      <div className="bar">
        <div className="search grow"><Icon name="search" size={17} /><input className="clay-in" value={q} onChange={e => setQ(e.target.value)} placeholder="Search your lessons…" aria-label="Search lessons" /></div>
        <button className="btn" onClick={() => loadAll(conn)} disabled={!!busy}><Icon name="repeat" size={15} /> Refresh</button>
        <button className="btn" onClick={doDisconnect} disabled={!!busy}>Disconnect</button>
      </div>
      {err && <div className="clay tile pause-note" role="alert"><Icon name="alert" size={20} /><div><b>{err}</b></div></div>}

      {courses === null && <RowsSkeleton count={4} label="Loading your classes" />}
      {courses && courses.length === 0 && !err && <div className="clay tile empty">No active classes were found in this Google account.<br /><small>Make sure you connected the account your school gave you.</small></div>}
      {courses && courses.length > 0 && (loaded < total || naming) && <small className="mute gc-loading">{loaded < total ? `Loading lessons… ${loaded}/${total} classes` : 'Naming your lessons…'}</small>}
      {courses && courses.length > 0 && loaded === total && groups.length === 0 && <div className="clay tile empty">{q.trim() ? 'No lesson matches your search.' : all.length && show === 'todo' ? 'All caught up: every lesson is already in your Library.' : all.length ? 'Nothing here yet.' : 'No learning material found yet.'}<br /><small>{all.length && !q.trim() ? 'Switch the filter above to see the other lessons.' : 'Lessons appear here when a teacher posts Materials or attaches files. Announcements without files are skipped.'}</small></div>}

      {courses && loaded === total && all.length > 0 && (
        <div className="chips" role="group" aria-label="Show lessons">
          {[['todo', 'To do', todoN], ['done', 'In Library', all.length - todoN], ['all', 'All', all.length]].map(([k, label, n]) => <button key={k} type="button" className={show === k ? 'chip on' : 'chip'} aria-pressed={show === k} onClick={() => setShow(k)}>{label} <b>{n}</b></button>)}
        </div>)}

      {courses && loaded === total && todoN > 0 && (
        <div className="gc-batch">
          <button type="button" className="btn sm" onClick={toggleAll}>{sel.size >= todoLessons.length ? 'Clear selection' : `Select all ${todoN}`}</button>
          <span className="mute">{sel.size ? `${sel.size} selected` : 'Pick lessons to build together'}</span>
          <button type="button" className="btn pri sm" disabled={!sel.size || !!busy || queue?.running} onClick={startBatch}><Icon name="sparkles" size={14} /> Generate {sel.size || ''}</button>
        </div>)}

      {queue && (
        <div className="clay tile gc-queue">
          <div className="gc-qhead">
            <b>{queue.running ? 'Building your reviewers…' : 'Batch finished'}</b>
            <span className="mute">{queue.items.filter(i => i.state === 'done').length}/{queue.items.length}</span>
            {queue.running
              ? <><button type="button" className="btn sm" onClick={() => { stopBatch.current = true }}>Stop after this</button><button type="button" className="btn sm dng" onClick={() => cancelTask(queue.taskId)}>Cancel now</button></>
              : <button type="button" className="btn sm" onClick={() => setQueue(null)}>Dismiss</button>}
          </div>
          <ul>{queue.items.map(i => (
            <li key={i.key}>
              <span>{i.title}</span>
              <small className={i.state === 'failed' ? 'gc-qerr' : 'mute'}>{i.state === 'working' ? i.line : i.state === 'done' ? 'Ready in the Library' : i.state === 'failed' ? i.line : 'Waiting'}</small>
            </li>))}
          </ul>
          {queue.running && <AiBar p={prog} />}
        </div>)}

      {groups.map((g, gi) => {
        const open = q.trim() ? true : openMap[g.name] ?? gi === 0
        const lim = more[g.name] || PAGE
        const ready = g.lessons.filter(l => lessonState(state[topicKey(l.courseId, l.id)]) === 'done').length
        return (
          <section className="gc-group" key={g.name}>
            <button type="button" className={open ? 'gc-ghead on' : 'gc-ghead'} onClick={() => setOpenMap(m => ({ ...m, [g.name]: !open }))} aria-expanded={open}>
              <span className="gc-gname">{g.name}</span>
              <span className="gc-gmeta">{g.lessons.length} lesson{g.lessons.length === 1 ? '' : 's'}{ready > 0 && ` · ${ready} in Library`}</span>
              <span className="gc-caret" aria-hidden="true">▾</span>
            </button>
            {open && <div className="gc-glist">
              {g.lessons.slice(0, lim).map(l => {
                const key = topicKey(l.courseId, l.id), row = state[key], st = lessonState(row), isOpen = exp === l.id, working = busy?.key === key
                const [label, col] = STATE[working ? 'busy' : st] || []
                const n = l.files.length, name = nice(l), hasVideo = l.videos > 0 || l.files.some(f => isMediaName(f.title))
                const tr = transcriptOf(l), trInfo = tr ? transcriptInfo(tr) : null
                const todo = ['new', 'failed'].includes(st) && !working
                const canBuild = n > 0 || !!tr || l.description.length >= 20
                return (
                  <div className="gc-lesson2" key={l.id}>
                    <div className="rtop">
                      {todo && <input type="checkbox" className="gc-pick" checked={sel.has(key)} onChange={() => toggleSel(key)} aria-label={`Select ${name}`} />}
                      <button type="button" className="rt-main" onClick={() => setExp(isOpen ? null : l.id)} aria-expanded={isOpen}>
                        <b>{name}</b>
                        <small className="mute">{kindLabel(l)}{when(l.created) && ` · ${when(l.created)}`}{n > 0 && ` · ${n} file${n === 1 ? '' : 's'}`}{hasVideo && ' · video'}{trInfo && ` · transcript`}</small>
                      </button>
                      {hasVideo && todo && <button type="button" className={tr ? 'gc-trchip on' : 'gc-trchip'} onClick={e => { e.stopPropagation(); openPaste(l) }} title={tr ? 'Edit the transcript' : videoFileOf(l) ? 'Listen to the video and write the transcript' : 'Paste the video transcript'} aria-label={tr ? `Edit the transcript for ${name}` : `Get a transcript for ${name}`}><Icon name="note" size={13} /><span>{tr ? 'Transcript' : videoFileOf(l) ? 'Transcribe' : 'Paste'}</span></button>}
                      {label && <span className="pill" style={{ background: col }}>{label}</span>}
                      <span className="gc-rc" style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }} aria-hidden="true">▾</span>
                    </div>
                    {trBusy?.key === key && <small className="mute gc-trline"><span className="spin" aria-hidden="true" />{trBusy.line}</small>}
                    {isOpen && <div className="rdetail">
                      {name !== l.title && <small className="mute">Teacher’s title: {l.title}</small>}
                      {l.description && <p className="gc-desc">{l.description.length > 400 ? l.description.slice(0, 400) + '…' : l.description}</p>}
                      {n > 0 && <div className="files">{l.files.map(f => <span className="fchip" key={f.id}><span className="fc-open"><Icon name="clip" size={13} /> {f.title}</span></span>)}</div>}
                      {(l.links > 0 || l.videos > 0) && <small className="mute">{[l.links && `${l.links} link${l.links === 1 ? '' : 's'}`, l.videos && `${l.videos} YouTube video${l.videos === 1 ? '' : 's'}`].filter(Boolean).join(' and ')} can’t be read by AraLab on its own.</small>}
                      {hasVideo && !tr && <div className="gc-vnote"><b>Video lesson.</b> AraLab cannot listen to the audio. Paste the transcript and it will be cleaned and used automatically.</div>}
                      {todo && <div className={tr ? 'gc-trbox has' : 'gc-trbox'}>
                        {tr ? <>
                          <div className="gc-trhead"><Icon name="note" size={15} /><b>Transcript added</b><span className="mute">{trInfo.words} words · about {trInfo.minutes} min</span></div>
                          <p className="gc-trprev">{tr.slice(0, 200)}{tr.length > 200 ? '…' : ''}</p>
                          <div className="gc-trbtns">
                            <button type="button" className="btn sm" onClick={() => openPaste(l)}><Icon name="edit" size={13} /> Edit transcript</button>
                            <button type="button" className="btn sm dng" onClick={() => saveTranscript(l, '')}><Icon name="trash" size={13} /> Remove</button>
                          </div>
                        </> : <>
                          <div className="gc-trhead"><Icon name="note" size={15} /><b>{hasVideo && videoFileOf(l) ? 'Get the video transcript' : hasVideo ? 'Paste the video transcript' : 'Add a transcript or extra notes'}</b></div>
                          {hasVideo && videoFileOf(l)
                            ? <p className="mute gc-trhint">AraLab can listen to this video’s audio and write the transcript for you. It reads up to {Math.round(maxMediaSeconds() / 60)} minutes on this device; for longer videos paste the transcript.</p>
                            : <p className="mute gc-trhint">{hasVideo ? 'On YouTube open the video → ' : 'Anything the files don’t show, such as '}<b>{hasVideo ? '… More' : 'what the teacher said'}</b>{hasVideo ? <> → <b>Show transcript</b>, copy it, then paste it here. Timestamps and repeated caption lines are cleaned automatically.</> : ', is added to the reviewer.'}</p>}
                          <div className="gc-trbtns">
                            {hasVideo && videoFileOf(l) && (trBusy?.key === key
                              ? <span className="gc-trprog"><span className="spin" aria-hidden="true" />{trBusy.line}{trBusy.taskId && <button type="button" className="btn sm" onClick={() => cancelTask(trBusy.taskId)}>Cancel</button>}</span>
                              : <button type="button" className="btn pri sm" onClick={() => transcribeVideo(l)}><Icon name="volume" size={14} /> Transcribe the video</button>)}
                            <button type="button" className={hasVideo && videoFileOf(l) ? 'btn sm' : 'btn pri sm'} onClick={() => openPaste(l)}><Icon name="note" size={14} /> {hasVideo && videoFileOf(l) ? 'Paste instead' : hasVideo ? 'Paste transcript' : 'Add notes'}</button>
                          </div>
                        </>}
                      </div>}
                      {todo && <button className="btn pri sm" disabled={!!busy || queue?.running || !canBuild} title={canBuild ? '' : 'Paste a transcript first'} onClick={() => startGenerate(l)}><Icon name="sparkles" size={14} /> {st === 'failed' ? 'Try again' : 'Generate reviewer'}</button>}
                      {l.url && <a className="link-btn" href={l.url} target="_blank" rel="noopener noreferrer">Open in Classroom <Icon name="external" size={12} /></a>}
                    </div>}
                    {working && <><AiBar p={prog} /><div className="gc-wrow"><small className="mute">{busy.line}</small>{busy.taskId && <button type="button" className="btn sm" onClick={() => cancelTask(busy.taskId)}>Cancel</button>}</div></>}
                    {st === 'rejected' && row?.admin_note && <p className="note">{row.admin_note}</p>}
                    {st === 'failed' && <p className="note">Generation failed. You can try again.</p>}
                    {(st === 'done' || st === 'duplicate') && <div className="acts">
                      {st === 'done' && <button className="btn sm" onClick={() => onOpenLibrary(row.title)}>Open in Library</button>}
                      {st === 'duplicate' && <button className="btn sm" onClick={() => openExisting(row)}>Open the existing reviewer</button>}
                    </div>}
                  </div>)
              })}
              {g.lessons.length > lim && <button className="btn sm gc-more" onClick={() => setMore(m => ({ ...m, [g.name]: lim + PAGE }))}>Show more ({g.lessons.length - lim})</button>}
            </div>}
          </section>)
      })}

      {pasteFor && (() => {
        const info = transcriptInfo(draft)
        const canListen = !!videoFileOf(pasteFor)
        const busyHere = trBusy?.key === keyOf(pasteFor) ? trBusy : null
        return (
          <div className="scrim tr-scrim" onClick={e => e.target === e.currentTarget && closePaste()}>
            <div className="clay modal tr-modal" role="dialog" aria-modal="true" aria-label="Transcript">
              <div className="tr-head">
                <span className="tr-ic"><Icon name="note" size={18} /></span>
                <div><h3>{canListen ? 'Video transcript' : 'Transcript or notes'}</h3><small className="mute">{nice(pasteFor)}</small></div>
                <button type="button" className="x" onClick={closePaste} aria-label="Close">×</button>
              </div>
              {canListen
                ? <p className="tr-steps as-p">Press <b>Transcribe</b> and AraLab listens to the video and writes it down — or paste a transcript you already have. It reads up to {Math.round(maxMediaSeconds() / 60)} minutes on this device.</p>
                : <ol className="tr-steps">
                    <li>Open the video and choose <b>… More</b> → <b>Show transcript</b> (or copy the teacher’s notes).</li>
                    <li>Select the text and copy it.</li>
                    <li>Paste below — timestamps and repeated caption lines are cleaned for you.</li>
                  </ol>}
              <textarea className="clay-in tr-text" rows={8} value={draft} onChange={e => setDraft(e.target.value)} onPaste={onPasteTranscript} placeholder="Paste the transcript, or the teacher’s notes…" aria-label="Transcript" autoFocus />
              {busyHere && <small className="gc-trprog tr-prog"><span className="spin" aria-hidden="true" />{busyHere.line}</small>}
              <div className="tr-foot">
                <small className={info.words && !info.ok ? 'tr-warn' : 'mute'}>{draft.trim() ? `${info.words} words · about ${info.minutes} min` : 'Nothing pasted yet'}{draft.trim() && !info.ok ? ' · too short to build a reviewer' : ''}</small>
                {trNotice && <small className="tr-note">{trNotice}</small>}
              </div>
              <div className="row tr-acts">
                {canListen && !busyHere && <button type="button" className="btn tr-listen" onClick={() => transcribeVideo(pasteFor, setDraft)}><Icon name="volume" size={14} /> Transcribe</button>}
                {transcriptOf(pasteFor) && <button type="button" className="btn dng" onClick={() => { saveTranscript(pasteFor, ''); closePaste() }}>Remove</button>}
                <button type="button" className="btn" onClick={closePaste}>Cancel</button>
                <button type="button" className="btn" disabled={!draft.trim()} onClick={() => { saveTranscript(pasteFor, draft); closePaste(); toast('Transcript saved. Press Generate to build the reviewer.') }}>Save</button>
                <button type="button" className="btn pri" disabled={!info.ok || !!busy || queue?.running || !!busyHere} onClick={() => { const l = pasteFor, text = info.text; saveTranscript(l, text); closePaste(); startGenerate(l, text) }}><Icon name="sparkles" size={14} /> Save &amp; generate</button>
              </div>
            </div>
          </div>
        )
      })()}

      {plan && (
        <div className="scrim tr-scrim" onClick={e => e.target === e.currentTarget && setPlan(null)}>
          <div className="clay modal tr-modal rset-modal" role="dialog" aria-modal="true" aria-label="Reviewer settings">
            <div className="tr-head">
              <span className="tr-ic"><Icon name="sparkles" size={18} /></span>
              <div>
                <h3>{plan.mode === 'batch' ? `Shape ${plan.list.length} reviewer${plan.list.length === 1 ? '' : 's'}` : 'Shape this reviewer'}</h3>
                <small className="mute">{plan.mode === 'batch' ? 'The same settings are used for every lesson' : nice(plan.lesson)}</small>
              </div>
              <button type="button" className="x" onClick={() => setPlan(null)} aria-label="Close">×</button>
            </div>
            <p className="tr-steps as-p">The same options as <b>Create reviewer</b>: tell the AI what you need, add study aids, include pictures, and pick a colour. Your choices are remembered for the next lesson.</p>
            <ReviewSettings value={plan.draft} onChange={d => setPlan(p => (p ? { ...p, draft: d } : p))} subjectOptions={subjectOptions} idPrefix="gcs" />
            {plan.mode === 'batch' && <small className="mute">Each reviewer keeps its lesson’s own subject. Set one above only if you want them all in the same subject.</small>}
            <div className="row tr-acts">
              <button type="button" className="btn" onClick={() => setPlan(null)}>Cancel</button>
              <button type="button" className="btn pri" onClick={confirmPlan}><Icon name="sparkles" size={14} /> {plan.mode === 'batch' ? `Build ${plan.list.length} reviewer${plan.list.length === 1 ? '' : 's'}` : 'Build reviewer'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
