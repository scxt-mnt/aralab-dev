import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { callAi } from './aiRun'
import AiBar from './AiBar'
import { sb } from './supabase'
import { analyse, color, fmtSize, NONE, uid, prepareReviewer } from './lib'
import { renderReviewer, THEMES } from './render'
import Icon from './Icons'
import useAppDark from './useAppDark'
import Challenge from './Challenge'
import { canChallenge } from './challengeLogic'
import { CardsSkeleton } from './Skeleton'
import Avatar from './UserAvatar'
import SuggestInput from './SuggestInput'
import { uniqueOptions } from './fuzzy'
import { SCOPES, WHO, WHEN, SORTS, filterItems, sortItems, activeCount } from './libraryFilter'
import { suggestReviewers } from './suggest'
import { shareReviewer, canShareReviewer } from './shareLink'

import FilePicker from './FilePicker'
import { runJob } from './uploads'
import { CompareModal, ContentEditor, changed } from './FlagCompare'
import { normalizeContent, FULL_CAPS } from './render'
import { FLAG_REASONS, FlagPointsView, maxFlagBytes, MAX_FILES, MAX_POINTS, fileType, pointsOf } from './flagUi'
import { LIMIT_HINT } from './limits'
import { ACCEPT, convertFile } from './fileConvert'
import { makeThumb } from './visuals'
import LivePreview from './LivePreview'
import QuickStudy from './QuickStudy'
import { loadReviewerRec, peekReviewer, prefetchReviewer, purgeReviewer } from './reviewerCache'
import { canRefresh, refreshWait, UPDATE_AFTER_DAYS } from './reviewSettings'
export { FLAG_REASONS }

