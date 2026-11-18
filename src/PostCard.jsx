import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { sb } from './supabase'
import Avatar from './UserAvatar'
import { AstraBadge, AstraCtx } from './AstraBadge'
import Icon, { Logo, ReactionIcon } from './Icons'
import { StatsCard } from './StatsView'
import {
  MAX_COMMENT, MAX_POST, REACTIONS, addComment, createPost, deleteComment, deletePost,
  fetchComments, postLink, setCommentReaction, setPinned, setReaction, updateComment, updatePost,
} from './feedApi'
import { ago, applyReaction, canDeleteComment, canDeletePost, canEditComment, canEditPost, topReactions } from './feedLogic'
import { MentionList, MentionText, useMentions } from './mentions'
import { commentTree, liveMentions } from './mentionLogic'
import { checkImages, removePostImages, uploadPostImages } from './images'
import ErrorBoundary from './ErrorBoundary'

// Avatar + name line. Anonymous authors get a ghost avatar, no link and no school.
function Who({ person, when, edited, href, onOpenProfile, size = 40 }) {
  const anon = person.anonymous, official = person.official
  return (
    <div className="who">
      {official ? <Logo size={size} />
        : anon ? <div className="av ghost" style={{ width: size, height: size }} aria-hidden="true"><Icon name="ghost" size={Math.round(size * .55)} /></div>
          : <Avatar person={person} size={size} onClick={() => onOpenProfile(person.user_id)} />}
      <div className="who-t">
        <span className="who-name">
          {official ? <><b className="anon-name">AraLab</b><span className="official-tag"><Icon name="check" size={11} /> Official</span></>
            : anon ? <b className="anon-name">{person.display_name || 'Anonymous student'}</b> : <button type="button" className="name-btn" onClick={() => onOpenProfile(person.user_id)}>{person.display_name || 'Student'}</button>}
          {!anon && !official && <AstraBadge userId={person.user_id} />}
          {(anon || official) && person.hint && <span className="hint">{person.hint}</span>}
        </span>
        <small>
          {!anon && person.school && <><span className="school"><Icon name="school" size={12} /> {person.school}</span> · </>}
          {href ? <a href={href} className="when" title={new Date(when).toLocaleString()}>{ago(when)}</a> : <span title={new Date(when).toLocaleString()}>{ago(when)}</span>}
          {edited && <span className="edited"> · edited</span>}
        </small>
      </div>
    </div>
  )
}

// Announcement video. Plays by itself, muted, while at least half of it is on screen and pauses when scrolled away;
// the viewer turns the sound on with the button (or the player's own controls). Loads only the first frame until then.
const WAVES = <><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></>
const SLASH = <><path d="m16 9 5 6" /><path d="m21 9-5 6" /></>
function PostVideo({ url }) {
  const ref = useRef(null), [muted, setMuted] = useState(true)
  useEffect(() => {
    const v = ref.current
    if (!v || typeof IntersectionObserver === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && e.intersectionRatio >= 0.5) v.play().catch(() => {})   // the browser may refuse (data saver): the player controls still work
      else v.pause()
    }, { threshold: [0, 0.5, 1] })
    io.observe(v)
    return () => io.disconnect()
  }, [url])
  const toggle = () => { const v = ref.current; if (!v) return; v.muted = !v.muted; setMuted(v.muted); if (!v.muted && v.paused) v.play().catch(() => {}) }
  return (
    <div className="post-video-wrap">
      <video ref={ref} className="post-video" src={url} controls muted playsInline preload="metadata" controlsList="nodownload" onVolumeChange={e => setMuted(e.currentTarget.muted)} />
      <button type="button" className="vid-sound" onClick={toggle} aria-pressed={!muted} aria-label={muted ? 'Turn sound on' : 'Turn sound off'}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z" />{muted ? SLASH : WAVES}</svg>
        <span>{muted ? 'Tap for sound' : 'Sound on'}</span>
      </button>
    </div>
  )
}

