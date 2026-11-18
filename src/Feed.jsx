import { useCallback, useEffect, useRef, useState } from 'react'
import { sb } from './supabase'
import Avatar from './UserAvatar'
import PostCard from './PostCard'
import Widgets from './Widgets'
import { StatsCard } from './StatsView'
import Icon, { Logo } from './Icons'
import { PostSkeleton } from './Skeleton'
import { MAX_POST, MAX_TITLE, PAGE, STAT_LAYOUTS, createPost, fetchFeed, fetchStats, subscribeFeed } from './feedApi'
import { checkDuration, checkVideo, removePostVideo, uploadPostVideo, videoDuration } from './videos'
import { MAX_IMAGES, checkImages, removePostImages, uploadPostImages } from './images'
import { mergeFirstPage, parsePostHash } from './feedLogic'
import { MentionList, useMentions } from './mentions'
import { color, fmtSize } from './lib'

const LAYOUT_ICON = { compact: 'list', rings: 'target', weekly: 'bars', subjects: 'pie' }

// Segmented "post as" switch, also used for comments
export function AsToggle({ anonymous, onChange, name }) {
  return (
    <div className="seg" role="radiogroup" aria-label="Post as">
      <button type="button" role="radio" aria-checked={!anonymous} className={!anonymous ? 'on' : ''} onClick={() => onChange(false)}><Icon name="user" size={15} /> <span className="tl">{name || 'My name'}</span></button>
      <button type="button" role="radio" aria-checked={anonymous} className={anonymous ? 'on' : ''} onClick={() => onChange(true)}><Icon name="ghost" size={15} /> <span className="tl">Anonymous</span></button>
    </div>
  )
}