export default function Library({ jump, openId, loading, items, admin, astraSchool, reload, toast, me, school, program = '', onOpenProfile, wantText }) {
  const [subject, setSubject] = useState(null), [q, setQ] = useState(''), [sort, setSort] = useState('new')
  const [scope, setScope] = useState('all'), [who, setWho] = useState('any'), [when, setWhen] = useState('any'), [panel, setPanel] = useState(false), [following, setFollowing] = useState(() => new Set())
  useEffect(() => { sb.from('follows').select('followee').eq('follower', me).then(({ data }) => setFollowing(new Set((data || []).map(r => r.followee)))) }, [me])
  useEffect(() => { if (jump?.q) { setQ(jump.q); setSubject(null); setScope('all'); setWho('any'); setWhen('any') } }, [jump])   // "Open in Library" from a request jumps straight to that reviewer
  useEffect(() => { if (q.trim().length >= 2) wantText?.() }, [q, wantText])   // search looks inside reviewers: load their text now (once)
  const [modal, setModal] = useState(null), [open, setOpen] = useState(null), fileRef = useRef(), [removeFor, setRemoveFor] = useState(null)
  // v75: "Update reviewer" — available to the author or an admin once the reviewer is 5 days old.
  const [updateFor, setUpdateFor] = useState(null), [recStamp, setRecStamp] = useState(0)
  // v72: one primary "Read" action per card; everything secondary lives in a calm bottom sheet.
  const [menuFor, setMenuFor] = useState(null), [startFocus, setStartFocus] = useState(false)
  const openNormal = i => { setStartFocus(false); setOpen(i) }
  const openRead = i => { setStartFocus(true); setOpen(i) }
  // v65: a shared link (/r/<id>) opens that reviewer straight away; a private, removed or deleted one says so instead of showing nothing
  useEffect(() => {
    if (!openId) return
    const it = items.find(i => i.id === openId.id)
    if (it) { setSubject(null); setStartFocus(false); setOpen(it) } else toast('That reviewer is private, removed, or no longer exists.')
  }, [openId])  // eslint-disable-line react-hooks/exhaustive-deps
  const [flags, setFlags] = useState([]), [flagFor, setFlagFor] = useState(null), [reviewFor, setReviewFor] = useState(null)
  const [people, setPeople] = useState({}), [hidden, setHidden] = useState({}), [helpers, setHelpers] = useState({})
  // hidden author names + students whose accepted flag improved a reviewer (errors are ignored if the v15 SQL is not run yet)
  const loadExtra = useCallback(async () => {
    const [h, r] = await Promise.all([sb.from('reviewers').select('id').eq('hide_author', true), sb.rpc('reviewer_helpers')])
    setHidden(Object.fromEntries((h.data || []).map(x => [x.id, true])))
    const m = {}; (r.data || []).forEach(x => { (m[x.reviewer_id] = m[x.reviewer_id] || []).push(x.user_id) }); setHelpers(m)
  }, [])
  useEffect(() => { loadExtra() }, [loadExtra, items])
  const toggleHide = async i => {
    const v = !hidden[i.id], { error } = await sb.from('reviewers').update({ hide_author: v }).eq('id', i.id)
    if (error) return toast(/hide_author/.test(error.message) ? 'Run the latest supabase-setup.sql first.' : error.message)
    toast(v ? 'Your name is now hidden on this reviewer.' : 'Your name is shown again.'); loadExtra()
  }

  // Who contributed each reviewer: the student who sent the request (owner_id). Loaded once per change.
  const ownerKey = useMemo(() => [...new Set([...items.map(i => i.owner_id), ...Object.values(helpers).flat()].filter(Boolean))].sort().join(','), [items, helpers])
  useEffect(() => {
    if (!ownerKey) { setPeople({}); return }
    let live = true
    const ids = ownerKey.split(',')
    sb.from('profiles').select('user_id,display_name,avatar_url,student_no,school,program').in('user_id', ids).then(async r => {
      if (r.error) r = await sb.from('profiles').select('user_id,display_name,avatar_url,student_no,school').in('user_id', ids)      // database not upgraded yet: no program, suggestions still use your own reviewers
      if (live) setPeople(Object.fromEntries((r.data || []).map(p => [p.user_id, p])))
    })
    return () => { live = false }
  }, [ownerKey])

  const loadFlags = useCallback(async () => {
    const base = 'id,reviewer_id,user_id,reason,note,points,created_at,astra_verdict'
    let { data, error } = await sb.from('reviewer_flags').select(base + ',original,proposed,fixed_by').eq('resolved', false).order('created_at', { ascending: false })
    if (error) ({ data } = await sb.from('reviewer_flags').select(base).eq('resolved', false).order('created_at', { ascending: false }))   // SQL v13 not run yet: still show flags
    setFlags(data || [])
  }, [])
  useEffect(() => { loadFlags() }, [loadFlags])
  // v48: stars. `starred` = reviewers I starred; `bump` = my own change not yet in the loaded counts (cleared whenever the list reloads)
  const [starred, setStarred] = useState(() => new Set()), [bump, setBump] = useState({})
  useEffect(() => { sb.from('reviewer_stars').select('reviewer_id').then(({ data }) => { if (data) setStarred(new Set(data.map(r => r.reviewer_id))) }) }, [])
  useEffect(() => { setBump({}) }, [items])
  const starCount = i => Math.max(0, (i.stars || 0) + (bump[i.id] || 0))
  const toggleStar = async i => {
    const was = starred.has(i.id), flip = on => { setStarred(s => { const n = new Set(s); on ? n.add(i.id) : n.delete(i.id); return n }); setBump(b => ({ ...b, [i.id]: (b[i.id] || 0) + (on ? 1 : -1) })) }
    flip(!was)
    const { error } = await sb.rpc('toggle_star', { _id: i.id })
    if (error) { flip(was); toast(/toggle_star/.test(error.message) ? 'Run the latest supabase-setup.sql first.' : error.message) }
  }
  // v68: "Add to my collection": reviewers I saved for myself (private list, filter chip "My collection")
  const [coll, setColl] = useState(() => new Set())
  useEffect(() => { sb.from('reviewer_collection').select('reviewer_id').then(({ data }) => { if (data) setColl(new Set(data.map(r => r.reviewer_id))) }) }, [])
  const toggleColl = async i => {
    const was = coll.has(i.id), flip = on => setColl(s => { const n = new Set(s); on ? n.add(i.id) : n.delete(i.id); return n })
    flip(!was)
    const { error } = was ? await sb.from('reviewer_collection').delete().eq('reviewer_id', i.id) : await sb.from('reviewer_collection').insert({ reviewer_id: i.id })
    if (error) { flip(was); toast(/reviewer_collection/.test(error.message) ? 'Run the latest supabase-setup.sql first.' : error.message) }
    else toast(was ? 'Removed from your collection.' : 'Added to your collection.')
  }
  const creditsFor = (i, size = 22, full = false) => <Credits item={i} me={me} admin={admin} people={people} hidden={!!hidden[i.id]} helpers={helpers[i.id]} onOpen={onOpenProfile} size={size} full={full} />
  const myFlags = useMemo(() => Object.fromEntries(flags.filter(f => f.user_id === me).map(f => [f.reviewer_id, f])), [flags, me])
  const flagCount = useMemo(() => { const m = {}; flags.forEach(f => { m[f.reviewer_id] = (m[f.reviewer_id] || 0) + 1 }); return m }, [flags])
  const flaggedItems = items.filter(i => flagCount[i.id])

  const subjects = useMemo(() => { const m = {}; items.forEach(i => { m[i.subject] = (m[i.subject] || 0) + 1 }); return Object.entries(m).sort() }, [items])
  const filters = { q, scope, who, when, subject }
  const rows = useMemo(() => sortItems(filterItems(items, filters, { me, flagCount, following, people, mySchool: school, collection: coll }), sort), [items, subject, q, scope, who, when, sort, flagCount, following, people, school, me, coll])  // eslint-disable-line react-hooks/exhaustive-deps
  const nFilters = activeCount(filters)
  const clearAll = () => { setQ(''); setScope('all'); setWho('any'); setWhen('any'); setSubject(null) }
  const tags = [
    q.trim() && [`“${q.trim()}”`, () => setQ('')], scope !== 'all' && [SCOPES.find(x => x[0] === scope)[1], () => setScope('all')],
    who !== 'any' && [WHO.find(x => x[0] === who)[1], () => setWho('any')], when !== 'any' && [WHEN.find(x => x[0] === when)[1], () => setWhen('any')],
    subject && [subject === '__mine' ? 'Mine' : subject === '__collection' ? 'My collection' : subject === '__flagged' ? 'Flagged' : subject, () => setSubject(null)],
  ].filter(Boolean)

  // v59: a short "Suggested for you" strip, only on the plain Library view (no search or filters). The list below is NOT re-sorted.
  const [hideSugg, setHideSugg] = useState(false)
  const suggestions = useMemo(() => suggestReviewers(items, { me, program, school, starred, people }), [items, me, program, school, starred, people])
  const save = async (html, fallback, subj, titleOverride) => {
    const a = analyse(html, fallback)
    const { error } = await sb.from('reviewers').upsert({ id: uid(), title: titleOverride || a.title, subject: subj || NONE, text: a.text, size: new Blob([html]).size, added: Date.now(), html })
    if (error) throw error
  }
  const submit = async f => {
    try {
      if (modal.type === 'add') { for (const file of modal.files) await save(await file.text(), file.name.replace(/\.html?$/i, ''), f.subject); toast(`Added ${modal.files.length} reviewer(s).`) }
      if (modal.type === 'paste') { await save(f.html, 'Pasted reviewer', f.subject, f.title.trim()); toast('Saved.') }
      if (modal.type === 'edit') {
        const { data, error } = await sb.from('reviewers').update({ title: f.title, subject: f.subject || NONE }).eq('id', modal.item.id).select('id')
        if (error) throw error; if (!data.length) throw new Error('Not allowed. You are not an admin.')
      }
      setModal(null); reload()
    } catch (e) { toast(e.message) }
  }
  // staff (admin, or Astra for students of their own school) can take a reviewer down with a written reason; the owner is notified
  const sameSchool = i => !!astraSchool && !!people[i.owner_id]?.school && people[i.owner_id].school.trim().toLowerCase() === astraSchool.trim().toLowerCase()
  const canRemove = i => !i.removed_at && !!i.owner_id && i.owner_id !== me && (admin || sameSchool(i))
  const restore = async i => {
    const { error } = await sb.rpc('restore_reviewer', { _id: i.id })
    if (error) return toast(/restore_reviewer/.test(error.message) ? 'Run the latest supabase-setup.sql first.' : error.message)
    toast('Reviewer restored. The student was told.'); reload()
  }
  const remove = async i => {
    const own = i.owner_id === me && !admin
    if (!confirm(own ? `Delete your reviewer "${i.title}"? Its flags and credits are deleted too. This cannot be undone.` : `Delete "${i.title}"?`)) return false
    const { data, error } = await sb.from('reviewers').delete().eq('id', i.id).select('id')
    if (error || !data.length) { toast(error?.message || (own ? 'Could not delete. Run the latest supabase-setup.sql first.' : 'Not allowed. You are not an admin.')); return false }
    toast('Reviewer deleted.'); reload(); return true
  }

  return (
    <div>
      <div className="bar">
        <div className="search grow"><Icon name="search" size={17} /><input className="clay-in" value={q} onChange={e => setQ(e.target.value)} placeholder="Search titles, subjects, and what's inside…" /></div>
        <button className={panel || nFilters ? 'btn on' : 'btn'} aria-expanded={panel} onClick={() => setPanel(!panel)}><Icon name="list" size={16} /> Filters{nFilters > 0 && <b className="fbadge">{nFilters}</b>}</button>
        <select className="clay-in" value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort">{SORTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select>
        {admin && <><button className="btn pri" onClick={() => fileRef.current.click()}><Icon name="plus" size={16} /> Add files</button>
          <button className="btn" onClick={() => setModal({ type: 'paste' })}>Paste HTML</button>
          <input ref={fileRef} type="file" hidden multiple accept=".html,.htm,text/html" onChange={e => { const fl = [...e.target.files].filter(f => /\.html?$/i.test(f.name)); e.target.value = ''; if (fl.length) setModal({ type: 'add', files: fl }) }} /></>}
      </div>
      {panel && (
        <div className="clay tile lib-filters" role="group" aria-label="Filters">
          <label>Search in<select className="clay-in" value={scope} onChange={e => setScope(e.target.value)}>{SCOPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label>
          <label>Contributor<select className="clay-in" value={who} onChange={e => setWho(e.target.value)}>{WHO.map(([k, label]) => <option key={k} value={k} disabled={k === 'school' && !school}>{label}{k === 'school' && !school ? ' (add your university first)' : ''}</option>)}</select></label>
          <label>Added<select className="clay-in" value={when} onChange={e => setWhen(e.target.value)}>{WHEN.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label>
          <button className="btn" onClick={clearAll} disabled={!tags.length}>Clear all</button>
        </div>)}
      {tags.length > 0 && <div className="chips active-f" aria-label="Active filters">{tags.map(([label, off]) => <button key={label} className="chip on" onClick={off} title="Remove this filter">{label} <Icon name="x" size={12} /></button>)}<small className="mute lib-count">{rows.length} of {items.length} reviewers</small></div>}
      <div className="chips">
        <button className={!subject ? 'chip on' : 'chip'} onClick={() => setSubject(null)}>All <b>{items.length}</b></button>
        {items.some(i => i.owner_id === me) && <button className={subject === '__mine' ? 'chip on' : 'chip'} onClick={() => setSubject('__mine')}>Mine <b>{items.filter(i => i.owner_id === me).length}</b></button>}
        {coll.size > 0 && <button className={subject === '__collection' ? 'chip on' : 'chip'} onClick={() => setSubject('__collection')}><Icon name="check" size={13} /> My collection <b>{items.filter(i => coll.has(i.id)).length}</b></button>}
        {admin && flaggedItems.length > 0 && <button className={subject === '__flagged' ? 'chip on warn' : 'chip warn'} onClick={() => setSubject('__flagged')}><Icon name="flag" size={14} /> Flagged <b>{flaggedItems.length}</b></button>}
        {subjects.map(([s, n]) => <button key={s} className={subject === s ? 'chip on' : 'chip'} onClick={() => setSubject(s)}><i style={{ background: color(s) }} />{s} <b>{n}</b></button>)}
      </div>
      {!hideSugg && !loading && !tags.length && suggestions.length > 0 && (
        <section className="suggest" aria-label="Suggested for you">
          <div className="suggest-head"><b><Icon name="sparkles" size={15} /> Suggested for you</b><small className="mute">Based on your program and your reviewers</small>
            <button type="button" className="icon-btn" onClick={() => setHideSugg(true)} aria-label="Hide suggestions" title="Hide for now"><Icon name="x" size={14} /></button></div>
          <div className="suggest-row">
            {suggestions.map(({ item: i, reason }) => (
              <button type="button" key={i.id} className="suggest-card" onClick={() => openNormal(i)}>
                <span className="tag" style={{ background: color(i.subject) }}>{i.subject}</span>
                <b>{i.title}</b>
                <small className="mute">{reason}{starCount(i) > 0 && ` · ${starCount(i)} ★`}</small>
              </button>))}
          </div>
        </section>)}
      {loading && items.length === 0 && <CardsSkeleton />}
      {!loading && rows.length === 0 && <div className="clay tile empty">{items.length ? 'Nothing matches.' : admin ? 'Empty. Add your first reviewer.' : 'No reviewers have been posted.'}</div>}
      <div className="cards" onPointerOver={e => prefetchReviewer(e.target.closest?.('[data-rid]')?.dataset.rid)} onFocus={e => prefetchReviewer(e.target.closest?.('[data-rid]')?.dataset.rid)} onTouchStart={e => prefetchReviewer(e.target.closest?.('[data-rid]')?.dataset.rid)}>
        {rows.map((i, idx) => (
          <div className="clay card" key={i.id} data-rid={i.id} style={{ '--i': Math.min(idx, 12) }}>
            <div className="rcover live" aria-hidden="true" onClick={() => openNormal(i)}><LivePreview item={i} /></div>
            <span className="tag" style={{ background: color(i.subject) }}>{i.subject}</span>{i.removed_at ? <small className="priv rm">Removed</small> : i.is_public === false && <small className="priv">Private</small>}
            <button className="title" onClick={() => openNormal(i)}>{i.title}</button>
            {i.preview?.n && <small className="rc-n">{[i.preview.min ? `${i.preview.min} min read` : '', i.preview.t?.length ? `${i.preview.t.length}+ topics` : '', i.preview.n.cards ? `${i.preview.n.cards} cards` : '', i.preview.n.quiz ? `${i.preview.n.quiz} questions` : ''].filter(Boolean).join(' · ')}</small>}
            {(i.owner_id || helpers[i.id]) && creditsFor(i)}
            <small>{fmtSize(i.size)} · {new Date(i.added).toLocaleDateString()}</small>
            <small className="stat-row"><span title="Students who opened this reviewer"><Icon name="user" size={13} /> {i.visitors || 0} visitor{(i.visitors || 0) === 1 ? '' : 's'}</span><span title="Stars"><Icon name="star" size={13} /> {starCount(i)}</span></small>
            {i.faces?.length > 0 && <div className="visitors-row"><VisitorFaces item={i} onOpenProfile={onOpenProfile} /><small className="mute">recent visitors</small></div>}
            {i.removed_at && <p className="note rm-note"><b>Removed from the Library.</b> {i.removed_reason || 'No reason given.'}{admin ? '' : ' Only you can still see it.'}</p>}
            <div className="card-cta">
              {(() => { const pr = readProg(`rl-prog:${me}:${i.id}`), pc = pr.total ? Math.min(100, Math.round((pr.done.length / pr.total) * 100)) : 0; return <button className="btn pri read-btn" onClick={() => openRead(i)}><Icon name="book" size={15} /> {pc >= 100 ? 'Review again' : pc > 0 ? `Continue · ${pc}%` : 'Read'}</button> })()}
              <button className={starred.has(i.id) ? 'btn star on' : 'btn star'} onClick={() => toggleStar(i)} aria-pressed={starred.has(i.id)} title={starred.has(i.id) ? 'Remove your star' : 'Star this reviewer'}><Icon name="star" size={15} /> {starCount(i)}</button>
              <button className="icon-btn card-more" onClick={() => setMenuFor(i)} aria-label={`More actions for ${i.title}`} aria-haspopup="dialog" title="More actions"><Icon name="more" size={18} /></button>
            </div>
          </div>))}
      </div>
      {menuFor && <Sheet title={menuFor.title} onClose={() => setMenuFor(null)}>
        <div className="sheet-list">
          <button type="button" className="sheet-item" onClick={() => { const i = menuFor; setMenuFor(null); openRead(i) }}><Icon name="book" size={18} /><span>Open reviewer</span></button>
          {!menuFor.removed_at && <button type="button" className="sheet-item" onClick={() => toggleColl(menuFor)}><Icon name={coll.has(menuFor.id) ? 'check' : 'plus'} size={18} /><span>{coll.has(menuFor.id) ? 'Remove from my collection' : 'Add to my collection'}</span></button>}
          {canShareReviewer(menuFor) && <button type="button" className="sheet-item" onClick={() => { setMenuFor(null); shareReviewer(menuFor, toast) }}><Icon name="share" size={18} /><span>Share reviewer</span></button>}
          {refreshWait(menuFor, me, admin, Date.now(), sameSchool(menuFor)) > 0 && <button type="button" className="sheet-item" disabled aria-disabled="true" style={{ opacity: .6 }}><Icon name="refresh" size={18} /><span>Update reviewer with AI · available in {refreshWait(menuFor, me, admin, Date.now(), sameSchool(menuFor))} day{refreshWait(menuFor, me, admin, Date.now(), sameSchool(menuFor)) === 1 ? '' : 's'}</span></button>}
          {canRefresh(menuFor, me, admin, Date.now(), sameSchool(menuFor)) && <button type="button" className="sheet-item" onClick={() => { setMenuFor(null); setUpdateFor(menuFor) }}><Icon name="refresh" size={18} /><span>Update reviewer with AI</span></button>}
          <button type="button" className={myFlags[menuFor.id] ? 'sheet-item dng' : 'sheet-item'} onClick={() => { setMenuFor(null); setFlagFor(menuFor) }}><Icon name="flag" size={18} /><span>{myFlags[menuFor.id] ? 'You flagged this reviewer' : 'Flag as incomplete or wrong'}</span></button>
          {menuFor.owner_id === me && <button type="button" className="sheet-item" onClick={() => toggleHide(menuFor)}><Icon name={hidden[menuFor.id] ? 'eye' : 'ghost'} size={18} /><span>{hidden[menuFor.id] ? 'Show my name' : 'Hide my name'}</span></button>}
          {(menuFor.owner_id === me || admin) && <button type="button" className="sheet-item dng" onClick={() => { setMenuFor(null); remove(menuFor) }}><Icon name="trash" size={18} /><span>Delete reviewer</span></button>}
          {canRemove(menuFor) && <button type="button" className="sheet-item dng" onClick={() => { setMenuFor(null); setRemoveFor(menuFor) }}><Icon name="x" size={18} /><span>Remove from the Library…</span></button>}
          {admin && menuFor.removed_at && <button type="button" className="sheet-item" onClick={() => { setMenuFor(null); restore(menuFor) }}><Icon name="refresh" size={18} /><span>Restore reviewer</span></button>}
          {admin && flagCount[menuFor.id] > 0 && <button type="button" className="sheet-item" onClick={() => { setMenuFor(null); setReviewFor(menuFor) }}><Icon name="flag" size={18} /><span>{flagCount[menuFor.id]} open flag{flagCount[menuFor.id] === 1 ? '' : 's'}</span></button>}
          {admin && <button type="button" className="sheet-item" onClick={() => { setMenuFor(null); setModal({ type: 'edit', item: menuFor }) }}><Icon name="edit" size={18} /><span>Edit title and subject</span></button>}
        </div>
      </Sheet>}
      {removeFor && <RemoveModal item={removeFor} toast={toast} onClose={() => setRemoveFor(null)} onDone={() => { setRemoveFor(null); reload() }} />}
      {updateFor && <UpdateSheet item={updateFor} toast={toast} onClose={() => setUpdateFor(null)} onDone={() => { setUpdateFor(null); setRecStamp(n => n + 1); reload() }} />}
      {open && <Viewer item={open} startFocus={startFocus} recStamp={recStamp} onUpdate={i => setUpdateFor(i)} astra={sameSchool(open)} inColl={coll.has(open.id)} onColl={() => toggleColl(open)} starred={starred.has(open.id)} stars={starCount(open)} onStar={() => toggleStar(open)} me={me} admin={admin} onClose={() => { setOpen(null); setStartFocus(false) }} toast={toast} reload={reload} flagged={!!myFlags[open.id]} onFlag={() => setFlagFor(open)} person={people[open.owner_id]} credits={creditsFor(open, 26, true)} hiddenName={!!hidden[open.id]} onToggleHide={() => toggleHide(open)} onDelete={i => remove(i).then(ok => ok && setOpen(null))} onOpenProfile={onOpenProfile} />}
      {flagFor && <FlagModal item={flagFor} me={me} mine={myFlags[flagFor.id]} onClose={() => setFlagFor(null)} toast={toast} onDone={() => { setFlagFor(null); loadFlags() }} />}
      {reviewFor && <FlagReview item={reviewFor} flags={flags.filter(f => f.reviewer_id === reviewFor.id)} toast={toast} reload={reload} onClose={() => setReviewFor(null)} onDone={() => { setReviewFor(null); loadFlags() }} onEdit={() => { setModal({ type: 'edit', item: reviewFor }); setReviewFor(null) }} />}
      {modal && <Modal modal={modal} subjects={uniqueOptions(subjects)} onClose={() => setModal(null)} onSubmit={submit} />}
    </div>
  )
}

const readProg = key => { try { const p = JSON.parse(localStorage.getItem(key) || 'null'); if (p && Array.isArray(p.done)) return { done: p.done, total: +p.total || 0 } } catch { /* ignore */ } return { done: [], total: 0 } }

function Viewer({ item, startFocus = false, recStamp = 0, onUpdate, astra = false, inColl, onColl, starred, stars, onStar, me, admin, onClose, toast, reload, flagged, onFlag, person, onOpenProfile, credits, hiddenName, onToggleHide, onDelete }) {
  const [rec, setRec] = useState(() => peekReviewer(item.id)), t0 = useRef(Date.now())
  const dark = useAppDark(), darkRef = useRef(dark), dark0 = useRef(dark).current, frameRef = useRef(null), [challenge, setChallenge] = useState(null)
  const [focus, setFocus] = useState(true), [qs, setQs] = useState(false), [more, setMore] = useState(false), [hlCount, setHlCount] = useState(0)
  darkRef.current = dark
  const progKey = `rl-prog:${me}:${item.id}`, [prog, setProg] = useState(() => readProg(progKey))
  const prefKey = `rl-rp:${me}`, hlKey = `rl-hl:${me}:${item.id}`, posKey = `rl-pos:${me}:${item.id}`
  useEffect(() => {   // v64/v72: the page (a sandboxed frame) tells us how much was reviewed and which highlights / reading settings exist; we send them back on load
    const on = e => {
      const w = frameRef.current?.contentWindow, m = e.data
      if (!w || e.source !== w || !m || m.rv !== 1) return
      if (m.type === 'ready') w.postMessage({
        rv: 1, type: 'init', dark: darkRef.current, done: readProg(progKey).done,
        prefs: readStore(prefKey, {}), highlights: readStore(hlKey, []), pos: readStore(posKey, null),
      }, '*')
      else if (m.type === 'progress' && Array.isArray(m.done)) {
        const p = { done: m.done.filter(k => typeof k === 'string' && k.length < 12).slice(0, 500), total: Math.max(0, Math.min(500, +m.total || 0)) }
        setProg(p); try { localStorage.setItem(progKey, JSON.stringify(p)) } catch { /* private mode: progress just is not remembered */ }
      }
      else if (m.type === 'highlights' && Array.isArray(m.list)) {
        const list = m.list.filter(x => x && typeof x === 'object').slice(0, 800)
        writeStore(hlKey, list); setHlCount(list.length)
      }
      else if (m.type === 'prefs' && m.prefs && typeof m.prefs === 'object') writeStore(prefKey, m.prefs)
      else if (m.type === 'pos' && m.pos && typeof m.pos === 'object') writeStore(posKey, { v: String(m.pos.v || 'study').slice(0, 12), y: Math.max(0, Math.min(1e7, +m.pos.y || 0)) })
      else if (m.type === 'escape') { closeRef.current?.() }
    }
    window.addEventListener('message', on); return () => window.removeEventListener('message', on)
  }, [progKey, prefKey, hlKey, posKey])
  useEffect(() => { frameRef.current?.contentWindow?.postMessage({ rv: 1, type: 'theme', dark }, '*') }, [dark])
  useEffect(() => {   // the app chrome steps aside while a reviewer is open, so toasts and the keyboard do not fight the reader
    document.body.classList.add('reading')
    return () => document.body.classList.remove('reading')
  }, [])
  useEffect(() => {   // v48: counts one visitor (never the owner); when that visit reaches a milestone the server e-mails the owner. Ignored until the v48 SQL is run.
    sb.rpc('record_visit', { _id: item.id }).then(async ({ data }) => {
      if (!(data > 0)) return
      const { data: s } = await sb.auth.getSession()
      if (s?.session) fetch('/api/send-milestones', { method: 'POST', headers: { Authorization: `Bearer ${s.session.access_token}` } }).catch(() => {})
    }, () => {})
  }, [item.id])
  useEffect(() => { let live = true; loadReviewerRec(item.id, { fresh: recStamp > 0 }).then(r => live && setRec(prev => (prev && JSON.stringify(prev.theme) === JSON.stringify(r.theme) && prev.content === r.content ? prev : r))).catch(e => live && toastRef.current(e.message)); return () => { live = false } }, [item.id, recStamp])  // eslint-disable-line react-hooks/exhaustive-deps
  const canEdit = !!rec?.content && (admin || item.owner_id === me)
  // v83: older reviewers get their cover picture the first time the owner (or an admin) opens them
  useEffect(() => { const u = rec?.content?.visuals?.[0]?.url; if (!u || item.thumb || !(admin || item.owner_id === me)) return; makeThumb(u).then(t => { if (t) sb.from('reviewers').update({ thumb: t }).eq('id', item.id).then(() => {}) }) }, [rec])  // eslint-disable-line react-hooks/exhaustive-deps
  // Reviewers made by AraLab are drawn from their content every time, so every design gets the current shell (dark mode, progress, print) even if it was saved long ago.
  const frameHtml = useMemo(() => rec ? prepareReviewer(rec.content ? renderReviewer(rec.content, 'studyflow', rec.theme || 'indigo') : rec.html, { dark: dark0 }) : '', [rec, dark0])
  const quiz = !!rec?.content && canChallenge(rec.content), tracked = prog.total > 0, pct = tracked ? Math.min(100, Math.round((prog.done.length / prog.total) * 100)) : 0
  const shareable = !item.removed_at && (rec ? rec.is_public !== false : item.is_public !== false)
  const restyle = async (k, v) => {
    const next = { ...rec, [k]: v, template: 'studyflow' }, html = renderReviewer(rec.content, 'studyflow', next.theme || 'indigo')
    const { error } = await sb.from('reviewers').update({ [k]: v, template: 'studyflow', html, size: new Blob([html]).size }).eq('id', item.id)
    if (error) return toast(error.message); setRec({ ...next, html }); purgeReviewer(item.id)
  }
  const togglePublic = async () => {
    const v = !rec.is_public, { error } = await sb.from('reviewers').update({ is_public: v }).eq('id', item.id)
    if (error) return toast(error.message); setRec({ ...rec, is_public: v }); purgeReviewer(item.id); reload(); toast(v ? 'Published to the library.' : 'Now private.')
  }
  const toastRef = useRef(toast); toastRef.current = toast
  const closeRef = useRef(null), focusRef = useRef(focus)
  focusRef.current = focus
  const close = async () => {
    const seconds = Math.round((Date.now() - t0.current) / 1000)
    if (seconds >= 5) await sb.from('study_log').insert({ reviewer_id: item.id, subject: item.subject, seconds: Math.min(seconds, 4 * 3600) })
    onClose()
  }
  closeRef.current = close
  useEffect(() => { const k = e => {
    if (e.key !== 'Escape' || document.querySelector('.scrim,.panel,.ch,.sheet-scrim')) return
    closeRef.current?.()
  }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [])
  return (
    <div className={focus ? 'viewer focus' : 'viewer'}>
      {focus ? <>
        <div className="focus-top">
          <button className="btn fbtn" onClick={close} aria-label="Back to the library" title="Back"><Icon name="back" size={16} /><span className="fb-lbl">Back</span></button>
          <div className="focus-mid"><b>{item.title}</b></div>
          {tracked && <span className="focus-pct" title={`${prog.done.length} of ${prog.total} parts reviewed`}>{pct}%</span>}
          <button className={starred ? 'icon-btn star on' : 'icon-btn star'} onClick={onStar} aria-pressed={starred} aria-label={starred ? 'Remove your star' : 'Star this reviewer'} title="Star"><Icon name="star" size={18} /></button>
          <button className="icon-btn" onClick={() => setMore(true)} aria-label="More reviewer actions" aria-haspopup="dialog" title="More"><Icon name="more" size={20} /></button>
        </div>
        {tracked && <div className="focus-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>}
      </> : (
        <div className="clay vbar">
          <button className="btn vback" onClick={close} aria-label="Back to the library" title="Back to the library"><Icon name="back" size={16} /><span className="vb-lbl">Back</span></button>
          <div className="vbar-title"><b>{item.title}</b>{credits}</div>
          <div className="vbar-acts">
            <button className={starred ? 'btn star on' : 'btn star'} onClick={onStar} aria-pressed={starred} title={starred ? 'Remove your star' : 'Star this reviewer'}><Icon name="star" size={15} /><span className="vb-lbl">{stars}</span></button>
            <button className="icon-btn vmore" onClick={() => setMore(true)} aria-label="More reviewer actions" aria-haspopup="dialog" title="More actions"><Icon name="more" size={20} /></button>
          </div>
        </div>
      )}
      {rec !== null && (tracked || quiz || rec.content?.sections?.length > 0) && (
        <div className="clay rv-dock">
          {tracked && (
            <div className="rv-prog">
              <div className="rv-prog-top"><b>{pct === 100 ? 'Fully reviewed' : `${pct}% reviewed`}</b><small className="mute">{prog.done.length} of {prog.total} parts</small></div>
              <div className="rv-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="How much of this reviewer you have reviewed"><i style={{ width: `${pct}%` }} /></div>
            </div>)}
          <div className="rv-acts">
            {rec.content?.sections?.length > 0 && <button type="button" className="btn pri" onClick={() => setQs(true)}><Icon name="clock" size={15} /> Study 5 min</button>}
            {quiz && <button type="button" className="btn" onClick={() => setChallenge('intro')}><Icon name="zap" size={15} /> Challenge</button>}
          </div>
        </div>)}
      {rec === null ? <p className="mute pad">Loading…</p> : <iframe ref={frameRef} title={item.title} srcDoc={frameHtml} sandbox="allow-scripts allow-modals" />}
      {more && <Sheet title="Reviewer options" onClose={() => setMore(false)}>
        <div className="sheet-list">
          {!item.removed_at && <button type="button" className="sheet-item" onClick={() => { onColl(); setMore(false) }}><Icon name={inColl ? 'check' : 'plus'} size={18} /><span>{inColl ? 'Remove from my collection' : 'Add to my collection'}</span></button>}
          {shareable && <button type="button" className="sheet-item" onClick={() => { setMore(false); shareReviewer(item, toast) }}><Icon name="share" size={18} /><span>Share reviewer</span></button>}
          {refreshWait(item, me, admin, Date.now(), astra) > 0 && <button type="button" className="sheet-item" disabled aria-disabled="true" style={{ opacity: .6 }}><Icon name="refresh" size={18} /><span>Update reviewer with AI · available in {refreshWait(item, me, admin, Date.now(), astra)} day{refreshWait(item, me, admin, Date.now(), astra) === 1 ? '' : 's'}</span></button>}
          {canRefresh(item, me, admin, Date.now(), astra) && <button type="button" className="sheet-item" onClick={() => { setMore(false); onUpdate?.(item) }}><Icon name="refresh" size={18} /><span>Update reviewer with AI</span></button>}
          {quiz && <button type="button" className="sheet-item" onClick={() => { setMore(false); setChallenge('intro') }}><Icon name="zap" size={18} /><span>Challenge a classmate</span></button>}
          {quiz && <button type="button" className="sheet-item" onClick={() => { setMore(false); setChallenge('board') }}><Icon name="award" size={18} /><span>Leaderboard</span></button>}
          {tracked && <button type="button" className="sheet-item" onClick={() => { setMore(false); frameRef.current?.contentWindow?.postMessage({ rv: 1, type: 'print' }, '*') }}><Icon name="printer" size={18} /><span>Save as PDF</span></button>}
          {item.owner_id === me && <button type="button" className="sheet-item" onClick={onToggleHide}><Icon name={hiddenName ? 'eye' : 'ghost'} size={18} /><span>{hiddenName ? 'Show my name' : 'Hide my name'}</span></button>}
          {canEdit && <label className="sheet-field"><span>Reviewer theme</span><select className="clay-in" value={rec.theme || 'indigo'} onChange={e => restyle('theme', e.target.value)} aria-label="Reviewer theme">{Object.keys(THEMES).map(k => <option key={k} value={k}>{k}</option>)}</select></label>}
          {canEdit && <button type="button" className="sheet-item" onClick={togglePublic}><Icon name={rec.is_public ? 'eye' : 'share'} size={18} /><span>{rec.is_public ? 'Make private' : 'Publish to the library'}</span></button>}
          <div className="sheet-sep" />
          <div className="sheet-meta">
            <span><Icon name="user" size={14} /> {item.visitors || 0} visitors</span>
            <span><Icon name="star" size={14} /> {stars}</span>
            {hlCount > 0 && <span><Icon name="highlighter" size={14} /> {hlCount} highlight{hlCount === 1 ? '' : 's'}</span>}
          </div>
          {item.faces?.length > 0 && <div className="sheet-faces"><VisitorFaces item={item} onOpenProfile={onOpenProfile} /><small className="mute">recent visitors</small></div>}
          <button type="button" className="sheet-item dng" onClick={() => { setMore(false); onFlag() }}><Icon name="flag" size={18} /><span>{flagged ? 'You flagged this reviewer' : 'Flag as incomplete or wrong'}</span></button>
          {(item.owner_id === me || admin) && <button type="button" className="sheet-item dng" onClick={() => { setMore(false); onDelete(item) }}><Icon name="trash" size={18} /><span>Delete reviewer</span></button>}
        </div>
      </Sheet>}
      {qs && rec?.content && <QuickStudy item={item} content={rec.content} me={me} onClose={() => setQs(false)} />}
      {challenge && <Challenge item={item} content={rec.content} startAt={challenge} shareable={shareable} toast={toast} onClose={() => setChallenge(null)} />}
    </div>
  )
}

// Bottom sheet used by the Library cards and the reader's "More" menu. One calm surface instead of a dozen tiny buttons.
function Sheet({ title, onClose, children }) {
  useEffect(() => { const k = e => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  return (
    <div className="sheet-scrim" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="clay sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-grab" aria-hidden="true" />
        <div className="sheet-head"><b>{title}</b><button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button></div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}

const readStore = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v ?? fallback } catch { return fallback } }
const writeStore = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private mode: the reader still works for this visit */ } }

// Author (unless they hid their name) + students whose accepted flag improved the reviewer.
function Credits({ item, me, admin, people, hidden, helpers = [], onOpen, size = 22, full = false }) {
  const showOwner = item.owner_id && (!hidden || item.owner_id === me || admin)
  return (
    <div className="credits">
      {item.owner_id && (showOwner
        ? <><Contributor person={people[item.owner_id]} id={item.owner_id} onOpen={onOpen} size={size} full={full} />{hidden && <small className="mute">name hidden from others</small>}</>
        : <span className="contrib anon"><Avatar person={{ display_name: 'Anonymous' }} size={size} /><span>Anonymous contributor</span></span>)}
      {helpers.length > 0 && <div className="helpers"><small className="mute">Improved by</small>
        {helpers.slice(0, 4).map(id => <button type="button" key={id} className="helper" onClick={() => onOpen?.(id)} title={`${people[id]?.display_name || 'Student'} · contribution accepted`} aria-label={`${people[id]?.display_name || 'Student'}, contribution accepted. Open profile`}><Avatar person={people[id] || { user_id: id, display_name: 'Student' }} size={22} /></button>)}
        {helpers.length > 4 && <small className="mute">+{helpers.length - 4}</small>}</div>}
    </div>
  )
}

// Small clickable attribution: the student who contributed the reviewer. Opens their profile.
function Contributor({ person, id, onOpen, size = 22, full = false }) {
  const name = person?.display_name || 'Student'
  return (
    <button type="button" className="contrib" onClick={() => onOpen?.(id)} title={`Open ${name}'s profile`} aria-label={`Open ${name}'s profile`}>
      <Avatar person={person?.user_id ? person : { user_id: id, display_name: name, ...person }} size={size} />
      <span>{name}</span>
      {full && person?.student_no && <small className="sid">{person.student_no}</small>}
    </button>
  )
}

// Recent visitors' profile circles (v50). The database sends up to 8 recent faces per reviewer.
function VisitorFaces({ item, onOpenProfile, size = 24, max = 6 }) {
  const faces = Array.isArray(item.faces) ? item.faces : []
  if (!faces.length) return null
  const shown = faces.slice(0, max)
  const extra = Math.max(0, (item.visitors || faces.length) - shown.length)
  return (
    <div className="face-row" aria-label={`${item.visitors || faces.length} students studied this reviewer`}>
      {shown.map(f => <Avatar key={f.user_id} person={f} size={size} onClick={() => onOpenProfile?.(f.user_id)} />)}
      {extra > 0 && <span className="face-more" title={`${extra} more visitor${extra === 1 ? '' : 's'}`}>+{extra > 99 ? '99+' : extra}</span>}
    </div>
  )
}

// v75: refresh an old reviewer. The server checks the 5-day rule and the owner/admin rule again, and merges ADD-ONLY,
// so this panel only has to explain what will happen and carry the student's instructions.
const addedLine = a => (a ? [['section', a.sections], ['point', a.points], ['term', a.terms], ['flashcard', a.flashcards], ['quiz question', a.quiz]]
  .filter(([, n]) => n > 0).map(([word, n]) => `${n} new ${word}${n === 1 ? '' : 's'}`).join(', ') : '')

function UpdateSheet({ item, onClose, onDone, toast }) {
  const [prompt, setPrompt] = useState(''), [busy, setBusy] = useState(false), [prog, setProg] = useState(null)
  const go = async () => {
    if (busy) return
    setBusy(true); setProg(null)
    try {
      const { data: s } = await sb.auth.getSession()
      const { ok, status, body: j } = await callAi('/api/update-reviewer', s.session?.access_token, { reviewerId: item.id, prompt: prompt.trim() }, setProg)
      if (!ok) toast(j.error || `Could not update this reviewer (${status}).`)
      else { const line = addedLine(j.added); toast(line ? `Reviewer updated: ${line}.` : 'Reviewer updated.'); onDone() }
    } catch { toast('Could not reach the server. Locally, run "vercel dev" instead of "npm run dev".') }
    setBusy(false); setProg(null)
  }
  return (
    <div className="scrim tr-scrim" onClick={e => e.target === e.currentTarget && !busy && onClose()}>
      <div className="clay modal tr-modal upd-sheet" role="dialog" aria-modal="true" aria-label={`Update ${item.title}`}>
        <div className="tr-head">
          <span className="tr-ic"><Icon name="refresh" size={18} /></span>
          <div><h3>Update “{item.title}”</h3><small className="mute">Added {new Date(item.added).toLocaleDateString()} · only new material is added</small></div>
          <button type="button" className="x" onClick={onClose} disabled={busy} aria-label="Close">×</button>
        </div>
        <p className="tr-steps as-p">The AI re-reads this reviewer and adds what is missing or clearer — new points, terms, questions and diagrams. <b>Nothing already in it is removed</b> — your classmates keep everything they studied.</p>
        <label className="lbl">What changed? <small className="mute">optional</small>
          <textarea className="clay-in tr-text" rows={4} maxLength={1200} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="e.g. Add the new chapter on cellular respiration, and a diagram of the process." disabled={busy} />
        </label>
        {busy && <AiBar p={prog} />}
        <small className="mute">Author, Astra of the author’s school or admin · after {UPDATE_AFTER_DAYS} days.</small>
        <div className="row tr-acts">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn pri" onClick={go} disabled={busy}>{busy ? 'Updating…' : <><Icon name="sparkles" size={14} /> Update with AI</>}</button>
        </div>
      </div>
    </div>
  )
}

function Modal({ modal, subjects, onClose, onSubmit }) {
  const [f, setF] = useState({ title: modal.item?.title || '', subject: modal.item?.subject || '', html: '' })
  const set = k => e => setF({ ...f, [k]: e.target.value })
  return (
    <div className="scrim" onClick={onClose}>
      <form className="clay modal" onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); onSubmit(f) }}>
        <h3>{modal.type === 'add' ? `Add ${modal.files.length} file(s)` : modal.type === 'paste' ? 'Paste HTML' : 'Edit reviewer'}</h3>
        {modal.type !== 'add' && <label>Title<input className="clay-in" value={f.title} onChange={set('title')} placeholder={modal.type === 'paste' ? 'Optional' : ''} /></label>}
        <label>Subject<SuggestInput value={f.subject} options={subjects} onChange={v => setF(x => ({ ...x, subject: v }))} placeholder="e.g. Biology" /></label>
        {modal.type === 'paste' && <label>HTML<textarea className="clay-in" rows="7" required value={f.html} onChange={set('html')} /></label>}
        <div className="row"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn pri">Save</button></div>
      </form>
    </div>
  )
}