function Photos({ urls }) {
  const [big, setBig] = useState(null)
  useEffect(() => { if (big === null) return; const k = e => e.key === 'Escape' && setBig(null); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [big])
  if (!urls?.length) return null
  return (
    <>
      <div className={`photos n${urls.length}`} data-testid="photos">
        {urls.map((u, i) => <button type="button" key={u} className="photo" onClick={() => setBig(i)} aria-label={`Open photo ${i + 1} of ${urls.length}`}><img src={u} alt="" loading="lazy" /></button>)}
      </div>
      {big !== null && (
        <div className="scrim lightbox" onClick={() => setBig(null)} role="dialog" aria-label="Photo">
          <img src={urls[big]} alt="" onClick={e => e.stopPropagation()} />
          <button className="lb-x" onClick={() => setBig(null)} aria-label="Close"><Icon name="x" size={22} /></button>
          {urls.length > 1 && <div className="lb-nav" onClick={e => e.stopPropagation()}>
            <button className="btn" onClick={() => setBig((big + urls.length - 1) % urls.length)} aria-label="Previous photo"><Icon name="back" size={16} /></button>
            <span>{big + 1} / {urls.length}</span>
            <button className="btn" onClick={() => setBig((big + 1) % urls.length)} aria-label="Next photo"><Icon name="back" size={16} style={{ transform: 'rotate(180deg)' }} /></button>
          </div>}
        </div>
      )}
    </>
  )
}

export default function PostCard({ post, me, admin, toast, onUpdate, onRemove, onOpenProfile, onCreated, startOpen = false }) {
  const [menu, setMenu] = useState(null)                 // null | 'react' | 'share' | 'more'
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(post.body), [titleDraft, setTitleDraft] = useState(post.title || ''), [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(startOpen)             // comments visible
  const [repost, setRepost] = useState(null)              // null | note text (repost composer open)
  const [repostAnon, setRepostAnon] = useState(false)
  const own = canEditPost(post, me), mayDelete = canDeletePost(post, me, admin)
  const mySchool = useContext(AstraCtx)[me], [tb, setTb] = useState(false), [rm, setRm] = useState(false)
  // Astra: only students of their own school. Admin: any student's post (even an anonymous one, the database knows who wrote it).
  const canMod = !own && !post.is_announcement && (admin || (!!mySchool && !!post.author?.user_id && String(post.author.school || '').trim().toLowerCase() === String(mySchool).trim().toLowerCase()))
  const r = post.reactions, mine = r.mine
  const canEmpty = !!post.stats || post.is_share || !!post.images?.length || !!post.video_url || !!post.title
  const ann = !!post.is_announcement

  const react = async kind => {
    setMenu(null)
    const prev = post.reactions
    onUpdate({ ...post, reactions: applyReaction(prev, kind) })           // instant, then confirm with the server
    try { await setReaction(post.id, me, kind === prev.mine ? null : kind) }
    catch (e) { onUpdate({ ...post, reactions: prev }); toast(e.message) }
  }
  const save = async () => {
    setBusy(true)
    try {
      const mentions = liveMentions(draft, post.mentions)
      const row = await updatePost(post.id, draft, canEmpty, ann ? titleDraft : undefined, mentions)
      onUpdate({ ...post, body: row.body, title: row.title ?? post.title, edited_at: row.edited_at, mentions: row.mentions ?? mentions }); setEditing(false)
    }
    catch (e) { toast(e.message) }
    setBusy(false)
  }
  const remove = async () => {
    setMenu(null)
    if (!confirm('Delete this post? Its comments and reactions will be deleted too.')) return
    try { await deletePost(post.id, post); onRemove(post.id); toast(ann ? 'Announcement deleted.' : 'Post deleted.') } catch (e) { toast(e.message) }
  }
  const copy = async () => {
    setMenu(null)
    try { await navigator.clipboard.writeText(postLink(post.id)); toast('Link copied.') } catch { toast(postLink(post.id)) }
  }
  const togglePin = async () => {
    setMenu(null)
    try { const next = await setPinned(post.id, !post.is_pinned); onUpdate({ ...post, is_pinned: next }); onCreated?.(); toast(next ? 'Pinned to the top of the feed.' : 'Unpinned.') }
    catch (e) { toast(e.message) }
  }
  const nativeShare = async () => { setMenu(null); try { await navigator.share({ title: 'AraLab', text: post.body.slice(0, 100), url: postLink(post.id) }) } catch { /* cancelled */ } }
  const doRepost = async () => {
    setBusy(true)
    try { const row = await createPost({ me, body: repost || '', anonymous: repostAnon, sharedFrom: post.original?.id || post.id }); setRepost(null); toast('Shared to the feed.'); onCreated?.(row) }
    catch (e) { toast(e.message) }
    setBusy(false)
  }

  const shown = post.original
  return (
    <article className={ann ? 'clay post premium' : 'clay post'} data-testid="post" data-id={post.id}>
      {ann && <div className="prem-ribbon"><Icon name="megaphone" size={13} /> Announcement{post.is_pinned && <span className="prem-pin"><Icon name="pin" size={12} /> Pinned</span>}</div>}
      {tb && <TempBan post={post} admin={admin} toast={toast} onClose={() => setTb(false)} onDone={() => { setTb(false); onRemove?.(post.id) }} />}
      {rm && <RemovePost post={post} admin={admin} toast={toast} onClose={() => setRm(false)} onDone={() => { setRm(false); onRemove?.(post.id) }} />}
      {post.removed_at && <div className="removed-note" role="note">This post was removed{post.removed_reason ? `: ${post.removed_reason}` : ''}. It is hidden from other students.</div>}
      {menu && <div className="pop-scrim" onClick={() => setMenu(null)} />}
      <div className="post-top">
        <Who person={post.author} when={post.created_at} edited={!!post.edited_at} href={`#post=${post.id}`} onOpenProfile={onOpenProfile} />
        {(own || mayDelete || canMod) && (
          <div className="pop-wrap">
            <button className="icon-btn" aria-label="Post options" aria-haspopup="menu" onClick={() => setMenu(menu === 'more' ? null : 'more')}><Icon name="more" size={20} /></button>
            {menu === 'more' && (
              <div className="pop" role="menu">
                {own && <button role="menuitem" onClick={() => { setMenu(null); setDraft(post.body); setTitleDraft(post.title || ''); setEditing(true) }}><Icon name="edit" size={16} /> Edit</button>}
                {own && ann && <button role="menuitem" onClick={togglePin}><Icon name="pin" size={16} /> {post.is_pinned ? 'Unpin from top' : 'Pin to top'}</button>}
                {canMod && <button role="menuitem" className="dng" onClick={() => { setMenu(null); setTb(true) }}><Icon name="flag" size={16} /> Temporarily ban author</button>}
                {canMod && <button role="menuitem" className="dng" onClick={() => { setMenu(null); setRm(true) }}><Icon name="trash" size={16} /> Remove post (with reason)</button>}
                {mayDelete && <button role="menuitem" className="dng" onClick={remove}><Icon name="trash" size={16} /> {own ? 'Delete' : 'Delete (moderator)'}</button>}
              </div>
            )}
          </div>
        )}
      </div>

      {post.is_share && <small className="mute shared-tag"><Icon name="repeat" size={13} /> shared a post</small>}

      {editing ? (
        <div className="edit-box">
          {ann && <input className="clay-in" value={titleDraft} maxLength={120} onChange={e => setTitleDraft(e.target.value)} placeholder="Headline (optional)" aria-label="Edit headline" />}
          <textarea className="clay-in" rows={4} value={draft} maxLength={MAX_POST} onChange={e => setDraft(e.target.value)} aria-label="Edit post" autoFocus />
          <div className="row spread"><small className="mute">{draft.length}/{MAX_POST}</small>
            <span><button className="btn" onClick={() => setEditing(false)}>Cancel</button> <button className="btn pri" disabled={busy || (!draft.trim() && !canEmpty)} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></span></div>
        </div>
      ) : <>{post.title && <h3 className="post-title">{post.title}</h3>}{post.body && <p className="post-body"><MentionText text={post.body} mentions={post.mentions} onOpenProfile={onOpenProfile} /></p>}</>}

      {post.video_url && <PostVideo url={post.video_url} />}
      <Photos urls={post.images} />
      {post.stats && <StatsCard stats={post.stats} layout={post.stats_layout} />}

      {post.is_share && (shown ? (
        <div className="quoted">
          <Who person={shown.author} when={shown.created_at} edited={!!shown.edited_at} href={`#post=${shown.id}`} onOpenProfile={onOpenProfile} />
          {shown.title && <h3 className="post-title">{shown.title}</h3>}
          {shown.body && <p className="post-body"><MentionText text={shown.body} mentions={shown.mentions} onOpenProfile={onOpenProfile} /></p>}
          {shown.video_url && <PostVideo url={shown.video_url} />}
          <Photos urls={shown.images} />
          {shown.stats && <StatsCard stats={shown.stats} layout={shown.stats_layout} />}
        </div>
      ) : <div className="quoted gone">The original post was deleted.</div>)}

      {(r.total > 0 || post.commentCount > 0) && (
        <div className="counts">
          <span className="rc-list">{topReactions(r).map(([k, n]) => <span key={k} className="rc"><ReactionIcon kind={k} size={14} filled /> {n}</span>)}</span>
          {post.commentCount > 0 && <button className="link-btn" onClick={() => setOpen(!open)}>{post.commentCount} comment{post.commentCount === 1 ? '' : 's'}</button>}
        </div>
      )}

      <div className="post-acts">
        <div className="pop-wrap">
          <button className={mine ? 'act on' : 'act'} aria-label="React" aria-pressed={!!mine} onClick={() => setMenu(menu === 'react' ? null : 'react')}>
            {mine ? <ReactionIcon kind={mine} filled /> : <Icon name="thumb" size={17} />} {mine ? REACTIONS[mine] : 'React'}
          </button>
          {menu === 'react' && <div className="pop reacts" role="menu">{Object.entries(REACTIONS).map(([k, label]) => <button key={k} role="menuitem" aria-label={label} title={label} className={mine === k ? 'on' : ''} onClick={() => react(k)}><ReactionIcon kind={k} size={22} filled={mine === k} /></button>)}</div>}
        </div>
        <button className={open ? 'act on' : 'act'} aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="message" size={17} /> Comment</button>
        <div className="pop-wrap">
          <button className="act" aria-haspopup="menu" onClick={() => setMenu(menu === 'share' ? null : 'share')}><Icon name="share" size={17} /> Share</button>
          {menu === 'share' && (
            <div className="pop" role="menu">
              <button role="menuitem" onClick={() => { setMenu(null); setRepost('') }}><Icon name="repeat" size={16} /> Share to feed</button>
              <button role="menuitem" onClick={copy}><Icon name="link" size={16} /> Copy link</button>
              {typeof navigator !== 'undefined' && navigator.share && <button role="menuitem" onClick={nativeShare}><Icon name="send" size={16} /> Share to…</button>}
            </div>
          )}
        </div>
      </div>

      {repost !== null && (
        <div className="edit-box">
          <textarea className="clay-in" rows={2} value={repost} maxLength={MAX_POST} onChange={e => setRepost(e.target.value)} placeholder="Add a note (optional)…" aria-label="Repost note" autoFocus />
          <div className="row spread"><AsToggle2 anonymous={repostAnon} onChange={setRepostAnon} /><span className="row"><button className="btn" onClick={() => setRepost(null)}>Cancel</button><button className="btn pri" disabled={busy} onClick={doRepost}>{busy ? 'Sharing…' : 'Share'}</button></span></div>
        </div>
      )}

      {open && <ErrorBoundary compact><Comments post={post} me={me} admin={admin} toast={toast} onOpenProfile={onOpenProfile} onCount={n => onUpdate({ ...post, commentCount: n })} /></ErrorBoundary>}
    </article>
  )
}

// tiny two-state switch used for reposts and comments
function AsToggle2({ anonymous, onChange, compact = false }) {
  const tip = anonymous ? 'Anonymous: your name is hidden. Tap to show your name.' : 'Your name is shown. Tap to comment anonymously.'
  return (
    <button type="button" className={`${anonymous ? 'toggle on' : 'toggle'}${compact ? ' icon' : ''}`} aria-pressed={anonymous} aria-label={anonymous ? 'Anonymous (tap to show your name)' : 'With my name (tap to go anonymous)'} onClick={() => onChange(!anonymous)} title={tip}>
      <Icon name={anonymous ? 'ghost' : 'user'} size={compact ? 18 : 15} />{!compact && (anonymous ? ' Anonymous' : ' With my name')}
    </button>
  )
}

function Comments({ post, me, admin, toast, onOpenProfile, onCount }) {
  const [list, setList] = useState(null)
  const countRef = useRef(onCount); countRef.current = onCount

  // comments come back flat; commentTree() makes one level of replies, like Facebook
  const apply = useCallback(rows => { setList(rows); countRef.current(rows.length) }, [])
  const load = useCallback(async () => {
    try { const rows = await fetchComments(post.id, me); apply(rows) }
    catch (e) { apply([]); toast(e.message) }
  }, [post.id, me, toast, apply])

  useEffect(() => {
    let live = true
    fetchComments(post.id, me).then(rows => { if (live) apply(rows) }).catch(e => { if (live) { apply([]); toast(e.message) } })
    return () => { live = false }
  }, [post.id, me, toast, apply])

  const patch = useCallback((id, p) => setList(l => (l || []).map(c => (c.id === id ? { ...c, ...p } : c))), [])
  const remove = useCallback(id => setList(l => {
    const next = (l || []).filter(c => c.id !== id && c.parent_id !== id)   // deleting a thread removes its replies too
    countRef.current(next.length)
    return next
  }), [])

  const tree = commentTree(list || [])
  return (
    <div className="comments" data-testid="comments">
      {list === null && <small className="mute">Loading comments…</small>}
      {list?.length === 0 && <small className="mute">No comments yet. Be the first.</small>}
      {tree.map(c => (
        <div className="c-thread" key={c.id}>
          <CommentRow c={c} post={post} me={me} admin={admin} toast={toast} onOpenProfile={onOpenProfile} onPatch={patch} onRemove={remove} onReload={load} />
          {c.replies?.length > 0 && <div className="c-replies">
            {c.replies.map(r => <CommentRow key={r.id} c={r} reply post={post} me={me} admin={admin} toast={toast} onOpenProfile={onOpenProfile} onPatch={patch} onRemove={remove} onReload={load} />)}
          </div>}
        </div>
      ))}
      <CommentComposer post={post} me={me} toast={toast} onSent={load} />
    </div>
  )
}

// One comment (or reply): body with @mentions, reaction chips, reply / edit / delete.
function CommentRow({ c, post, me, admin, toast, onOpenProfile, onPatch, onRemove, onReload, reply = false }) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(''), [busy, setBusy] = useState(false), [replying, setReplying] = useState(false)

  const saveEdit = async () => {
    if (!draft.trim() || busy) return
    setBusy(true)
    try {
      const mentions = liveMentions(draft, c.mentions)
      const row = await updateComment(c.id, draft, mentions)
      onPatch(c.id, { body: row.body, edited_at: row.edited_at, mentions: row.mentions ?? mentions }); setEditing(false)
    } catch (e) { toast(e.message) }
    setBusy(false)
  }
  const del = async () => {
    if (!confirm(reply ? 'Delete this reply?' : 'Delete this comment and its replies?')) return
    try { await deleteComment(c.id); onRemove(c.id); onReload?.() } catch (e) { toast(e.message) }
  }

  const name = c.author?.display_name || 'Student'
  return (
    <div className={reply ? 'comment reply' : 'comment'} data-testid="comment">
      {c.author.anonymous
        ? <div className="av ghost" style={{ width: 30, height: 30 }} aria-hidden="true"><Icon name="ghost" size={16} /></div>
        : <Avatar person={c.author} size={30} onClick={() => onOpenProfile(c.author.user_id)} />}
      <div className="c-body">
        <div className="c-bubble">
          <span className="who-name">
            {c.author.anonymous ? <b className="anon-name sm">{name}</b> : <button type="button" className="name-btn sm" onClick={() => onOpenProfile(c.author.user_id)}>{name}</button>}{!c.author.anonymous && <AstraBadge userId={c.author.user_id} />}
            {c.author.anonymous && c.author.hint && <span className="hint">{c.author.hint}</span>}
          </span>
          {editing ? (
            <div className="edit-box">
              <textarea className="clay-in" rows={2} value={draft} maxLength={MAX_COMMENT} onChange={e => setDraft(e.target.value)} aria-label="Edit comment" autoFocus />
              <div className="row"><button className="btn" onClick={() => setEditing(false)}>Cancel</button><button className="btn pri" disabled={busy || !draft.trim()} onClick={saveEdit}>{busy ? 'Saving…' : 'Save'}</button></div>
            </div>
          ) : <><p><MentionText text={c.body} mentions={c.mentions} onOpenProfile={onOpenProfile} /></p>{c.images?.length > 0 && <Photos urls={c.images} />}</>}
        </div>
        <div className="c-foot">
          <small className="mute">{ago(c.created_at)}{c.edited_at && ' · edited'}</small>
          <CommentReactions c={c} me={me} toast={toast} onChange={r => onPatch(c.id, { reactions: r })} />
          {!editing && <button type="button" className="link-btn" onClick={() => setReplying(v => !v)}>{replying ? 'Cancel' : 'Reply'}</button>}
          {!editing && canEditComment(c, me) && <button type="button" className="link-btn" onClick={() => { setEditing(true); setDraft(c.body) }}>Edit</button>}
          {canDeleteComment(c, post, me, admin) && <button type="button" className="link-btn dng" onClick={del}>Delete</button>}
        </div>
        {replying && <CommentComposer post={post} me={me} toast={toast} parentId={c.id} replyTo={name} compact autoFocus onSent={() => { setReplying(false); onReload() }} />}
      </div>
    </div>
  )
}

// Reaction summary + picker for one comment.
function CommentReactions({ c, me, toast, onChange }) {
  const [open, setOpen] = useState(false)
  const r = c.reactions || { counts: {}, mine: null, total: 0 }
  const react = async kind => {
    setOpen(false)
    const next = applyReaction(r, kind)
    onChange(next)
    try { await setCommentReaction(c.id, me, next.mine) }
    catch (e) { onChange(r); toast(e.message) }
  }
  return (
    <span className="c-react">
      {r.total > 0 && <span className="c-reacts" aria-label={`${r.total} reaction${r.total === 1 ? '' : 's'}`}>
        {topReactions(r, 2).map(([k, n]) => <span key={k} className="c-react-chip" title={REACTIONS[k]}><ReactionIcon kind={k} size={12} filled /> {n}</span>)}
      </span>}
      <span className="pop-wrap">
        <button type="button" className={r.mine ? 'link-btn on' : 'link-btn'} aria-pressed={!!r.mine} onClick={() => setOpen(o => !o)}>{r.mine ? REACTIONS[r.mine] : 'React'}</button>
        {open && <div className="pop reacts c-pop" role="menu">
          {Object.entries(REACTIONS).map(([k, label]) => (
            <button key={k} type="button" role="menuitem" aria-label={`React ${label}`} title={label} className={r.mine === k ? 'on' : ''} onClick={() => react(k)}><ReactionIcon kind={k} size={18} filled={r.mine === k} /></button>
          ))}
        </div>}
      </span>
    </span>
  )
}

// Comment box used both for new comments and for replies. Typing "@" opens a student picker.
function CommentComposer({ post, me, toast, parentId = null, replyTo = '', compact = false, autoFocus = false, onSent }) {
  const [text, setText] = useState(''), [anon, setAnon] = useState(false), [busy, setBusy] = useState(false), [pics, setPics] = useState([])
  const box = useRef(null), pick = useRef(null)
  const mentions = useMentions({ text, setText, me })
  const grow = el => { if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 104) + 'px' }   // grows with the text, up to ~4 lines

  useEffect(() => { if (!text) grow(box.current) }, [text])
  useEffect(() => { if (autoFocus) box.current?.focus() }, [autoFocus])

  const send = async () => {
    if ((!text.trim() && !pics.length) || busy) return
    setBusy(true)
    let uploaded = null
    try {
      if (pics.length) uploaded = await uploadPostImages(me, pics)
      await addComment(post.id, me, text, anon, parentId, mentions.mentioned, uploaded?.urls || [])
      setText(''); setPics([]); mentions.reset(); grow(box.current)
      onSent?.()
    } catch (e) { if (uploaded?.paths) removePostImages(uploaded.paths)?.catch?.(() => {}); toast(e.message) }
    setBusy(false)
  }
  const placeholder = replyTo ? `Reply to ${replyTo}…` : anon ? 'Comment anonymously…' : 'Write a comment…'
  const addPics = e => { const files = [...e.target.files]; e.target.value = ''; const bad = checkImages(files, pics.length); if (bad) return toast(bad); setPics(p => [...p, ...files]) }
  return (
    <div className={compact ? 'c-new reply-new' : 'c-new'}>
      <div className="mention-wrap">
        <textarea ref={box} rows={1} className="clay-in" value={text} maxLength={MAX_COMMENT} placeholder={placeholder} aria-label={replyTo ? `Reply to ${replyTo}` : 'Write a comment'} enterKeyHint="send"
          onChange={e => { setText(e.target.value); grow(e.target) }}
          onKeyDown={e => { if (mentions.onKeyDown(e)) return; if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
        {mentions.open && <MentionList list={mentions.list} index={mentions.index} onPick={mentions.pick} />}
      </div>
      <AsToggle2 anonymous={anon} onChange={setAnon} compact />
      <button type="button" className="icon-btn c-photo" title="Add photos" aria-label="Add photos" disabled={busy || pics.length >= 4} onClick={() => pick.current.click()}><Icon name="image" size={17} /></button>
      <input ref={pick} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={addPics} />
      <button className="btn pri" disabled={busy || (!text.trim() && !pics.length)} onClick={send} aria-label={replyTo ? 'Send reply' : 'Send comment'}><Icon name="send" size={16} /></button>
      {pics.length > 0 && <div className="c-pics">{pics.map((p, i) => <span key={`${p.name}-${i}`}>{p.name}<button type="button" onClick={() => setPics(x => x.filter((_, n) => n !== i))} aria-label={`Remove ${p.name}`}>×</button></span>)}</div>}
    </div>
  )
}

// Astra: temporarily ban the author of this post. The admin reviews it and keeps, escalates or lifts it.
function TempBan({ post, admin, toast, onClose, onDone }) {
  const [days, setDays] = useState(3), [reason, setReason] = useState(''), [busy, setBusy] = useState(false)
  const send = async e => {
    e.preventDefault()
    if (reason.trim().length < 20) return toast('Explain the reason (at least 20 characters).')
    setBusy(true)
    const { error } = await sb.rpc('astra_temp_ban', { _post: post.id, _days: days, _reason: reason.trim() })
    setBusy(false)
    if (error) return toast(error.message)
    toast(`Student banned for ${days} day${days === 1 ? '' : 's'} and the post was removed.${admin ? '' : ' The admin will review it.'}`); onDone()
  }
  return (
    <div className="scrim" onClick={onClose}>
      <form className="clay modal" onClick={e => e.stopPropagation()} onSubmit={send}>
        <h3>Temporarily ban this student</h3>
        <p className="mute" style={{ margin: 0 }}>They cannot use the app until the ban ends. The post is removed too and attached as evidence. {admin ? 'As admin your decision stands right away. You can lift it any time from Moderation > Ban reports.' : 'The admin decides if it is right (the post comes back if not) or a full ban.'}</p>
        <label>Length<select className="clay-in" value={days} onChange={e => setDays(Number(e.target.value))}><option value={1}>1 day</option><option value={3}>3 days</option><option value={7}>7 days</option></select></label>
        <label>Why<textarea className="clay-in" rows="3" maxLength={1500} value={reason} onChange={e => setReason(e.target.value)} placeholder="What is wrong with this post?" /></label>
        <div className="row"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn dng" disabled={busy}>{busy ? 'Banning…' : 'Ban temporarily'}</button></div>
      </form>
    </div>
  )
}

// Astra: remove a post with a reason. It is hidden at once; the admin keeps it removed, restores it or deletes it.
function RemovePost({ post, admin, toast, onClose, onDone }) {
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false)
  const send = async e => {
    e.preventDefault()
    if (reason.trim().length < 20) return toast('Explain the reason (at least 20 characters).')
    setBusy(true)
    const { error } = await sb.rpc('astra_remove_post', { _post: post.id, _reason: reason.trim() })
    setBusy(false)
    if (error) return toast(error.message)
    toast(admin ? 'Post removed.' : 'Post removed. The admin will review it.'); onDone()
  }
  return (
    <div className="scrim" onClick={onClose}>
      <form className="clay modal" onClick={e => e.stopPropagation()} onSubmit={send}>
        <h3>Remove this post</h3>
        <p className="mute" style={{ margin: 0 }}>It is hidden from other students right away. The author sees your reason.{admin ? ' You can restore it or delete it for good from Moderation > Removed posts.' : ' The admin decides to keep it removed, restore it, or delete it.'}</p>
        <label>Why<textarea className="clay-in" rows="3" maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="What rule does this post break?" /></label>
        <div className="row"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn dng" disabled={busy}>{busy ? 'Removing…' : 'Remove post'}</button></div>
      </form>
    </div>
  )
}