function Composer({ me, person, admin, toast, onPosted }) {
  const [body, setBody] = useState(''), [share, setShare] = useState(false), [layout, setLayout] = useState('compact'), [anon, setAnon] = useState(false)
  const [preview, setPreview] = useState(undefined), [busy, setBusy] = useState(false), [pics, setPics] = useState([])   // [{ file, url }]
  // admin-only "Announcement" mode: posts as the official AraLab account (the admin stays hidden), with a headline, one video and an optional pin
  const [ann, setAnn] = useState(false), [title, setTitle] = useState(''), [video, setVideo] = useState(null), [pin, setPin] = useState(false), [step, setStep] = useState('')   // video = { file, url, secs }
  const pick = useRef(), pickVideo = useRef(), [open, setOpen] = useState(false)
  const mentions = useMentions({ text: body, setText: setBody, me })

  // when "share my stats" is on, show exactly what will be attached
  useEffect(() => {
    if (!share) return
    let live = true; setPreview(undefined)
    fetchStats(me).then(s => live && setPreview(s)).catch(e => { if (live) { setPreview(null); toast(e.message) } })
    return () => { live = false }
  }, [share, me, toast])
  useEffect(() => () => pics.forEach(p => URL.revokeObjectURL(p.url)), [])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (video) URL.revokeObjectURL(video.url) }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const addPics = e => {
    const files = [...e.target.files]; e.target.value = ''
    const bad = checkImages(files, pics.length); if (bad) return toast(bad)
    setPics(p => [...p, ...files.map(file => ({ file, url: URL.createObjectURL(file) }))])
  }
  const dropPic = i => setPics(p => { URL.revokeObjectURL(p[i].url); return p.filter((_, j) => j !== i) })
  const addVideo = async e => {
    const f = e.target.files[0]; e.target.value = ''
    if (!f) return
    const bad = checkVideo(f); if (bad) return toast(bad)
    const secs = await videoDuration(f), tooLong = checkDuration(secs); if (tooLong) return toast(tooLong)
    if (video) URL.revokeObjectURL(video.url)
    setVideo({ file: f, url: URL.createObjectURL(f), secs })
  }
  const dropVideo = () => { if (video) URL.revokeObjectURL(video.url); setVideo(null) }
  const toggleAnn = on => { setAnn(on); if (on) { setShare(false); setAnon(false) } else { setTitle(''); setPin(false); dropVideo() } }
  const empty = !body.trim() && !pics.length && (ann ? !title.trim() && !video : !share)

  const submit = async () => {
    if (busy || empty) return
    setBusy(true)
    let up = { urls: [], paths: [] }, vid = null
    try {
      if (pics.length) { setStep('Uploading photos…'); up = await uploadPostImages(me, pics.map(p => p.file)) }
      if (ann && video) { setStep('Uploading video…'); vid = await uploadPostVideo(me, video.file) }
      setStep('Publishing…')
      await createPost({ me, body, attachStats: share && !ann, statsLayout: layout, anonymous: anon, images: up.urls, announcement: ann ? { title, video: vid?.url || null, pinned: pin } : null, mentions: mentions.mentioned })
      pics.forEach(p => URL.revokeObjectURL(p.url))
      if (video) URL.revokeObjectURL(video.url)
      setBody(''); mentions.reset(); setShare(false); setPics([]); setTitle(''); setVideo(null); setPin(false); setAnn(false)
      toast(ann ? 'Announcement published.' : anon ? 'Posted anonymously.' : 'Posted.'); onPosted()
    } catch (e) { removePostImages(up.paths); if (vid) removePostVideo(vid.path); toast(e.message) }
    setStep(''); setBusy(false)
  }
  if (!open && !body && !pics.length && !video && !share && !ann) return (
    <button type="button" className="clay tile comp-slim" onClick={() => setOpen(true)} data-testid="composer">
      <Avatar person={person} size={38} /><span>Share what you’re studying…</span><span className="cs-go"><Icon name="edit" size={16} /> Post</span>
    </button>
  )
  return (
    <div className={ann ? 'clay tile composer premium' : 'clay tile composer'} data-testid="composer">
      {ann && <div className="prem-ribbon"><Icon name="megaphone" size={13} /> New announcement <span className="prem-note">Posts as AraLab. Your name stays hidden.</span></div>}
      {ann && <input className="clay-in comp-title" value={title} maxLength={MAX_TITLE} onChange={e => setTitle(e.target.value)} placeholder="Headline (optional)" aria-label="Announcement headline" />}
      <div className="comp-row">
        {ann ? <Logo size={42} /> : anon ? <div className="av ghost" style={{ width: 42, height: 42 }}><Icon name="ghost" size={22} /></div> : <Avatar person={person} size={42} />}
        <div className="mention-wrap">
          <textarea className="clay-in" autoFocus={open} rows={share || pics.length || ann ? 2 : 3} value={body} maxLength={MAX_POST} aria-label={ann ? 'Write an announcement' : 'Write a post'}
            placeholder={ann ? 'What should every student know?' : anon ? 'Ask or share something without your name on it…' : 'Share what you’re studying, ask a question, or post your progress… (type @ to mention someone)'}
            onChange={e => setBody(e.target.value)}
            onKeyDown={e => { if (mentions.onKeyDown(e)) return; if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submit() }} />
          {mentions.open && <MentionList list={mentions.list} index={mentions.index} onPick={mentions.pick} />}
        </div>
      </div>

      {pics.length > 0 && (
        <div className={`pic-strip n${pics.length}`}>
          {pics.map((p, i) => <div key={p.url} className="pic"><img src={p.url} alt={`Attachment ${i + 1}`} /><button type="button" className="pic-x" onClick={() => dropPic(i)} aria-label="Remove photo"><Icon name="x" size={14} /></button></div>)}
        </div>
      )}

      {video && (
        <div className="vid-prev">
          <video src={video.url} controls preload="metadata" playsInline />
          <div className="vid-meta"><span><Icon name="clip" size={14} /> {video.file.name} · {(video.file.size / 1048576).toFixed(1)} MB{video.secs ? ` · ${Math.round(video.secs)}s` : ''}</span><button type="button" className="btn" onClick={dropVideo}><Icon name="x" size={14} /> Remove</button></div>
        </div>
      )}

      {share && !ann && (
        <div className="comp-preview">
          <div className="lay-pick" role="radiogroup" aria-label="Stats layout">
            {Object.entries(STAT_LAYOUTS).map(([k, label]) => (
              <button type="button" key={k} role="radio" aria-checked={layout === k} className={layout === k ? 'lay on' : 'lay'} onClick={() => setLayout(k)}><Icon name={LAYOUT_ICON[k]} size={16} />{label}</button>
            ))}
          </div>
          {preview === undefined ? <small className="mute">Loading your stats…</small> : preview ? <StatsCard stats={preview} layout={layout} /> : <small className="mute">No stats to show yet.</small>}
          <small className="mute">This snapshot is attached to your post and stays as it is today.</small>
        </div>
      )}

      <div className="row spread comp-foot">
        <div className="comp-tools">
          <button type="button" className="tool" title="Add photos" aria-label="Add photos" disabled={pics.length >= MAX_IMAGES} onClick={() => pick.current.click()}><Icon name="image" size={17} /><span className="tl"> Photo</span>{pics.length > 0 && ` ${pics.length}/${MAX_IMAGES}`}</button>
          <input ref={pick} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={addPics} />
          {ann && <><button type="button" className="tool" title="Add a video" aria-label="Add a video" disabled={!!video} onClick={() => pickVideo.current.click()}><Icon name="clip" size={17} /><span className="tl"> Video</span></button>
            <input ref={pickVideo} type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.m4v,.webm,.mov" hidden onChange={addVideo} />
            <label className={pin ? 'toggle on' : 'toggle'} title="Pin to top"><input type="checkbox" aria-label="Pin to top" checked={pin} onChange={e => setPin(e.target.checked)} /><Icon name="pin" size={16} /><span className="tl"> Pin to top</span></label></>}
          {!ann && <label className={share ? 'toggle on' : 'toggle'} title="Share my stats"><input type="checkbox" aria-label="Share my stats" checked={share} onChange={e => setShare(e.target.checked)} /><Icon name="chart" size={16} /><span className="tl"> Share my stats</span></label>}
          {!ann && <AsToggle anonymous={anon} onChange={setAnon} />}
          {admin && <button type="button" className={ann ? 'tool prem-btn on' : 'tool prem-btn'} aria-pressed={ann} title="Announcement" aria-label="Announcement" onClick={() => toggleAnn(!ann)}><Icon name="megaphone" size={17} /><span className="tl"> Announcement</span></button>}
        </div>
        <span className="comp-send"><small className="mute">{body.length}/{MAX_POST}</small><button className="btn pri" disabled={busy || empty} onClick={submit}>{busy ? (step || 'Posting…') : ann ? 'Publish announcement' : 'Post'}</button></span>
      </div>
    </div>
  )
}