// Students tell admins a reviewer is incomplete or wrong. One flag per student per reviewer, made of up to 5 points; every point can have files.
function FlagModal({ item, me, mine, onClose, onDone, toast }) {
  const [pts, setPts] = useState(() => { const p = pointsOf(mine); return (p.length ? p : [{ reason: 'missing_topics', note: '', files: [] }]).map(x => ({ ...x, files: [...x.files], add: [] })) })
  const [gone, setGone] = useState([]), [busy, setBusy] = useState(false)
  const [base, setBase] = useState(null), [draft, setDraft] = useState(null), [editOn, setEditOn] = useState(false), [cmp, setCmp] = useState(false)
  useEffect(() => { sb.from('reviewers').select('content').eq('id', item.id).maybeSingle().then(({ data }) => setBase(data?.content ? normalizeContent(data.content, FULL_CAPS) : null)) }, [item.id])
  const startEdit = () => { setDraft(d => d || normalizeContent(mine?.proposed || base, FULL_CAPS)); setEditOn(true) }
  const edited = !!draft && changed(base, draft)
  const set = (i, patch) => setPts(l => l.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  const dropOld = (i, f) => { if (!confirm(`Remove “${f.name}”?`)) return; set(i, { files: pts[i].files.filter(x => x.path !== f.path) }); setGone(g => [...g, f.path]) }
  const send = () => {
    if (!pts.every(p => p.note.trim() || p.add.length || p.files.length)) return toast('Each point needs a note or a file.')
    const snap = pts, removed = gone, snapDraft = edited ? draft : null, snapBase = base, label = `Sending flag for “${item.title}”`
    onClose()                                   // uploads continue in the background (progress bar at the top)
    runJob(label, async job => {
      const newCount = snap.reduce((n, p) => n + p.add.length, 0), uploaded = []
      job.total(newCount + 1)
      try {
        const out = []
        for (const p of snap) {
          const files = [...p.files]
          for (const f of p.add) {
            const path = `${me}/flags/${item.id}/${uid()}-${f.name.replace(/[^\w.\-]/g, '_')}`
            const { error } = await sb.storage.from('notes').upload(path, f, { contentType: fileType(f) })
            if (error) throw error
            uploaded.push(path); files.push({ path, name: f.name, type: fileType(f), size: f.size }); job.step()
          }
          out.push({ reason: p.reason, note: p.note.trim().slice(0, 300), files })
        }
        const { error } = await sb.from('reviewer_flags').upsert({ reviewer_id: item.id, reason: out[0].reason, note: out[0].note, points: out, resolved: false, ...(snapDraft ? { proposed: snapDraft, original: snapBase, fixed_by: 'person' } : {}) }, { onConflict: 'reviewer_id,user_id' })
        if (error) throw error
        job.step()
        if (removed.length) await sb.storage.from('notes').remove(removed)
      } catch (e) { if (uploaded.length) await sb.storage.from('notes').remove(uploaded); throw e }
    }).then(() => { toast('Flag sent. Thank you!'); onDone() }).catch(e => toast(e.message))
  }
  const unflag = async () => {
    setBusy(true)
    const { error } = await sb.from('reviewer_flags').delete().eq('id', mine.id)
    if (!error) { const paths = pointsOf(mine).flatMap(p => p.files.map(f => f.path)); if (paths.length) await sb.storage.from('notes').remove(paths) }
    setBusy(false)
    if (error) return toast(error.message)
    toast('Flag removed.'); onDone()
  }
  return (
    <div className="scrim" onClick={onClose}>
      <form className="clay modal wide-modal" onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); send() }}>
        <h3 className="h-ic"><Icon name="flag" size={18} /> Flag “{item.title}”</h3>
        <p className="mute" style={{ margin: 0 }}>Tell us what is missing or wrong. Add a point for each problem, and attach files for it (the missing notes, a photo, a PDF).</p>
        <div className="fpts">
          {pts.map((p, i) => (
            <div className="fpoint" key={i}>
              <div className="fp-head"><span className="fp-n">{i + 1}</span>
                <div className="reasons" role="radiogroup" aria-label={`Reason for point ${i + 1}`}>
                  {Object.entries(FLAG_REASONS).map(([k, label]) => <button type="button" key={k} role="radio" aria-checked={p.reason === k} className={p.reason === k ? 'reason on' : 'reason'} onClick={() => set(i, { reason: k })}>{label}</button>)}
                </div>
                {pts.length > 1 && <button type="button" className="icon-btn" aria-label={`Remove point ${i + 1}`} onClick={() => { p.files.forEach(f => setGone(g => [...g, f.path])); setPts(l => l.filter((_, j) => j !== i)) }}><Icon name="trash" size={16} /></button>}
              </div>
              <textarea className="clay-in" rows="2" maxLength={300} value={p.note} onChange={e => set(i, { note: e.target.value })} placeholder="What should be added or fixed? e.g. Chapter 4 on cellular respiration is missing" aria-label={`Details for point ${i + 1}`} />
              <FilePicker files={p.add} onChange={v => set(i, { add: v })} stored={p.files} onRemoveStored={f => dropOld(i, f)} max={MAX_FILES} maxBytes={maxFlagBytes} isOk={() => true} convert={convertFile} onError={toast} accept={ACCEPT} hint={LIMIT_HINT} />
            </div>))}
        </div>
        {base && <div className="fix-yourself">
          <button type="button" className="fix-toggle" aria-expanded={editOn} onClick={() => (editOn ? setEditOn(false) : startEdit())}>
            <Icon name="edit" size={15} /> Fix it yourself <small className="mute">(optional)</small>
            {(edited || mine?.proposed) && <span className="pill" style={{ background: '#7fc8a0' }}>edit added</span>}
            <span className="grow" /><span aria-hidden="true">{editOn ? 'Hide ▴' : 'Show ▾'}</span>
          </button>
          {editOn && <div className="fix-body">
            <p className="mute" style={{ margin: 0 }}>Edit what is wrong. Your version is sent with the flag so you, Astra and the admin can compare it with the original.</p>
            <ContentEditor value={draft} onChange={setDraft} />
            <div className="row">
              <button type="button" className="btn" onClick={() => setEditOn(false)}>Hide (keeps my edit)</button>
              {mine?.proposed && <button type="button" className="btn" onClick={() => setCmp(true)}>Compare</button>}
              <button type="button" className="btn dng" onClick={() => { setEditOn(false); setDraft(null) }}>Discard my edit</button>
            </div>
          </div>}
        </div>}
        {cmp && <CompareModal item={item} flag={mine} canAct={false} onClose={() => setCmp(false)} toast={toast} />}
        {pts.length < MAX_POINTS && <button type="button" className="btn" onClick={() => setPts(l => [...l, { reason: 'missing_topics', note: '', files: [], add: [] }])}><Icon name="plus" size={15} /> Add another point</button>}
        <small className="mute">PDF, PNG/JPG/WEBP or text · max 5 MB each · up to {MAX_FILES} files per point.</small>
        <div className="row spread modal-foot flag-foot">{mine ? <button type="button" className="btn dng" disabled={busy} onClick={unflag}>Remove my flag</button> : <span />}
          <span className="row"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn pri" disabled={busy}>{busy ? 'Sending…' : mine ? 'Update flag' : 'Send flag'}</button></span></div>
      </form>
    </div>
  )
}

