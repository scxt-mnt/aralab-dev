import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sb } from './supabase'
import { color } from './lib'
import { checkPhoto, uploadAvatar, uploadBlob } from './avatar'
import PhotoCropper from './PhotoCropper'
import { useUniversities, normSchool, isUniversity, PICK_UNI } from './schools'
import SchoolInput from './SchoolInput'
import SuggestInput from './SuggestInput'
import { useProfileOptions } from './fieldOptions'
import { ActiveLabel, activeHidden, setActiveHidden } from './presence'
import { BIO_MAX, PROGRAM_REQUIRED, normProgram, normBio } from './programs'
import { AstraBadge } from './AstraBadge'
import Icon from './Icons'
import CopyButton from './CopyButton'
import { fetchFeed, fetchStats, fetchContributions } from './feedApi'
import PostCard from './PostCard'
import FollowBar from './Follow'
import StatsView, { ContributionsView } from './StatsView'

// Profile panel. viewId === own id: editable. Otherwise: that student's public profile (stats only if they allow it).
export default function Profile({ viewId, user, avatar, admin, profile, items, theme, setTheme, onSaved, onClose, toast, onOpenProfile, onOpenReviewer = () => {} }) {
  const unis = useUniversities(), fo = useProfileOptions()
  const mine = viewId === user.id
  const [other, setOther] = useState(null), [stats, setStats] = useState(undefined), [contrib, setContrib] = useState(undefined), [posts, setPosts] = useState(null), [more, setMore] = useState(false)
  const [name, setName] = useState(profile.display_name || ''), [goal, setGoal] = useState(profile.weekly_goal || 5), [showStats, setShowStats] = useState(profile.show_stats !== false), [showContrib, setShowContrib] = useState(profile.show_contributions !== false), [emailMs, setEmailMs] = useState(true), [school, setSchool] = useState(profile.school || '')
  const [program, setProgram] = useState(profile.program || ''), [institute, setInstitute] = useState(profile.institute || ''), [bio, setBio] = useState(profile.bio || '')
  const [photo, setPhoto] = useState(null), [preview, setPreview] = useState(avatar || ''), [saving, setSaving] = useState(false), [log, setLog] = useState([]), pick = useRef()

  const person = mine ? { user_id: user.id, display_name: name || user.user_metadata?.full_name || user.email, avatar_url: preview } : other
  const shown = person?.display_name || (mine ? user.email : 'Student')
  const sid = mine ? profile.student_no : person?.student_no

  useEffect(() => {
    let live = true
    setStats(undefined); setContrib(undefined); setPosts(null)
    if (!mine) (async () => {
      let r = await sb.from('profiles').select('user_id,display_name,avatar_url,show_stats,school,student_no,bio,program,institute').eq('user_id', viewId).maybeSingle()
      if (r.error) r = await sb.from('profiles').select('user_id,display_name,avatar_url,show_stats,school,student_no').eq('user_id', viewId).maybeSingle()   // database not upgraded yet
      if (!live) return
      if (r.error) toast('Could not load this profile: ' + r.error.message + ' (re-run supabase-setup.sql)')
      setOther(r.data || { user_id: viewId, display_name: 'Former student' })
    })()
    fetchStats(viewId).then(s => live && setStats(s)).catch(e => { if (live) { setStats(null); toast(e.message) } })
    fetchContributions(viewId).then(c => live && setContrib(c)).catch(e => { if (live) { setContrib(null); toast(e.message) } })
    fetchFeed({ authorId: viewId, me: user.id }).then(r => { if (live) { setPosts(r.posts); setMore(r.hasMore) } }).catch(e => { if (live) { setPosts([]); toast(e.message) } })
    if (mine) sb.from('study_log').select('reviewer_id,subject,at').order('at', { ascending: false }).limit(200).then(({ data }) => live && setLog(data || []))
    return () => { live = false }
  }, [viewId, mine, user.id, toast])

  const loadMore = useCallback(async () => {
    try { const r = await fetchFeed({ authorId: viewId, me: user.id, before: posts[posts.length - 1].created_at }); setPosts(p => [...p, ...r.posts]); setMore(r.hasMore) } catch (e) { toast(e.message) }
  }, [posts, viewId, user.id, toast])

  const recent = (() => { const seen = new Set(), out = []; for (const r of log) { if (seen.has(r.reviewer_id)) continue; seen.add(r.reviewer_id); const it = items.find(i => i.id === r.reviewer_id); if (it) out.push({ ...it, at: r.at }); if (out.length === 5) break } return out })()

  useEffect(() => { if (viewId === user.id) sb.from('profiles').select('email_milestones').eq('user_id', user.id).maybeSingle().then(({ data }) => { if (data && data.email_milestones === false) setEmailMs(false) }) }, [viewId, user.id])
  const save = async () => {
    if (normSchool(school) && !isUniversity(school)) return toast(PICK_UNI)
    if (normProgram(program).length < 2) return toast(PROGRAM_REQUIRED)
    setSaving(true)
    const row = { user_id: user.id, display_name: name.trim(), weekly_goal: Number(goal), show_stats: showStats, show_contributions: showContrib, school: normSchool(school), program: normProgram(program), institute: normProgram(institute), bio: normBio(bio) }
    try { if (photo) row.avatar_url = await uploadAvatar(user.id, photo) } catch (e) { setSaving(false); return toast(e.message) }
    const { error } = await sb.from('profiles').upsert(row)
    setSaving(false)
    if (error) return toast(/program|institute|bio|schema cache/i.test(error.message) ? 'The database is out of date. Ask the admin to re-run supabase-setup.sql.' : error.message)
    await sb.from('profiles').update({ email_milestones: emailMs }).eq('user_id', user.id)   // v48 column: ignored until the v48 SQL is run
    onSaved(row); toast('Profile saved.'); setShowSettings(false)
  }
  const [fc, setFc] = useState(null), [hid, setHid] = useState(() => new Set()), [delOpen, setDelOpen] = useState(false), [delText, setDelText] = useState(''), [delBusy, setDelBusy] = useState(false)
  useEffect(() => { sb.from('follows').select('*', { count: 'exact', head: true }).eq('followee', viewId).then(({ count }) => setFc(count ?? 0)) }, [viewId])
  useEffect(() => { if (mine) return; sb.from('reviewers').select('id').eq('owner_id', viewId).eq('hide_author', true).then(({ data }) => setHid(new Set((data || []).map(r => r.id)))) }, [viewId, mine])
  // v81: the reviewers this student made or uploaded (anyone who chose "Hide my name" stays off a public profile)
  const work = useMemo(() => items.filter(i => i.owner_id === viewId && !i.removed_at && (mine || (i.is_public !== false && !hid.has(i.id)))).sort((a, b) => (b.added || 0) - (a.added || 0)), [items, viewId, mine, hid])
  const deleteAccount = async () => {
    setDelBusy(true)
    const { error } = await sb.rpc('delete_my_account')
    if (error) { setDelBusy(false); return toast(/function|schema cache/i.test(error.message) ? 'Account deletion is not set up yet. Ask the admin to re-run supabase-setup.sql.' : error.message) }
    await sb.auth.signOut(); location.href = '/'
  }
  const [crop, setCrop] = useState(null), [cover, setCover] = useState(''), [showSettings, setShowSettings] = useState(false), [ah, setAh] = useState(() => activeHidden()), [photoBusy, setPhotoBusy] = useState(false), pickAv = useRef(), pickCv = useRef()
  useEffect(() => { sb.from('profiles').select('cover_url').eq('user_id', viewId).maybeSingle().then(({ data }) => setCover(data?.cover_url || '')) }, [viewId])
  const chooseFor = kind => e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; const bad = checkPhoto(f); if (bad) return toast(bad); setCrop({ file: f, kind }) }
  const applyPhoto = async (kind, blob) => {
    setCrop(null); setPhotoBusy(true)
    try {
      const url = await uploadBlob(user.id, blob, kind)
      const col = kind === 'cover' ? 'cover_url' : 'avatar_url'
      const { error } = await sb.from('profiles').update({ [col]: url }).eq('user_id', user.id)
      if (error) throw error
      if (kind === 'cover') setCover(url); else { setPreview(url); onSaved({ avatar_url: url }) }
      toast(kind === 'cover' ? 'Cover photo updated.' : 'Profile photo updated.')
    } catch (e) { toast(/cover_url|schema cache/i.test(e.message || '') ? 'The database is out of date. Ask the admin to re-run supabase-setup.sql.' : e.message) }
    setPhotoBusy(false)
  }
  const removeCover = async () => { const { error } = await sb.from('profiles').update({ cover_url: null }).eq('user_id', user.id); if (error) return toast(error.message); setCover(''); toast('Cover photo removed.') }
  const postProps = { me: user.id, admin, toast, onOpenProfile: id => { if (id !== viewId) onOpenProfile(id) }, onUpdate: p => setPosts(l => l.map(x => (x.id === p.id ? p : x))), onRemove: id => setPosts(l => l.filter(x => x.id !== id)) }

  const avatarSrc = mine ? preview : person?.avatar_url
  const initial = shown[0]?.toUpperCase()
  return (
    <>
      <div className="scrim prof-scrim" style={{ background: 'rgba(70,80,120,.25)', zIndex: 34 }} onClick={onClose} />
      <aside className="panel wide pf" role="dialog" aria-label="Profile" data-testid="profile">
        <input ref={pickAv} type="file" accept="image/*" hidden onChange={chooseFor('avatar')} />
        <input ref={pickCv} type="file" accept="image/*" hidden onChange={chooseFor('cover')} />
        <div className="pf-banner" style={{ '--c1': color(shown), '--c2': color(shown + '~'), backgroundImage: cover ? `url(${cover})` : undefined }}>
          <div className="pf-top">
            {mine && <button type="button" className="pf-ib" onClick={() => sb.auth.signOut()} aria-label="Sign out" title="Sign out"><Icon name="logout" size={19} /></button>}
            {mine && <button type="button" className="pf-ib" onClick={() => setShowSettings(true)} aria-label="Settings"><Icon name="sliders" size={19} /></button>}
            <button type="button" className="pf-ib" onClick={onClose} aria-label="Close"><Icon name="x" size={19} /></button>
          </div>
        </div>
        <div className="pf-body">
          {mine
            ? <button type="button" className="pf-av" onClick={() => pickAv.current.click()} aria-label="Change profile photo" disabled={photoBusy}>{avatarSrc ? <img src={avatarSrc} alt="" referrerPolicy="no-referrer" /> : <span>{initial}</span>}</button>
            : <div className="pf-av">{avatarSrc ? <img src={avatarSrc} alt="" referrerPolicy="no-referrer" /> : <span>{initial}</span>}</div>}
          <h3 className="pf-name">{shown}<AstraBadge userId={viewId} full />{mine && admin && <span className="badge">Admin</span>}</h3>
          {([(mine ? school : person?.school), (mine ? program : person?.program)].filter(Boolean).join(' · ')) && <p className="pf-meta">{[(mine ? school : person?.school), (mine ? program : person?.program)].filter(Boolean).join(' · ')}</p>}
          <ActiveLabel id={viewId} />
          {(mine ? normBio(bio) : person?.bio) && <p className="pf-bio" data-testid="bio">{mine ? normBio(bio) : person.bio}</p>}
          <FollowBar me={user.id} viewId={viewId} toast={toast} extra={<><span><b>{work.length}</b> Reviewers</span><span><b>{posts ? `${posts.length}${more ? '+' : ''}` : '–'}</b> Posts</span></>} />
          <h4 className="pf-h">{mine ? 'My work' : 'Work'}</h4>
          {work.length === 0 && <p className="mute pf-empty">{mine ? 'Reviewers you make or upload show up here.' : 'No reviewers shared yet.'}</p>}
          <div className="pf-grid">{work.map(i => (
            <button type="button" key={i.id} className="pf-tile" style={{ '--c': color(i.subject) }} onClick={() => onOpenReviewer(i.id)} aria-label={`Open ${i.title}`}>
              <b>{i.title}</b><small>{i.subject}</small>
            </button>))}</div>
        <details className="more pf-more"><summary>Study stats</summary>
        {stats === undefined && <p className="mute">Loading stats…</p>}
        {stats === null && <p className="mute" data-testid="stats-private">{mine ? 'No stats yet. Open a reviewer and your study time shows up here.' : `${shown} keeps their stats private.`}</p>}
        {stats && <>
          <StatsView stats={stats} />
          {stats.top_subject && <small className="mute">Most studied subject: <b style={{ color: color(stats.top_subject) }}>{stats.top_subject}</b></small>}
        </>}

        </details>
        <details className="more pf-more"><summary>Contributions &amp; points</summary>
        {contrib === undefined && <p className="mute">Loading contributions…</p>}
        {contrib === null && <p className="mute" data-testid="contrib-private">{mine ? 'No contributions yet. Contribute a reviewer or flag one that gets accepted.' : `${shown} keeps their contributions private.`}</p>}
        {contrib && <ContributionsView c={contrib} />}

        </details>
        <section className="pcard">
        <h4 className="pf-h">{mine ? 'My posts' : 'Posts'}</h4>
        {posts === null && <p className="mute">Loading posts…</p>}
        {posts?.length === 0 && <p className="mute">No posts yet.</p>}
        <div className="profile-posts">{posts?.map(p => <PostCard key={p.id} post={p} {...postProps} />)}</div>
        {more && <button className="btn" onClick={loadMore}>Load older posts</button>}
        </section>
          {mine && <button type="button" className="pf-signout" onClick={() => sb.auth.signOut()}><Icon name="logout" size={18} /> Sign out</button>}
        </div>

        {crop && <PhotoCropper file={crop.file} shape={crop.kind === 'cover' ? 'wide' : 'circle'} onCancel={() => setCrop(null)} onDone={b => applyPhoto(crop.kind, b)} />}

        {mine && showSettings && (
          <div className="pfs" role="dialog" aria-label="Settings">
            <header className="pfs-head"><button type="button" className="pf-ib" onClick={() => setShowSettings(false)} aria-label="Back"><Icon name="back" size={19} /></button><h3>Settings</h3></header>
            <div className="pfs-body">
              <section className="pfs-card"><h4>Photos</h4>
                <div className="pfs-photos">
                  <div className="pfs-ph"><span className="pf-av sm">{preview ? <img src={preview} alt="" referrerPolicy="no-referrer" /> : <span>{initial}</span>}</span><button type="button" className="btn" disabled={photoBusy} onClick={() => pickAv.current.click()}>Profile photo</button></div>
                  <div className="pfs-ph"><span className="pfs-cv" style={{ backgroundImage: cover ? `url(${cover})` : undefined }} /><button type="button" className="btn" disabled={photoBusy} onClick={() => pickCv.current.click()}>Cover photo</button>{cover && <button type="button" className="pfs-link" onClick={removeCover}>Remove</button>}</div>
                </div>
              </section>
              <section className="pfs-card"><h4>Profile</h4>
                <label>Display name<input className="clay-in" value={name} onChange={e => setName(e.target.value)} placeholder={user.user_metadata?.full_name || 'Your name'} maxLength={40} /></label>
                <label>Bio <small className="mute">{bio.length}/{BIO_MAX}</small><textarea className="clay-in" rows="3" value={bio} maxLength={BIO_MAX} onChange={e => setBio(e.target.value)} placeholder="A line about you" /></label>
                <label>University<SchoolInput value={school} maxLength={80} options={unis} onChange={setSchool} placeholder="Type your university, e.g. PUP or Bulacan State" /></label>
                <label>Program <b className="req">*</b><SuggestInput value={program} onChange={setProgram} options={fo.programs} maxLength={100} placeholder="e.g. BS Information Technology" /></label>
                <label>College / Institute <small className="mute">optional</small><SuggestInput value={institute} onChange={setInstitute} options={fo.institutes} maxLength={100} placeholder="e.g. College of Education" /></label>
              </section>
              <section className="pfs-card"><h4>Study</h4>
                <label>Weekly study goal: <b>{goal}h</b><input type="range" min="1" max="40" value={goal} onChange={e => setGoal(e.target.value)} /></label>
                {recent.length > 0 && <><small className="mute">Recently studied</small><ul className="recent">{recent.map(r => <li key={r.id}><i style={{ background: color(r.subject) }} /><span>{r.title}</span><small>{new Date(r.at).toLocaleDateString()}</small></li>)}</ul></>}
              </section>
              <section className="pfs-card"><h4>Privacy</h4>
                <label className="pfs-sw"><span>Hide my “Active now” status</span><input type="checkbox" role="switch" checked={ah} onChange={e => { setAh(e.target.checked); setActiveHidden(e.target.checked) }} /><i aria-hidden="true" /></label>
                <label className="pfs-sw"><span>Let other students see my stats</span><input type="checkbox" role="switch" checked={showStats} onChange={e => setShowStats(e.target.checked)} /><i aria-hidden="true" /></label>
                <label className="pfs-sw"><span>Show my contributions and points</span><input type="checkbox" role="switch" checked={showContrib} onChange={e => setShowContrib(e.target.checked)} /><i aria-hidden="true" /></label>
              </section>
              <section className="pfs-card"><h4>Notifications &amp; look</h4>
                <label className="pfs-sw"><span>Email me when my reviewers reach 10, 25, 50… visitors</span><input type="checkbox" role="switch" checked={emailMs} onChange={e => setEmailMs(e.target.checked)} /><i aria-hidden="true" /></label>
                <label className="pfs-sw"><span>Dark mode</span><input type="checkbox" role="switch" checked={theme === 'dark'} onChange={e => setTheme(e.target.checked ? 'dark' : 'light')} /><i aria-hidden="true" /></label>
              </section>
              <section className="pfs-card"><h4>Account</h4>
                {sid && <p className="pfs-row"><span>Student ID</span><b>{sid}</b><CopyButton value={sid} label="Student ID" toast={toast} /></p>}
                <p className="pfs-row"><span>Email</span><b>{user.email}</b></p>
                <button type="button" className="btn" onClick={() => sb.auth.signOut()}><Icon name="logout" size={16} /> Sign out</button>
                <div className="pf-danger">
                  <b>Delete account</b>
                  <small>Removes your account, posts and reviewers for good. <a href="/delete-account" target="_blank" rel="noopener noreferrer">How deletion works</a></small>
                  {!delOpen ? <button type="button" className="btn dng" onClick={() => setDelOpen(true)}>Delete my account</button> : (
                    <div className="pf-del">
                      <label>Type <b>DELETE</b> to confirm<input className="clay-in" value={delText} onChange={e => setDelText(e.target.value)} autoComplete="off" /></label>
                      <div className="pf-del-row"><button type="button" className="btn" onClick={() => { setDelOpen(false); setDelText('') }}>Keep my account</button><button type="button" className="btn dng" disabled={delText !== 'DELETE' || delBusy} onClick={deleteAccount}>{delBusy ? 'Deleting…' : 'Delete forever'}</button></div>
                    </div>)}
                </div>
              </section>
            </div>
            <footer className="pfs-save"><button type="button" className="btn pri" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</button></footer>
          </div>)}
      </aside>
    </>
  )
}