// "Latest reviewers" carousel: a quick, scannable shelf above the posts (tap anything to open the Library).
// It drifts to the next reviewer every few seconds, pauses while you hover / focus / touch it, and can be
// dragged, scrolled, or stepped with the arrows and dots. It only moves while the Feed is the visible tab.
const REDUCE_MOTION = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const cardOffset = (row, card) => card.getBoundingClientRect().left - row.getBoundingClientRect().left + row.scrollLeft

function ReviewerStrip({ items, me, onOpenLibrary, active = true }) {
  const list = (items || []).filter(i => !i.removed_at && (i.is_public !== false || i.owner_id === me)).slice(0, 8)
  const n = list.length
  const row = useRef(null), atRef = useRef(0), dir = useRef(1), animating = useRef(0), settle = useRef(null), hold = useRef(null)
  const [at, setAtState] = useState(0), [paused, setPaused] = useState(false)
  const setAt = useCallback(i => { atRef.current = i; setAtState(i) }, [])

  const scrollTo = useCallback((i, smooth = true) => {
    const el = row.current, card = el?.children?.[i]
    if (!el || !card) return
    animating.current = Date.now()
    el.scrollTo({ left: cardOffset(el, card), behavior: smooth && !REDUCE_MOTION() ? 'smooth' : 'auto' })
  }, [])

  const go = useCallback(i => {
    if (!n) return
    const next = ((i % n) + n) % n
    setAt(next); scrollTo(next)
  }, [n, scrollTo, setAt])

  // Step one card in the current direction. At either end, turn around and travel back the other way
  // (so the carousel bounces between the first and last card instead of jumping from the end to the start).
  const advance = useCallback(() => {
    if (n < 2) return
    let next = atRef.current + dir.current
    if (next >= n) { dir.current = -1; next = n - 2 }
    else if (next < 0) { dir.current = 1; next = 1 }
    go(next)
  }, [n, go])

  // after a hand scroll / tap, wait a moment before the carousel starts moving again
  const rest = useCallback(() => {
    clearTimeout(hold.current)
    hold.current = setTimeout(() => setPaused(false), 5000)
  }, [])

  // auto-advance only while the Feed is visible and the reader is not interacting
  useEffect(() => {
    if (!active || paused || n < 2 || REDUCE_MOTION()) return
    const id = setInterval(advance, 4200)
    return () => clearInterval(id)
  }, [active, paused, n, advance])

  // keep the dots in sync when the reader scrolls the row by hand
  const onScroll = () => {
    const el = row.current
    if (!el) return
    clearTimeout(settle.current)
    settle.current = setTimeout(() => {
      let best = 0, bestD = Infinity
      for (let i = 0; i < el.children.length; i++) {
        const d = Math.abs(cardOffset(el, el.children[i]) - el.scrollLeft)
        if (d < bestD) { bestD = d; best = i }
      }
      if (best !== atRef.current) setAt(best)
    }, 150)
    if (Date.now() - animating.current > 700) rest()   // a human is scrolling, not the carousel
  }

  useEffect(() => () => { clearTimeout(settle.current); clearTimeout(hold.current) }, [])
  useEffect(() => { if (n && atRef.current >= n) { dir.current = 1; setAt(0); scrollTo(0) } }, [n, setAt, scrollTo])   // the list shrank

  if (!n) return null
  return (
    <section className="rv-strip" aria-label="Latest reviewers" aria-roledescription="carousel">
      <div className="rv-head">
        <h3>Latest reviewers</h3>
        <span className="rv-actions">
          {n > 1 && <>
            <button type="button" className="rv-arrow" aria-label="Previous reviewer" onClick={() => go(atRef.current - 1)}><Icon name="back" size={16} /></button>
            <button type="button" className="rv-arrow" aria-label="Next reviewer" onClick={() => go(atRef.current + 1)}><Icon name="back" size={16} style={{ transform: 'rotate(180deg)' }} /></button>
          </>}
          <button className="link-btn" onClick={onOpenLibrary}>View all</button>
        </span>
      </div>
      <div className="rv-row" ref={row} onScroll={onScroll}
        onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)} onBlurCapture={() => setPaused(false)}
        onTouchStart={() => setPaused(true)} onTouchEnd={rest}
        onPointerDown={() => setPaused(true)}>
        {list.map((i, idx) => (
          <button key={i.id} className={idx === at ? 'rv-card clay is-on' : 'rv-card clay'} onClick={onOpenLibrary} aria-current={idx === at ? 'true' : undefined}>
            <span className="rv-ic" style={{ background: color(i.subject) }}><Icon name="library" size={18} /></span>
            <span className="rv-t"><b>{i.title}</b><small>{i.subject} · {fmtSize(i.size)}</small></span>
          </button>
        ))}
      </div>
      {n > 1 && <div className="rv-dots" role="tablist" aria-label="Choose a reviewer">
        {list.map((i, idx) => (
          <button key={i.id} type="button" role="tab" aria-selected={idx === at} aria-label={`Show ${i.title}`}
            className={idx === at ? 'rv-dot on' : 'rv-dot'} onClick={() => go(idx)} />
        ))}
      </div>}
    </section>
  )
}