// Admin: see who flagged a reviewer and why, then mark it fixed.
function FlagReview({ item, flags, onClose, onDone, onEdit, toast, reload }) {
  const [cmpFlag, setCmpFlag] = useState(null)
  const [names, setNames] = useState({}), [busy, setBusy] = useState(false), [prog, setProg] = useState(null)
  useEffect(() => { sb.from('profiles').select('user_id,display_name').in('user_id', flags.map(f => f.user_id)).then(({ data }) => setNames(Object.fromEntries((data || []).map(p => [p.user_id, p.display_name])))) }, [flags])
  const resolve = async () => {
    const { error } = await sb.from('reviewer_flags').update({ resolved: true }).eq('reviewer_id', item.id)
    if (error) return toast(error.message); toast('Marked as fixed.'); onDone()
  }
  // Use every open flag on this reviewer to correct / expand it with AI, then mark them resolved.
  const fixWithAI = async () => {
    if (!flags.length) return toast('No flag to fix.')
    setBusy(true)
    try {
      const { data: s } = await sb.auth.getSession()
      const { ok, status, body: j } = await callAi('/api/fix-reviewer', s.session.access_token, { flagId: flags[0].id }, setProg)
      if (!ok) toast(j.error || `Could not fix the reviewer (${status}).`)
      else { toast(j.fixed > 1 ? `Reviewer fixed with AI using ${j.fixed} flags.` : 'Reviewer fixed with AI.'); reload?.(); onDone() }
    } catch { toast('Could not reach the server. Locally, run "vercel dev" instead of "npm run dev".') }
    setBusy(false); setProg(null)
  }
  return (
    <div className="scrim" onClick={onClose}>
      <div className="clay modal" onClick={e => e.stopPropagation()}>
        <h3 className="h-ic"><Icon name="flag" size={18} /> {flags.length} flag{flags.length === 1 ? '' : 's'} on “{item.title}”</h3>
        <ul className="flag-list">{flags.map(f => (
          <li key={f.id}><FlagPointsView flag={f} toast={toast} /><button type="button" className="btn" onClick={() => setCmpFlag(f)}>{f.proposed ? `Compare edit (${f.fixed_by === 'ai' ? 'AI' : 'student'})` : 'Compare / draft fix'}</button><small className="mute">{names[f.user_id] || 'Student'} · {new Date(f.created_at).toLocaleDateString()}{f.astra_verdict === 'valid' && ' · checked by Astra: valid'}</small></li>
        ))}</ul>
        {busy && <AiBar p={prog} />}
        <div className="row spread">
          <span className="row"><button className="btn pri" disabled={busy} onClick={fixWithAI}><Icon name="sparkles" size={15} /> {busy ? 'Fixing…' : 'Fix with AI'}</button><button className="btn" disabled={busy} onClick={onEdit}><Icon name="edit" size={15} /> Edit reviewer</button></span>
          <span className="row"><button className="btn" onClick={onClose}>Close</button><button className="btn" disabled={busy} onClick={resolve}><Icon name="check" size={16} /> Mark as fixed</button></span>
        </div>
      </div>
      {cmpFlag && <CompareModal item={item} flag={cmpFlag} canAct onClose={() => setCmpFlag(null)} onDone={() => { setCmpFlag(null); reload?.(); onDone() }} toast={toast} />}
    </div>
  )
}

