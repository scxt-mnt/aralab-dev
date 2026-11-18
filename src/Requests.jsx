import { useCallback, useEffect, useMemo, useState } from 'react'
import { canonical, uniqueOptions } from './fuzzy'
import { checkFiles, discardRequest, generateNow, sendRequest, titleFromFile, typeOf, anyFile, convertFile } from './makeReviewer'
import { ACCEPT } from './fileConvert'
import { fetchLinkFile } from './linkApi'
import { pathsOf, openUrl } from './chunkUpload'
import AiBar from './AiBar'
import { sb } from './supabase'
import { TEMPLATES } from './render'
import { AIDS, cleanAids } from './aids'
import Icon from './Icons'
import { RowsSkeleton } from './Skeleton'
import CopyButton from './CopyButton'
import FilePicker from './FilePicker'
import { LIMIT_HINT, MAX_FILES, maxBytesFor } from './limits'
import { findImportContent, isReviewerPdf } from './reviewerImport'
import ReviewSettings from './ReviewSettingsPanel'
import { DEFAULT_SETTINGS, cleanSettings, readSettings, writeSettings, promptForRow, visualMax, settingsSummary, PROMPT_MAX } from './reviewSettings'
import { buildVisuals, makeThumb, visualFiles } from './visuals'
import { startTask, isCancel } from './tasks'

const STATUS = { pending: ['Starting…', '#f2b872'], approved: ['Ready to generate', '#7fd4ba'], generating: ['Generating…', '#8b9bff'], done: ['Done', '#6fcf97'], rejected: ['Not generated', '#e8788a'], failed: ['Failed', '#e8788a'] }
const untilText = iso => (new Date(iso).getFullYear() - new Date().getFullYear() > 1 ? 'it is lifted' : new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))
// A build that has been "generating" for longer than this is dead: the server function was killed before it could mark it failed.
// The server uses the same idea (and the real budget) to let the row be claimed again. Six minutes covers the largest allowed budget.
const STALE_MS = 6 * 60 * 1000
const isStale = r => r.status === 'generating' && (!r.reviewed_at || Date.now() - new Date(r.reviewed_at).getTime() > STALE_MS)
const blank = { ...DEFAULT_SETTINGS, title: '' }