// Daily habit card: streak, today's goal (minutes, kept on this device) and a one-tap "continue" to the last reviewer studied
function StudyCard({ me, items, onOpenLibrary }) {
  const [st, setSt] = useState(null), [last, setLast] = useState(null), [goal, setGoal] = useState(() => { try { return Number(localStorage.getItem('aralab.goalMin')) || 20 } catch { return 20 } })
  useEffect(() => {
    let live = true
    fetchStats(me).then(d => live && setSt(d)).catch(() => {})
    sb.from('study_log').select('reviewer_id').eq('user_id', me).not('reviewer_id', 'is', null).order('at', { ascending: false }).limit(1).maybeSingle().then(({ data }) => live && setLast(data?.reviewer_id || null))
    return () => { live = false }
  }, [me])
  const today = st?.days?.length ? Math.floor((st.days[st.days.length - 1].secs || 0) / 60) : 0, pct = Math.min(100, Math.round((today / goal) * 100))
  const cont = last && (items || []).find(i => i.id === last && !i.removed_at)
  const bump = d => { const g = Math.min(120, Math.max(5, goal + d)); setGoal(g); try { localStorage.setItem('aralab.goalMin', String(g)) } catch { /* private mode */ } }
  return (
    <section className="clay study-card" aria-label="Your study habit">
      <div className="sc-streak"><Icon name="flame" size={22} /><b>{st?.streak || 0}</b><small>day streak</small></div>
      <div className="sc-goal">
        <div className="row spread"><b>Today’s goal</b><span className="mute">{today} / {goal} min <button className="link-btn" aria-label="Lower goal" onClick={() => bump(-5)}>−</button><button className="link-btn" aria-label="Raise goal" onClick={() => bump(5)}>+</button></span></div>
        <div className="meter" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></div>
        <small className="mute">{pct >= 100 ? 'Goal reached. Keep your streak going tomorrow!' : st?.streak ? 'Study a bit today to keep your streak alive.' : 'Open a reviewer and study to start a streak.'}</small>
      </div>
      <button className="btn pri" onClick={onOpenLibrary}>{cont ? 'Continue studying' : 'Open Library'}</button>
      {cont && <small className="mute sc-last">Last: {cont.title}</small>}
    </section>
  )
}