function RemoveModal({ item, toast, onClose, onDone }) {
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false)
  const ok = reason.trim().length >= 10
  const go = async () => {
    setBusy(true)
    const { error } = await sb.rpc('remove_reviewer', { _id: item.id, _reason: reason.trim() })
    setBusy(false)
    if (error) return toast(/remove_reviewer/.test(error.message) && /function/.test(error.message) ? 'Run the latest supabase-setup.sql first.' : error.message)
    toast('Removed. The student was told why.'); onDone()
  }
  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-label="Remove reviewer" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="clay modal">
        <h3>Remove “{item.title}”?</h3>
        <p className="mute" style={{ margin: 0 }}>It disappears from the Library for everyone except its owner and the admins. The student gets a notification with your reason.</p>
        <label>Why? <small className="mute">(the student will read this)</small>
          <textarea className="clay-in" rows="3" maxLength={300} autoFocus value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. The notes are not about the subject, or contain someone’s private information." />
        </label>
        <div className="row"><button className="btn" onClick={onClose}>Cancel</button><button className="btn dng" disabled={!ok || busy} onClick={go}>{busy ? 'Removing…' : 'Remove'}</button></div>
        {!ok && reason.length > 0 && <small className="mute">At least 10 characters.</small>}
      </div>
    </div>
  )
}
