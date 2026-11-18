// University Astra: a guide for each school (enrollment, programs, scholarships, campus life, tips, contacts).
// Admins write the guides; every student sees the guide for their own school first and can browse other schools.
import { useCallback, useEffect, useMemo, useState } from 'react'
import SchoolInput from './SchoolInput'
import { uniqueOptions } from './fuzzy'
import { sb } from './supabase'
import { uid } from './lib'
import Icon, { Logo } from './Icons'
import { GuideSkeleton } from './Skeleton'
import FilePicker from './FilePicker'
import { runJob } from './uploads'
import { useUniversities, normSchool, sameSchool } from './schools'
import AstraApply from './AstraApply'

// Attachments on a guide: photos, short videos and PDFs. Kept in their own
// private bucket so students of any school can see them without exposing notes.
export const ASTRA_MAX = 8, ASTRA_MAX_BYTES = 25 * 1024 * 1024
const ASTRA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime', 'application/pdf']
const typeOf = f => f.type || (/\.pdf$/i.test(f.name) ? 'application/pdf'
  : /\.(mp4|m4v)$/i.test(f.name) ? 'video/mp4'
    : /\.webm$/i.test(f.name) ? 'video/webm'
      : /\.mov$/i.test(f.name) ? 'video/quicktime'
        : /\.gif$/i.test(f.name) ? 'image/gif'
          : /\.png$/i.test(f.name) ? 'image/png'
            : /\.jpe?g$/i.test(f.name) ? 'image/jpeg'
              : /\.webp$/i.test(f.name) ? 'image/webp' : '')
const okAstraFile = f => ASTRA_TYPES.includes(typeOf(f))

async function openAstraFile(f, toast) {
  const { data, error } = await sb.storage.from('astra-files').createSignedUrl(f.path, 300)
  if (error) toast(error.message); else window.open(data.signedUrl, '_blank', 'noopener')
}

// Read-only attachments on a guide card. Images get thumbnails; videos/PDFs
// open in a new tab through a short-lived signed URL.
const NO_FILES = []
function GuideFiles({ files, toast }) {
  const list = files || NO_FILES
  const [urls, setUrls] = useState({})
  const imgs = useMemo(() => list.filter(f => String(f.type || '').startsWith('image/')), [list])
  useEffect(() => {
    if (!imgs.length) return
    let alive = true
    sb.storage.from('astra-files').createSignedUrls(imgs.map(f => f.path), 3600).then(({ data }) => {
      if (alive) setUrls(Object.fromEntries((data || []).filter(x => x.signedUrl).map(x => [x.path, x.signedUrl])))
    })
    return () => { alive = false }
  }, [imgs])
  if (!list.length) return null
  return (
    <div className="g-files">
      {list.map(f => {
        const img = String(f.type || '').startsWith('image/')
        return img && urls[f.path]
          ? <button key={f.path} type="button" className="g-file" title={f.name} aria-label={`Open ${f.name}`} onClick={() => openAstraFile(f, toast)}><img src={urls[f.path]} alt={f.name} loading="lazy" /></button>
          : <button key={f.path} type="button" className="btn" onClick={() => openAstraFile(f, toast)}><Icon name={img ? 'image' : 'clip'} size={14} /> {f.name}</button>
      })}
    </div>
  )
}