export default function Feed({ me, person, admin, toast, onOpenProfile, active = true, items, onOpenLibrary }) {
  const [posts, setPosts] = useState(null), [pinned, setPinned] = useState([]), [more, setMore] = useState(false), [busyMore, setBusyMore] = useState(false)
  const [one, setOne] = useState(() => parsePostHash(location.hash)), [single, setSingle] = useState(undefined)   // single-post (shared link) view
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const loadFirst = useCallback(async () => {
    try {
      const [r, pin] = await Promise.all([fetchFeed({ me }), fetchFeed({ me, pinned: true }).catch(() => ({ posts: [] }))])   // pinned = admin announcements kept above the feed (older databases without the column just show none)
      if (!alive.current) return
      setPinned(pin.posts); setPosts(prev => mergeFirstPage(prev, r.posts, PAGE)); setMore(prev => (prev && r.posts.length >= PAGE ? prev : r.hasMore))
    }
    catch (e) { if (alive.current) { setPosts(p => p || []); toast(e.message) } }
  }, [me, toast])
  const loadSingle = useCallback(async id => {
    try { const r = await fetchFeed({ id, me }); if (alive.current) setSingle(r.posts[0] || null) } catch (e) { if (alive.current) { setSingle(null); toast(e.message) } }
  }, [me, toast])

  // The feed stays mounted when you visit another tab: it only refreshes while visible, and once more when you come back (old posts stay on screen meanwhile).
  const activeRef = useRef(active), wasActive = useRef(active)
  useEffect(() => { activeRef.current = active }, [active])
  useEffect(() => { if (active && !wasActive.current) loadFirst(); wasActive.current = active }, [active, loadFirst])
  useEffect(() => { loadFirst(); const run = () => { if (activeRef.current) loadFirst() }; const off = subscribeFeed(run); const t = setInterval(run, 60000); return () => { off(); clearInterval(t) } }, [loadFirst])   // the timer also catches anonymous posts, which realtime hides from other students
  useEffect(() => {
    const onHash = () => setOne(parsePostHash(location.hash))
    window.addEventListener('hashchange', onHash); return () => window.removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => { setSingle(undefined); if (one) loadSingle(one) }, [one, loadSingle])

  const loadMore = async () => {
    setBusyMore(true)
    try { const r = await fetchFeed({ me, before: posts[posts.length - 1].created_at }); setPosts(p => [...p, ...r.posts.filter(n => !p.some(o => o.id === n.id))]); setMore(r.hasMore) }
    catch (e) { toast(e.message) }
    setBusyMore(false)
  }
  const upd = p => { setPosts(l => l && l.map(x => (x.id === p.id ? p : x))); setPinned(l => l.map(x => (x.id === p.id ? p : x))); setSingle(s => (s && s.id === p.id ? p : s)) }
  const rm = id => { setPosts(l => l && l.filter(x => x.id !== id)); setPinned(l => l.filter(x => x.id !== id)); if (one === id) { location.hash = ''; setSingle(null) } }
  const common = { me, admin, toast, onUpdate: upd, onRemove: rm, onOpenProfile, onCreated: loadFirst }

  return (
    <div className="feed-layout">
      <div className="feed-col">
        {one ? (
          <>
            <div className="bar"><button className="btn" onClick={() => { location.hash = '' }}><Icon name="back" size={16} /> Back to feed</button></div>
            {single === undefined && <PostSkeleton count={1} />}
            {single === null && <div className="clay tile empty">This post was deleted or doesn’t exist.</div>}
            {single && <PostCard key={single.id} post={single} startOpen {...common} />}
          </>
        ) : (
          <>
            <Composer me={me} person={person} admin={admin} toast={toast} onPosted={loadFirst} />
            <details className="more feed-dash"><summary>Your streak, goals &amp; new reviewers</summary>
              <StudyCard me={me} items={items} onOpenLibrary={q => onOpenLibrary(typeof q === 'string' ? q : '')} />
              <ReviewerStrip items={items} me={me} onOpenLibrary={onOpenLibrary} active={active} />
            </details>
            {posts === null && <PostSkeleton />}
            {pinned.map(p => <PostCard key={'pin-' + p.id} post={p} {...common} />)}
            {posts?.length === 0 && !pinned.length && <div className="clay tile empty" data-testid="empty-feed">No posts yet. Be the first to share what you’re studying.</div>}
            {posts?.filter(p => !p.is_pinned).map(p => <PostCard key={p.id} post={p} {...common} />)}
            {more && <button className="btn load-more" disabled={busyMore} onClick={loadMore}>{busyMore ? 'Loading…' : 'Load older posts'}</button>}
          </>
        )}
      </div>
      <aside className="feed-rail"><Widgets admin={admin} toast={toast} /></aside>
    </div>
  )
}