export default function Requests({ session, admin, toast, onOpenLibrary, onChanged, items = [] }) {
  const me = session.user.id
  const [view, setView] = useState(admin ? 'queue' : 'mine'), [rows, setRows] = useState([]), [loaded, setLoaded] = useState(false), [names, setNames] = useState({})
  // v75: the form starts from the last settings the student used (prompt, strategy, pictures, colour), like a saved workspace.
  const [form, setForm] = useState(() => ({ ...readSettings(session.user.id, 'create'), title: '' }))
  const [files, setFiles] = useState([]), [link, setLink] = useState(''), [linkBusy, setLinkBusy] = useState(false)
  const [pause, setPause] = useState(null)      // { until, reason } while the student's generation is paused by staff
  const [open, setOpen] = useState(!admin), [work, setWork] = useState(null), [notes, setNotes] = useState({}), [ai, setAi] = useState(null), [exp, setExp] = useState(null), [prog, setProg] = useState(null)

  const load = useCallback(async () => {
    const { data, error } = await sb.from('reviewer_requests').select('*').order('created_at', { ascending: false }).limit(100)
    if (error) { setLoaded(true); return toast(error.message) }
    setRows(data); setLoaded(true)
    const { data: me_ } = await sb.from('profiles').select('gen_paused_until,gen_pause_reason').eq('user_id', me).maybeSingle()      // columns exist after the v47 SQL
    setPause(me_?.gen_paused_until && new Date(me_.gen_paused_until) > new Date() ? { until: me_.gen_paused_until, reason: me_.gen_pause_reason } : null)
    if (admin) {
      const ids = [...new Set(data.map(r => r.user_id))]
      const { data: p } = await sb.from('profiles').select('user_id,display_name,student_no').in('user_id', ids)
      setNames(Object.fromEntries((p || []).map(x => [x.user_id, x])))
    }
  }, [admin, toast, me])
  useEffect(() => {
    load()
    let t = null
    const later = () => { clearTimeout(t); t = setTimeout(load, 1200) }          // a burst of changes = one reload, not one per change
    const ch = sb.channel('rq-list').on('postgres_changes', { event: '*', schema: 'public', table: 'reviewer_requests' }, later).subscribe()
    return () => { clearTimeout(t); sb.removeChannel(ch) }
  }, [load])

  const set = k => e => setForm({ ...form, [k]: e.target.value })
  // every subject that already exists in the Library or in requests, so a new one is picked from them instead of re-typed
  const subjectOptions = useMemo(() => { const m = {}; [...items.map(i => i.subject), ...rows.map(r => r.subject)].forEach(s => { if (s && s !== 'Unsorted') m[s] = (m[s] || 0) + 1 }); return uniqueOptions(Object.entries(m)) }, [items, rows])
  const submit = async e => {
    e.preventDefault()
    const bad = await checkFiles(files)
    if (bad) return toast(bad)
    // v75: every choice the student made is one settings object, shared with the Classroom flow.
    const s = cleanSettings(form)
    // v71: if the student uploaded a reviewer they already made, keep its content and only apply the layout
    const list = files, imported = await findImportContent(list), keep = !!imported || list.some(isReviewerPdf)
    // from here the upload runs in the background (progress bar at the top), so the student can keep using the app
    const body = { title: form.title.trim() || imported?.title || titleFromFile(list[0].name) || 'My reviewer', subject: canonical(s.subject, subjectOptions) || 'Unsorted', template: 'studyflow', theme: s.theme, aids: cleanAids(s.aids), coverage: promptForRow(s) }
    writeSettings(me, s, 'create')
    setForm({ ...blank, subject: s.subject, prompt: s.prompt, aids: s.aids, theme: s.theme, visuals: s.visuals })
    setFiles([]); setOpen(false); setView('mine')
    // v77: the whole job is one cancellable toast (upload -> pictures -> AI). Cancel stops it and removes the half-made request.
    const task = startTask(`Creating “${body.title}”`)
    let made = null
    task.update('Uploading your files…', 3)
    task.onCancel(() => discardRequest(made, session.access_token).then(load))
    sendRequest({ me, label: `Uploading “${body.title}”`, files: list, body, signal: task.signal })
      .then(async rid => {
        made = rid
        if (task.cancelled()) return
        load()
        // v75: the pictures are shrunk in the browser and sent with the generate call (never stored in the database row)
        setWork(rid); setExp(rid); setProg(null)
        let visuals = []
        try { visuals = await buildVisuals(list, s.visuals, { signal: task.signal, onStep: line => { task.update(line, 10); setProg({ pct: 8, line, state: 'pics', at: Date.now() }) } }) } catch (e) { if (isCancel(e)) return /* pictures are optional: a file that cannot be read is simply left out */ }
        if (task.cancelled()) return
        return generate(rid, imported, keep, { visuals, thumb: await makeThumb(visuals[0]?.url), task })
      })
      .catch(err => { if (isCancel(err) || task.cancelled()) return; task.fail(err.message) })
      .finally(() => { setWork(w => (task.cancelled() ? null : w)); if (task.cancelled()) setProg(null) })
  }
  // v63: a pasted link (Google Docs/Slides/Sheets/Drive, a web page, a PDF or Word/Excel/PowerPoint link) is downloaded by the server and added like any other file
  const addLink = async () => {
    if (linkBusy || !link.trim()) return
    if (files.length >= MAX_FILES) return toast(`Up to ${MAX_FILES} files.`)
    setLinkBusy(true)
    try {
      const f = await fetchLinkFile(link, session.access_token), lim = maxBytesFor(typeOf(f))
      if (f.size > lim) throw new Error(`That link’s content is over ${Math.round(lim / 1048576)} MB.`)
      setFiles(list => (list.some(x => x.name === f.name && x.size === f.size) ? list : [...list, f])); setLink('')
    } catch (e) { toast(e.message) }
    setLinkBusy(false)
  }
  const removeFile = async (r, f) => {
    if (r.files.length <= 1) return toast('A request needs at least one file. Delete the whole request instead.')
    if (!confirm(`Remove “${f.name}” from this request?`)) return
    const { error } = await sb.from('reviewer_requests').update({ files: r.files.filter(x => x.path !== f.path) }).eq('id', r.id).eq('status', 'pending')
    if (error) return toast(error.message)
    await sb.storage.from('notes').remove(pathsOf(f)); toast('File removed.'); load()
  }
  // generation starts by itself right after the upload. The server first checks the notes (study material? appropriate? already in the Library?).
  const generate = async (rid, importContent, keep = !!importContent, opts = {}) => {
    setWork(rid); setExp(rid); setProg(null)
    // v77: a retry or a manual Generate is cancellable too (the toast is created here when the caller did not make one)
    const task = opts.task || startTask(`Building “${rows.find(r => r.id === rid)?.title || 'your reviewer'}”`)
    if (!opts.task) task.onCancel(() => discardRequest(rid, session.access_token).then(load))
    const onProg = p => { setProg(p); task.update(p.line, p.pct) }
    try {
      const { ok, status, body: j } = await generateNow(rid, session.access_token, onProg, importContent, { ...opts, signal: task.signal })
      if (task.cancelled()) return
      if (ok) {
        const added = j?.added || {}
        const parts = [['section', added.sections], ['point', added.points], ['term', added.terms], ['card', added.flashcards], ['quiz question', added.quiz]]
          .filter(([, n]) => n > 0).map(([word, n]) => `${n} new ${word}${n === 1 ? '' : 's'}`)
        task.done(j?.model === 'merge' ? `${parts.length ? `Added ${parts.join(', ')} to the reviewer already in the Library` : 'Updated the reviewer already in the Library'} — you're credited under “Improved by”.`
          : keep || j?.model === 'import' ? 'Your reviewer is ready — its content was kept as-is.' : 'Your reviewer is ready in the Library.')
        onChanged()
      } else task.fail(j.error || `Generation failed (${status}).`)
    } catch (e) { if (isCancel(e) || task.cancelled()) return; task.fail('Could not reach the server. Locally, run "vercel dev" instead of "npm run dev".') }
    finally { setWork(null); setProg(null); load() }
  }
  const approve = r => generate(r.id)
  const openExisting = r => onOpenLibrary(items.find(i => i.id === r.reviewer_id)?.title || '')
  const reject = async r => {
    const { error } = await sb.from('reviewer_requests').update({ status: 'rejected', admin_note: (notes[r.id] || '').trim(), reviewed_at: new Date().toISOString() }).eq('id', r.id)
    if (error) toast(error.message); else load()
  }
  const dropFiles = r => (r.files?.length ? sb.storage.from('notes').remove(r.files.flatMap(pathsOf)) : null)
  const del = async r => {
    if (!confirm(`Delete “${r.title}”? This also removes the uploaded files.`)) return
    const { error } = await sb.from('reviewer_requests').delete().eq('id', r.id)
    if (error) return toast(error.message)
    await dropFiles(r); toast('Request deleted.'); load()
  }
  const clearDone = async () => {
    const old = rows.filter(r => r.user_id === me && ['done', 'rejected', 'failed'].includes(r.status))
    if (!old.length || !confirm(`Delete ${old.length} finished request${old.length === 1 ? '' : 's'}? Reviewers already in your library stay.`)) return
    const { error } = await sb.from('reviewer_requests').delete().in('id', old.map(r => r.id))
    if (error) return toast(error.message)
    await Promise.all(old.map(dropFiles)); toast('Cleared.'); load()
  }
  const openFile = async f => { try { window.open(await openUrl(sb.storage.from('notes'), f), '_blank', 'noopener') } catch (e) { toast(e.message) } }
  const again = r => {
    setForm({ ...DEFAULT_SETTINGS, title: r.title, subject: r.subject === 'Unsorted' ? '' : r.subject || '', prompt: r.coverage || '', theme: r.theme || 'indigo', aids: cleanAids(r.aids), visuals: 'some' })
    setFiles([]); setOpen(true); setView('mine'); window.scrollTo({ top: 0 })
  }

  const shown = rows.filter(r => view === 'queue' ? ['pending', 'generating', 'failed', 'approved'].includes(r.status) : r.user_id === me)
  return (
    <div className="req">
      <div className="bar">
        {admin && <><button className={view === 'queue' ? 'chip on' : 'chip'} onClick={() => setView('queue')}>Review queue <b>{rows.filter(r => r.status === 'pending').length}</b></button>
          <button className={view === 'mine' ? 'chip on' : 'chip'} onClick={() => setView('mine')}>My requests</button></>}
        <span className="grow" />{view === 'mine' && rows.some(x => x.user_id === me && ['done', 'rejected', 'failed'].includes(x.status)) && <button className="btn" onClick={clearDone}>Clear finished</button>}<button className="btn pri" disabled={!!pause} onClick={() => setOpen(!open)}>{open ? 'Close' : 'New reviewer'}</button>
      </div>

      {pause && <div className="clay tile pause-note" role="alert"><Icon name="alert" size={20} /><div><b>Your generation is paused until {untilText(pause.until)}.</b><p className="mute" style={{ margin: '4px 0 0' }}>{pause.reason ? `Reason: ${pause.reason}` : 'Astra or an admin paused it.'} You can still read the Library and study. If you think this is a mistake, contact your Astra or the admin.</p></div></div>}

      {open && !pause && (
        <form className="clay tile rform" onSubmit={submit}>
          <h3>Turn your notes into a reviewer</h3>
          <FilePicker files={files} onChange={setFiles} max={MAX_FILES} maxBytes={f => maxBytesFor(typeOf(f))} isOk={anyFile} convert={convertFile} onError={toast} accept={ACCEPT} hint={LIMIT_HINT} />
          {files.some(f => f.importContent) && <div className="clay tile import-note"><Icon name="sparkles" size={16} /><span><b>Finished reviewer detected.</b> We’ll keep its sections, terms, cards and quiz exactly as they are and only apply the Study Flow layout — the AI will not rewrite it.</span></div>}
          {!files.some(f => f.importContent) && files.some(isReviewerPdf) && <div className="clay tile import-note"><Icon name="sparkles" size={16} /><span><b>Finished reviewer detected.</b> This PDF is read as a reviewer and kept as it is, then shown in the Study Flow layout — the AI will not rewrite or shorten it.</span></div>}
          <details className="more"><summary>Paste a link instead</summary>
          <div className="linkrow">
            <input className="clay-in" type="url" inputMode="url" aria-label="Paste a link" placeholder="Or paste a link: Google Docs / Slides / Drive, a web page, a PDF…" value={link} onChange={e => setLink(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLink() } }} />
            <button type="button" className="btn" disabled={linkBusy || !link.trim()} onClick={addLink}>{linkBusy ? 'Reading…' : 'Add link'}</button>
          </div>
          </details>
          <label>What should the AI focus on? <small className="mute">optional</small><textarea className="clay-in" rows="2" maxLength={PROMPT_MAX} value={form.prompt || ''} onChange={e => setForm(f => ({ ...f, prompt: e.target.value }))} placeholder="e.g. Explain simply, add examples, focus on exam topics" /></label>
          <details className="more">
            <summary>More options <small className="mute">· {settingsSummary(form)}</small></summary>
          <label>Title <small className="mute">optional · we use your file name</small><input className="clay-in" maxLength={120} value={form.title} onChange={set('title')} placeholder={files[0] ? titleFromFile(files[0].name) : 'e.g. Cell Biology Midterm'} /></label>
            <ReviewSettings value={form} onChange={v => setForm(f => ({ ...f, ...v }))} subjectOptions={subjectOptions} idPrefix="rq" hidePrompt />
          {form.visuals !== 'none' && (visualFiles(files).length > 0
            ? <small className="mute rset-files"><Icon name="eye" size={13} /> {Math.min(visualFiles(files).length, visualMax(form.visuals))} of your {visualFiles(files).length} picture{visualFiles(files).length === 1 ? '' : 's'} will be used.</small>
            : <small className="mute rset-files"><Icon name="eye" size={13} /> Add images (or a lesson video) and they will be placed in the reviewer.</small>)}
          </details>
          <button className="btn pri big" disabled={!files.length}><Icon name="sparkles" size={16} /> Generate reviewer</button>
          <small className="mute">Study notes only. Pictures and diagrams are added automatically.</small>
        </form>
      )}

      {!loaded && <RowsSkeleton count={3} label="Loading requests" />}
      {loaded && shown.length === 0 && <div className="clay tile empty">{view === 'queue' ? 'No requests waiting.' : <>Nothing yet. Add your notes above and press <b>Generate reviewer</b>.<br /><small>Or open the <b>Classroom</b> tab to build one from a Google Classroom lesson.</small></>}</div>}
      <div className="rlist">
        {shown.map(r => { const stale = isStale(r), [label, col] = stale ? ['Stuck — try again', '#e8788a'] : r.status === 'rejected' && r.reviewer_id ? ['Already in the Library', '#7fd4ba'] : (STATUS[r.status] || [r.status, '#999']), isOpen = exp === r.id, mineRow = r.user_id === me, canDel = (mineRow || admin) && r.status !== 'generating'; return (
          <div className="clay tile rcard compact" key={r.id}>
            <div className="rtop">
              <button type="button" className="rt-main" onClick={() => setExp(isOpen ? null : r.id)} aria-expanded={isOpen}>
                <b>{r.title}</b>
                <small className="mute">{r.subject} · {new Date(r.created_at).toLocaleDateString()}{view === 'queue' && <> · {names[r.user_id]?.display_name || 'user'}{names[r.user_id]?.student_no && ` · ${names[r.user_id].student_no}`}</>}</small>
              </button>
              {view === 'queue' && names[r.user_id]?.student_no && <CopyButton value={names[r.user_id].student_no} label="Student ID" toast={toast} />}
              <span className="pill" style={{ background: col }}>{label}</span>
              {canDel && <button className="icon-btn" aria-label="Delete request" title="Delete" onClick={() => del(r)}><Icon name="trash" size={16} /></button>}
            </div>
            {isOpen && <div className="rdetail">
              <small className="mute">{TEMPLATES[r.template] || r.template} / {r.theme}</small>
              {cleanAids(r.aids).length > 0 && <small className="mute">Study aids: {cleanAids(r.aids).map(k => AIDS[k].label).join(', ')}</small>}
              {r.coverage && <p>{r.coverage}</p>}
              {r.files?.length > 0 && <div className="files">{r.files.map(f => (admin || mineRow) ? <span className="fchip" key={f.path}><button type="button" className="fc-open" onClick={() => openFile(f)}><Icon name="clip" size={13} /> {f.name}</button>{mineRow && r.status === 'pending' && <button type="button" aria-label={`Remove ${f.name}`} title="Remove this file" onClick={() => removeFile(r, f)}><Icon name="x" size={13} /></button>}</span> : null)}</div>}
            </div>}
            {r.status === 'rejected' && <p className="note">{r.admin_note || 'No reason given.'}</p>}
            {work === r.id && <AiBar p={prog} />}
            {r.status === 'failed' && <p className="note">{admin || r.error === 'Cancelled by you.' ? r.error : 'Generation failed. You can try again.'}</p>}
            {stale && <p className="note">This build stopped responding before it could finish. Press <b>Try again</b> to restart it.</p>}
            <div className="acts">
              {r.status === 'done' && <button className="btn pri" onClick={() => onOpenLibrary(r.title)}>Open in Library</button>}
              {r.status === 'rejected' && r.reviewer_id && <button className="btn pri" onClick={() => openExisting(r)}>Open the existing reviewer</button>}
              {mineRow && ['failed', 'approved', 'pending'].includes(r.status) && work !== r.id && !pause && <button className="btn pri" onClick={() => generate(r.id)}>{r.status === 'failed' ? 'Try again' : 'Generate'}</button>}
              {stale && work !== r.id && !pause && <button className="btn pri" onClick={() => generate(r.id)}>Try again</button>}
              {r.status === 'rejected' && mineRow && !r.reviewer_id && <button className="btn" onClick={() => again(r)}>Edit &amp; try again</button>}
              {admin && !mineRow && ['pending', 'approved', 'failed'].includes(r.status) && <>
                <button className="btn pri" disabled={work === r.id} onClick={() => approve(r)}>{work === r.id ? 'Generating…' : r.status === 'failed' ? 'Retry' : r.status === 'approved' ? 'Generate' : 'Approve & generate'}</button>
                {['pending', 'approved'].includes(r.status) && <><input className="clay-in" style={{ flex: 1, minWidth: 140 }} placeholder="Reason (if rejecting)" value={notes[r.id] || ''} onChange={e => setNotes({ ...notes, [r.id]: e.target.value })} /><button className="btn dng" onClick={() => reject(r)}>Reject</button></>}
              </>}
            </div>
          </div>) })}
      </div>
    </div>
  )
}