export const CATEGORIES = {
  enrollment: { label: 'Enrollment & admission', icon: 'exam', color: '#6c7bf0' },
  programs: { label: 'Programs & courses', icon: 'library', color: '#9a6bf0' },
  scholarships: { label: 'Scholarships & aid', icon: 'award', color: '#e8b13a' },
  campus: { label: 'Campus life', icon: 'pin', color: '#3fb892' },
  tips: { label: 'Student tips', icon: 'bulb', color: '#f08a3c' },
  contacts: { label: 'Offices & contacts', icon: 'mail', color: '#e5517a' },
}
const blank = school => ({ school: school || '', category: 'tips', title: '', body: '', link: '' })
const safeLink = u => (/^https?:\/\//i.test(u || '') ? u : '')

export default function Astra({ jump, admin, me, school, astraSchool, toast, onSetSchool }) {
  const unis = useUniversities()
  const [rows, setRows] = useState(null), [viewing, setViewing] = useState(school || ''), [cat, setCat] = useState(null), [q, setQ] = useState('')
  const [form, setForm] = useState(null), [busy, setBusy] = useState(false)
  const [addFiles, setAddFiles] = useState([]), [gone, setGone] = useState([])
  const can = admin || (!!astraSchool && sameSchool(astraSchool, viewing))

  const load = useCallback(async () => {
    const { data, error } = await sb.from('astra_guides').select('*').order('created_at', { ascending: false }).limit(1000)
    if (error) { toast(`Couldn't load University Astra: ${error.message}`); setRows([]); return }
    setRows(data)
  }, [toast])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (jump?.s) setViewing(jump.s) }, [jump])
  useEffect(() => { if (school && !viewing) setViewing(school) }, [school, viewing])

  const schools = useMemo(() => {
    const m = new Map()
    for (const r of rows || []) { const k = normSchool(r.school).toLowerCase(); m.set(k, (m.get(k) || { name: normSchool(r.school), n: 0 })); m.get(k).n++ }
    if (school && !m.has(normSchool(school).toLowerCase())) m.set(normSchool(school).toLowerCase(), { name: normSchool(school), n: 0 })
    return [...m.values()].sort((a, b) => (sameSchool(b.name, school) - sameSchool(a.name, school)) || a.name.localeCompare(b.name))
  }, [rows, school])

  const schoolOptions = useMemo(() => uniqueOptions([...schools.map(s => [s.name, s.n + 1]), ...unis]), [schools, unis])

  const guides = useMemo(() => {
    const s = q.toLowerCase()
    return (rows || []).filter(r => sameSchool(r.school, viewing) && (!cat || r.category === cat) && (!s || (r.title + ' ' + r.body + ' ' + (r.files || []).map(f => f.name).join(' ')).toLowerCase().includes(s)))
  }, [rows, viewing, cat, q])
  const counts = useMemo(() => { const m = {}; (rows || []).filter(r => sameSchool(r.school, viewing)).forEach(r => { m[r.category] = (m[r.category] || 0) + 1 }); return m }, [rows, viewing])
  const total = Object.values(counts).reduce((a, b) => a + b, 0)

  const openNew = () => { setAddFiles([]); setGone([]); setForm(blank(viewing)) }
  const openEdit = g => { setAddFiles([]); setGone([]); setForm({ ...g }) }

  const save = async e => {
    e.preventDefault()
    if (busy) return
    if (!me) return toast('Please sign in again.')
    const title = form.title.trim()
    if (!title) return toast('Give this guide a title.')
    const editing = !!form.id, guideId = form.id || crypto.randomUUID()
    const schoolName = normSchool(form.school), body = form.body.trim(), link = form.link.trim(), category = form.category
    const keep = (form.files || []).filter(f => !gone.includes(f.path)), add = addFiles, removed = gone
    setBusy(true)
    try {
      // Upload in the background (progress bar at the top), then save the row.
      // A failed save removes only the files this attempt uploaded.
      await runJob(`${editing ? 'Updating' : 'Adding'} “${title}”`, async job => {
        const uploaded = []
        job.total(add.length + 1)
        try {
          const files = [...keep]
          for (const f of add) {
            const path = `${me}/astra/${guideId}/${uid()}-${f.name.replace(/[^\w.\-]/g, '_')}`
            const { error } = await sb.storage.from('astra-files').upload(path, f, { contentType: typeOf(f) })
            if (error) throw error
            uploaded.push(path); files.push({ path, name: f.name, type: typeOf(f), size: f.size }); job.step()
          }
          const row = { school: schoolName, category, title, body, link, files, updated_at: new Date().toISOString() }
          const { error } = editing
            ? await sb.from('astra_guides').update(row).eq('id', guideId)
            : await sb.from('astra_guides').insert({ id: guideId, ...row })
          if (error) throw error
          job.step()
          // The row is saved; a failed cleanup must not delete the new uploads.
          if (removed.length) { try { await sb.storage.from('astra-files').remove(removed) } catch { /* orphaned files only */ } }
        } catch (err) {
          if (uploaded.length) await sb.storage.from('astra-files').remove(uploaded)
          throw err
        }
      })
      toast(editing ? 'Guide updated.' : 'Guide added.')
      setViewing(schoolName); setForm(null); setAddFiles([]); setGone([]); load()
    } catch (err) {
      toast(/check constraint/i.test(err.message) ? 'Check the title, school and link (must start with http).' : err.message)
    }
    setBusy(false)
  }
  const remove = async g => {
    if (!confirm(`Delete “${g.title}”?${g.files?.length ? ' Its attached files are removed too.' : ''}`)) return
    const { error } = await sb.from('astra_guides').delete().eq('id', g.id)
    if (error) return toast(error.message)
    if (g.files?.length) await sb.storage.from('astra-files').remove(g.files.map(f => f.path))
    load()
  }

  const stored = (form?.files || []).filter(f => !gone.includes(f.path))

  return (
    <div className="astra">
      <section className="clay astra-hero">
        <Logo size={52} />
        <div className="astra-h">
          <small className="onb-step">University Astra</small>
          <h2>{viewing || 'Your university guide'}</h2>
          <p className="mute">{viewing ? (total ? `${total} guide${total === 1 ? '' : 's'} for students of ${viewing}.` : 'No guides here yet.') : 'Pick your school to see its guide: how to enroll, which scholarships exist, where to go, and tips from people who have been there.'}</p>
        </div>
        <div className="astra-pick">
          <label className="mute" htmlFor="astra-school">Viewing guide for</label>
          <SchoolInput id="astra-school" hint={false} value={viewing} maxLength={80} placeholder="Type a university, e.g. PUP" options={schoolOptions} onChange={setViewing} />
        </div>
      </section>

      {!school && <div className="nudge" role="note"><Icon name="school" size={18} /><span>You haven’t set your school yet.</span><button className="btn pri" onClick={onSetSchool}>Set my school</button></div>}

      {!admin && !astraSchool && <AstraApply toast={toast} />}

      {schools.length > 0 && (
        <div className="chips">
          {schools.map(s => <button key={s.name} className={sameSchool(s.name, viewing) ? 'chip on' : 'chip'} onClick={() => setViewing(s.name)}><Icon name="school" size={14} /> {s.name}{sameSchool(s.name, school) && <em className="you">yours</em>} <b>{s.n}</b></button>)}
        </div>
      )}

      <div className="bar">
        <div className="search grow"><Icon name="search" size={17} /><input className="clay-in" value={q} onChange={e => setQ(e.target.value)} placeholder="Search this guide…" aria-label="Search this guide" /></div>
        {can && <button className="btn pri" onClick={openNew}><Icon name="plus" size={16} /> Add guide</button>}
      </div>
      <div className="chips">
        <button className={!cat ? 'chip on' : 'chip'} onClick={() => setCat(null)}>All <b>{total}</b></button>
        {Object.entries(CATEGORIES).map(([k, c]) => <button key={k} className={cat === k ? 'chip on' : 'chip'} onClick={() => setCat(k)}><Icon name={c.icon} size={14} style={{ color: c.color }} /> {c.label} <b>{counts[k] || 0}</b></button>)}
      </div>

      {rows === null && <GuideSkeleton />}
      {rows && viewing && guides.length === 0 && (
        <div className="clay tile empty">
          <Icon name="cap" size={34} />
          <p>{total ? 'Nothing matches that filter.' : `There’s no University Astra guide for ${viewing} yet.`}</p>
          {!total && (can ? <button className="btn pri" onClick={openNew}>Write the first guide</button> : <small>Admins can add one. Tell them what you’d like to see.</small>)}
        </div>
      )}
      <div className="guides">
        {guides.map(g => { const c = CATEGORIES[g.category] || CATEGORIES.tips, href = safeLink(g.link); return (
          <article className="clay guide" key={g.id}>
            <div className="g-ic" style={{ background: c.color + '22', color: c.color }}><Icon name={c.icon} size={20} /></div>
            <div className="g-main">
              <small className="g-cat" style={{ color: c.color }}>{c.label}</small>
              <h3>{g.title}</h3>
              {g.body && <p>{g.body}</p>}
              <GuideFiles files={g.files} toast={toast} />
              <div className="g-foot">
                {href && <a className="btn" href={href} target="_blank" rel="noopener noreferrer"><Icon name="external" size={15} /> Open link</a>}
                <small className="mute">Updated {new Date(g.updated_at || g.created_at).toLocaleDateString()}</small>
                {can && <span className="g-admin"><button className="btn" onClick={() => openEdit(g)}><Icon name="edit" size={15} /> Edit</button><button className="btn dng" onClick={() => remove(g)} aria-label="Delete guide"><Icon name="trash" size={15} /></button></span>}
              </div>
            </div>
          </article>) })}
      </div>

      {form && (
        <div className="scrim" onClick={() => setForm(null)}>
          <form className="clay modal wide-modal" onClick={e => e.stopPropagation()} onSubmit={save}>
            <h3 className="h-ic"><Icon name="cap" size={18} /> {form.id ? 'Edit guide' : 'New guide'}</h3>
            <label>School<SchoolInput required maxLength={80} readOnly={!admin} value={form.school} options={schoolOptions} onChange={v => setForm(f => ({ ...f, school: v }))} /></label>
            <div className="two-col">
              <label>Section<select className="clay-in" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>{Object.entries(CATEGORIES).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}</select></label>
              <label>Link (optional)<input className="clay-in" type="url" maxLength={300} placeholder="https://" value={form.link} onChange={e => setForm({ ...form, link: e.target.value })} /></label>
            </div>
            <label>Title<input className="clay-in" required maxLength={120} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. How to apply for the entrance exam" /></label>
            <label>Details<textarea className="clay-in" rows="7" maxLength={4000} value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} placeholder="Steps, deadlines, requirements, tips…" /></label>
            <div className="field">
              <b>Photos, videos & PDFs <small className="mute">(optional)</small></b>
              <FilePicker files={addFiles} onChange={setAddFiles} stored={stored} onRemoveStored={f => { if (confirm(`Remove “${f.name}”?`)) setGone(g => [...g, f.path]) }} max={ASTRA_MAX} maxBytes={ASTRA_MAX_BYTES} isOk={okAstraFile} onError={toast} accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime,.pdf,.m4v" label="Add photos or videos" hint="images, video or PDF · 25 MB each" />
            </div>
            <div className="row modal-foot"><button type="button" className="btn" onClick={() => { setForm(null); setAddFiles([]); setGone([]) }}>Cancel</button><button className="btn pri" disabled={busy}>{busy ? 'Saving…' : 'Save guide'}</button></div>
          </form>
        </div>
      )}
    </div>
  )
}
