import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sb } from './supabase'
import { META, META_V47, META_V80 } from './lib'
import Login from './Login'
import Feed from './Feed'
import Library from './Library'
import Profile from './Profile'
import Bell from './Bell'
import { importGooglePhoto } from './avatar'
import Onboarding from './Onboarding'
import Requests from './Requests'
import Classroom from './Classroom'
import StartCards from './StartCards'
import Astra from './Astra'
import Moderation from './Moderation'
import Ranking from './Ranking'
import Campus from './Campus'
import Search from './Search'
import UploadBar from './UploadBar'
import TaskToast from './TaskToast'
import Welcome from './Welcome'
import { AppSkeleton } from './Skeleton'
import { AstraCtx } from './AstraBadge'
import ErrorBoundary from './ErrorBoundary'
import Icon, { Logo } from './Icons'
import FlowNext from './FlowNext'
import SpeedDial from './SpeedDial'
import { PresenceCtx, OnlineDot, usePresence } from './presence'
import { takeShared } from './shareLink'

export default function App() {
  const [session, setSession] = useState(null), [ready, setReady] = useState(false)
  const [admin, setAdmin] = useState(false), [astraSchool, setAstraSchool] = useState(null), [astraMap, setAstraMap] = useState({}), [gq, setGq] = useState(''), [profileError, setProfileError] = useState(''), [retry, setRetry] = useState(0), [jump, setJump] = useState(null), [libJump, setLibJump] = useState(null), [openId, setOpenId] = useState(null), [items, setItems] = useState([])
  const [texts, setTexts] = useState({}), [textsWanted, setTextsWanted] = useState(false)
  const [tab, rawSetTab] = useState('feed'), [msg, setMsg] = useState(''), [welcome, setWelcome] = useState(false), [welcomeStart, setWelcomeStart] = useState(0), [libLoading, setLibLoading] = useState(true)
  // Keep-alive tabs: a tab you already opened stays mounted (just hidden), so switching back is instant and keeps its scroll/search/open item.
  // If you were away from it for over 5 minutes it is rebuilt fresh, so data is never very old.
  const curTab = useRef('feed'), tabMeta = useRef({ left: {}, gen: {}, seen: new Set(['feed']), scroll: {} })
  const setTab = useCallback(next => {
    const m = tabMeta.current, cur = curTab.current
    if (next === cur) return
    m.scroll[cur] = window.scrollY; m.left[cur] = Date.now()
    if (m.left[next] && Date.now() - m.left[next] > 5 * 60 * 1000) m.gen[next] = (m.gen[next] || 0) + 1
    m.seen.add(next); curTab.current = next
    rawSetTab(next)
    requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, m.scroll[next] || 0)))
  }, [])
  const [profile, setProfile] = useState({ display_name: '', weekly_goal: 5, avatar_url: '', onboarded: false, school: '', program: '', institute: '', bio: '' }), [profileLoaded, setProfileLoaded] = useState(false), [profileId, setProfileId] = useState(null)
  const [gcSeen, setGcSeen] = useState(() => { try { return localStorage.getItem('rl-gc-seen') === '1' } catch { return true } })
  useEffect(() => { if (tab === 'classroom' && !gcSeen) { try { localStorage.setItem('rl-gc-seen', '1') } catch { /* ignore */ } setGcSeen(true) } }, [tab, gcSeen])
  const [nudge, setNudge] = useState(true), [theme, setTheme] = useState(() => localStorage.getItem('rl-theme') || 'light')
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('rl-theme', theme) }, [theme])
  const openGuide = useCallback((n = 0) => { setWelcomeStart(n); setWelcome(true) }, [])   // opens the Welcome guide on a given step
  const toast = useCallback(m => { setMsg(m); clearTimeout(toast.t); toast.t = setTimeout(() => setMsg(''), 3400) }, [])

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) })
    // v84: a token refresh (it happens whenever you come back to the tab) must not replace the session object, or every screen reloads and the open reviewer resets
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(prev => { if (prev && s && prev.user?.id === s.user?.id) { prev.access_token = s.access_token; prev.expires_at = s.expires_at; return prev } return s }))
    return () => data.subscription.unsubscribe()
  }, [])

  const reload = useCallback(async () => {
    let all = [], from = 0, cols = META_V80
    for (;;) {
      let { data, error } = await sb.from('reviewers').select(cols).order('added', { ascending: false }).range(from, from + 999)
      if (error && cols === META_V80 && /thumb|preview/.test(error.message)) { cols = META_V47; ({ data, error } = await sb.from('reviewers').select(cols).order('added', { ascending: false }).range(from, from + 999)) }   // v81 SQL not run yet
      if (error && cols === META_V47 && /removed_/.test(error.message)) { cols = META; ({ data, error } = await sb.from('reviewers').select(cols).order('added', { ascending: false }).range(from, from + 999)) }   // v47 SQL not run yet
      if (error) { setLibLoading(false); return toast(`Couldn't load the library: ${error.message}`) }
      all = all.concat(data); if (data.length < 1000) break; from += 1000
    }
    // v48/v50: visitors + stars per reviewer, plus the recent visitors' profile circles (older databases fall back to counts only)
    let st = await sb.from('reviewer_stats').select('reviewer_id,visitors,stars,visitor_faces')
    if (st.error) st = await sb.from('reviewer_stats').select('reviewer_id,visitors,stars')
    if (!st.error) {
      const m = Object.fromEntries((st.data || []).map(r => [r.reviewer_id, r]))
      all = all.map(i => ({ ...i, visitors: m[i.id]?.visitors || 0, stars: m[i.id]?.stars || 0, faces: m[i.id]?.visitor_faces || [] }))
    }
    setItems(all); setLibLoading(false)
  }, [toast])

  const uidKey = session?.user.id, online = usePresence(uidKey)
  const wantText = useCallback(() => setTextsWanted(true), [])
  // reviewer text is only needed for searching inside reviewers: fetch it the first time someone searches, then keep it
  useEffect(() => {
    if (!textsWanted || !uidKey || !items.length || items.every(i => i.id in texts)) return
    let live = true
    ;(async () => {
      const got = {}
      for (let from = 0; ; from += 500) {
        const { data, error } = await sb.from('reviewers').select('id,text').order('added', { ascending: false }).range(from, from + 499)
        if (error || !live) return
        data.forEach(r => { got[r.id] = r.text || '' }); if (data.length < 500) break
      }
      if (live) setTexts(t => ({ ...t, ...got }))
    })()
    return () => { live = false }
  }, [textsWanted, uidKey, items, texts])
  const full = useMemo(() => (Object.keys(texts).length ? items.map(i => ({ ...i, text: texts[i.id] || '' })) : items), [items, texts])
  useEffect(() => {
    if (!uidKey) { setAdmin(false); setAstraSchool(null); setItems([]); setProfileLoaded(false); setLibLoading(true); return }
    sb.from('admins').select('user_id').eq('user_id', uidKey).maybeSingle().then(({ data }) => setAdmin(!!data))
    sb.from('astra_members').select('school').eq('user_id', uidKey).maybeSingle().then(({ data }) => setAstraSchool(data?.school || null))
    ;(async () => {
      // Never treat a failed load as "new user": that is what sent already-registered students back to account setup.
      const FULL = 'display_name,weekly_goal,avatar_url,onboarded,show_stats,show_contributions,school,banned,ban_reason,student_no,temp_ban_until,bio,program,institute', BASE = 'display_name,weekly_goal,avatar_url,onboarded,show_stats,school'
      let r = await sb.from('profiles').select(FULL).eq('user_id', uidKey).maybeSingle()
      if (r.error) { r = await sb.from('profiles').select(BASE).eq('user_id', uidKey).maybeSingle(); if (!r.error) toast('Database is out of date. Re-run supabase-setup.sql in Supabase.') }
      if (r.error) { setProfileError(r.error.message); return }
      setProfileError('')
      if (r.data) setProfile(p => ({ ...p, ...r.data }))
      setProfileLoaded(true)
    })()
    reload()
  }, [uidKey, reload, retry])

  useEffect(() => {
    if (!uidKey) return
    sb.from('astra_members').select('user_id,school').then(({ data }) => { setAstraMap(Object.fromEntries((data || []).map(r => [r.user_id, r.school]))); setAstraSchool((data || []).find(r => r.user_id === uidKey)?.school || null) })
  }, [uidKey, tab])
  // Existing students signed in with Google but never saved a photo: copy it once so everyone else can see it too
  const photoTried = useRef(false)
  useEffect(() => {
    const meta = session?.user?.user_metadata || {}
    const g = meta.avatar_url || (typeof meta.picture === 'string' ? meta.picture : meta.picture?.data?.url)
    if (photoTried.current || !profileLoaded || !profile.onboarded || profile.avatar_url || !g) return
    photoTried.current = true
    importGooglePhoto(uidKey, g).then(async u => { if (!u) return; const { error } = await sb.from('profiles').update({ avatar_url: u }).eq('user_id', uidKey); if (!error) setProfile(p => ({ ...p, avatar_url: u })) })
  }, [profileLoaded, profile.onboarded, profile.avatar_url, session, uidKey])
  useEffect(() => { if (tab !== 'search') setGq('') }, [tab])
  // phones: while a text box is focused the keyboard needs the room, so the bottom tabs hide (CSS: body.kb-open)
  useEffect(() => {
    let t = null
    const typing = el => el && /^(TEXTAREA|SELECT)$/.test(el.tagName) || (el?.tagName === 'INPUT' && !/^(checkbox|radio|file|range|button|submit|color)$/i.test(el.type))
    const on = e => { clearTimeout(t); if (typing(e.target)) document.body.classList.add('kb-open') }
    const off = () => { clearTimeout(t); t = setTimeout(() => { if (!typing(document.activeElement)) document.body.classList.remove('kb-open') }, 120) }
    document.addEventListener('focusin', on); document.addEventListener('focusout', off)
    return () => { clearTimeout(t); document.removeEventListener('focusin', on); document.removeEventListener('focusout', off); document.body.classList.remove('kb-open') }
  }, [])
  useEffect(() => { if (gq.trim().length >= 2) wantText() }, [gq, wantText])

  useEffect(() => {
    if (!uidKey) return
    const ch = sb.channel('mine-' + uidKey).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'reviewer_requests', filter: `user_id=eq.${uidKey}` }, p => {
      const r = p.new
      if (r.status === 'done') { toast(`“${r.title}” is published in the Library`); reload() }
      else if (r.status === 'rejected') toast(`“${r.title}” was rejected${r.admin_note ? ': ' + r.admin_note : ''}`)
      else if (r.status === 'failed') toast(`“${r.title}” could not be generated`)
    }).subscribe()
    return () => { sb.removeChannel(ch) }
  }, [uidKey, reload, toast])

  const openReviewer = id => { setProfileId(null); setTab('library'); setOpenId({ id, n: Date.now() }) }
  // v65: a shared reviewer link (/r/<id>) opens that reviewer once the student is signed in, set up, and the Library has loaded
  useEffect(() => {
    if (!uidKey || !profileLoaded || !profile.onboarded || libLoading) return
    const id = takeShared()
    if (id) { setProfileId(null); setTab('library'); setOpenId({ id, n: Date.now() }) }
  }, [uidKey, profileLoaded, profile.onboarded, libLoading, setTab])

  if (!session) return <Login ready={ready} />
  const user = session.user
  if (profileError) return <div className="login"><div className="clay tile" style={{ maxWidth: 420, textAlign: 'center' }}><h2>Couldn’t load your account</h2><p className="mute">{profileError}</p><button className="btn pri" onClick={() => setRetry(n => n + 1)}>Try again</button> <button className="btn" onClick={() => sb.auth.signOut()}>Sign out</button></div></div>
  if (!profileLoaded) return <AppSkeleton />
  if (!profile.banned && profile.temp_ban_until && new Date(profile.temp_ban_until) > new Date()) return <div className="login"><div className="clay tile" style={{ maxWidth: 420, textAlign: 'center' }}><h2>You are temporarily suspended</h2><p className="mute">Until {new Date(profile.temp_ban_until).toLocaleString()}. The admin is reviewing this.</p><button className="btn" onClick={() => sb.auth.signOut()}>Sign out</button></div></div>
  if (profile.banned) return <div className="login"><div className="clay tile" style={{ maxWidth: 420, textAlign: 'center' }}><h2>Your account is banned</h2><p className="mute">{profile.ban_reason || 'You broke the community rules.'}</p><p className="mute">If you think this is a mistake, contact the admin.</p><button className="btn" onClick={() => sb.auth.signOut()}>Sign out</button></div></div>
  if (!profile.onboarded) return <Onboarding user={user} profile={profile} onDone={p => { setProfile(p); openGuide(0) }} />
  const avatar = profile.avatar_url || user.user_metadata?.avatar_url, name = profile.display_name || user.user_metadata?.full_name || user.email
  const KEPT = ['feed', 'campus', 'rank', 'requests', 'classroom', 'mod', 'astra', 'library'], shownTab = tab === 'search' ? '' : tab === 'mod' && !(admin || astraSchool) ? 'library' : KEPT.includes(tab) ? tab : 'library'
  if (shownTab) tabMeta.current.seen.add(shownTab)
  // v48: two pairs of tabs share one nav button and switch with a small tab bar at the top of the page
  const hub = shownTab === 'library' || shownTab === 'requests' || shownTab === 'classroom' ? { label: 'Library', tabs: [['library', 'Browse', 'library'], ['requests', admin ? 'Requests' : 'Create', 'sparkles'], ['classroom', 'Classroom', 'school']] }
    : shownTab === 'astra' || shownTab === 'rank' || shownTab === 'campus' ? { label: 'University Astra', tabs: [['astra', 'School guide', 'cap'], ['rank', 'Ranking', 'award'], ['campus', 'My university', 'school']] } : null
  const myOpen = profileId === user.id
  const go = t => { setProfileId(null); setTab(t) }
  // speed dial: jump to a screen; for the Feed also put the cursor in the post box so "Post in the Feed" really starts a post
  const dialGo = it => { go(it.tab); if (it.id === 'feed') setTimeout(() => { const t = document.querySelector('.composer textarea'); if (t) { t.scrollIntoView({ behavior: 'smooth', block: 'center' }); t.focus({ preventScroll: true }) } }, 450) }
  const pane = (k, node) => (shownTab === k || tabMeta.current.seen.has(k)) ? <div key={`${k}-${tabMeta.current.gen[k] || 0}`} className="tabpane" hidden={shownTab !== k}><ErrorBoundary>{node}</ErrorBoundary></div> : null
  return (
    <AstraCtx.Provider value={astraMap}>
    <PresenceCtx.Provider value={online}>
    <div className="shell">
      <UploadBar />
      <aside className="clay side">
        <div className="brand"><Logo size={36} /><span>AraLab</span></div>
        <Bell me={user.id} toast={toast} onGo={n => {
          // feed notifications (mentions, comments, replies, comment reactions) open the post they point at
          if (n.kind === 'follow') return setProfileId(n.actor_id)
          setProfileId(null)
          if (n.kind === 'post') return setTab('feed')
          if (['mention', 'comment', 'comment_reply', 'comment_reaction'].includes(n.kind)) {
            setTab('feed')
            if (n.ref) location.hash = `#post=${n.ref}`
            return
          }
          if (n.kind === 'task_request') return setTab(admin ? 'requests' : 'mod')
          if (n.kind === 'task_flag') return setTab(admin ? 'library' : 'mod')
          if (n.kind === 'task_app' || n.kind === 'task_ban' || n.kind === 'task_gen') return setTab('mod')
          if (n.kind === 'gen_pause' || n.kind === 'gen_resume') return setTab('requests')
          setTab('library')
        }} />
        <nav aria-label="Main">
          <button className={!myOpen && tab === 'feed' ? 'nav on' : 'nav'} onClick={() => go('feed')}><Icon name="feed" /> Feed</button>
          <button className={!myOpen && (tab === 'library' || tab === 'requests' || tab === 'classroom') ? 'nav on' : 'nav'} onClick={() => go('library')}><Icon name="library" /> Library{!gcSeen && <i className="new-dot" aria-label="New: Google Classroom" />}</button>
          <button className={!myOpen && (tab === 'astra' || tab === 'rank' || tab === 'campus') ? 'nav on' : 'nav'} onClick={() => go('astra')}><Icon name="cap" /> <span className="nl-full">University Astra</span><span className="nl-short">Astra</span></button>
          {(admin || astraSchool) && <button className={!myOpen && tab === 'mod' ? 'nav on' : 'nav'} onClick={() => go('mod')}><Icon name="flag" /> <span className="nl-full">{admin ? 'Moderation' : 'Astra desk'}</span><span className="nl-short">{admin ? 'Mod' : 'Desk'}</span></button>}
          {/* phones: "My" lives in the bottom bar (profile, points, settings). Desktop keeps the profile chip at the bottom of the sidebar. */}
          <button className={myOpen ? 'nav nav-my on' : 'nav nav-my'} onClick={() => setProfileId(myOpen ? null : user.id)} aria-label="My profile" aria-pressed={myOpen}>
            <span className="my-av">{avatar ? <img className="av" src={avatar} alt="" referrerPolicy="no-referrer" /> : <span className="av">{name[0]?.toUpperCase()}</span>}</span>
            <span className="nl-lbl">My</span>
          </button>
        </nav>
        <button className="help-btn" onClick={() => openGuide(0)} aria-label="How AraLab works"><Icon name="help" size={17} /> <span>How it works</span></button>
        <button className="help-btn out-btn" onClick={() => sb.auth.signOut()} aria-label="Sign out"><Icon name="logout" size={17} /> <span>Sign out</span></button>
        <div className="legal-links"><a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy</a> · <a href="/terms" target="_blank" rel="noopener noreferrer">Terms</a> · <a href="/delete-account" target="_blank" rel="noopener noreferrer">Delete account</a></div>
        <button className="me-btn" onClick={() => setProfileId(user.id)} aria-label="Open profile">
          <span className="av-wrap">{avatar ? <img className="av" src={avatar} alt="" referrerPolicy="no-referrer" /> : <div className="av">{name[0]?.toUpperCase()}</div>}<OnlineDot id={user.id} /></span>
          <div><b>{name}</b><small>{profile.school || (admin ? 'Admin' : 'Member')}</small></div>
        </button>
      </aside>
      <main>
        <div className="gsearch search" role="search"><Icon name="search" size={17} /><input className="clay-in" value={gq} aria-label="Search" placeholder="Search students, posts, Astra guides, reviewers…" onChange={e => { setGq(e.target.value); if (e.target.value.trim()) setTab('search') }} onKeyDown={e => e.key === 'Escape' && (setGq(''), setTab('feed'))} />{gq && <button className="icon-btn gs-x" aria-label="Clear search" onClick={() => { setGq(''); setTab('feed') }}><Icon name="x" size={16} /></button>}</div>
        {!profile.school && nudge && (
          <div className="nudge" role="note"><Icon name="school" size={18} /><span>Add your school to unlock your University Astra guide.</span>
            <button className="btn pri" onClick={() => setProfileId(user.id)}>Add school</button><button className="icon-btn" aria-label="Dismiss" onClick={() => setNudge(false)}><Icon name="x" size={16} /></button></div>
        )}
        {profile.school && !profile.program && nudge && (
          <div className="nudge" role="note"><Icon name="cap" size={18} /><span>Add your program and a short bio so classmates can find you.</span>
            <button className="btn pri" onClick={() => setProfileId(user.id)}>Add now</button><button className="icon-btn" aria-label="Dismiss" onClick={() => setNudge(false)}><Icon name="x" size={16} /></button></div>
        )}
        {hub && <div className="subtabs hub" role="tablist" aria-label={hub.label}>{hub.tabs.map(([k, label, ic]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'subtab on' : 'subtab'} onClick={() => setTab(k)}><Icon name={ic} size={16} /> {label}{k === 'classroom' && !gcSeen && <i className="new-pill">New</i>}</button>)}</div>}
        {shownTab === 'library' && <StartCards mode="library" go={setTab} />}
        {shownTab === 'requests' && <StartCards mode="requests" go={setTab} />}
        {shownTab === 'classroom' && <StartCards mode="classroom" go={setTab} />}
        {tab === 'search' && <Search q={gq} me={user.id} admin={admin} items={full} toast={toast} onOpenProfile={setProfileId} onOpenGuide={s => { setJump({ s, n: Date.now() }); setTab('astra') }} onOpenLibrary={() => setTab('library')} />}
        {pane('feed', <Feed active={tab === 'feed'} items={items} onOpenLibrary={() => setTab('library')} me={user.id} person={{ user_id: user.id, display_name: name, avatar_url: avatar }} admin={admin} toast={toast} onOpenProfile={setProfileId} />)}
        {pane('campus', <Campus me={user.id} school={profile.school} myProgram={profile.program} toast={toast} onOpenProfile={setProfileId} onSetSchool={() => setProfileId(user.id)} />)}
        {pane('rank', <Ranking me={user.id} school={profile.school} toast={toast} onOpenProfile={setProfileId} />)}
        {pane('requests', <Requests session={session} admin={admin} items={items} toast={toast} onOpenLibrary={q => { setLibJump(typeof q === 'string' && q ? { q, n: Date.now() } : null); setTab('library') }} onChanged={reload} />)}
        {pane('classroom', <Classroom session={session} admin={admin} items={items} toast={toast} onOpenLibrary={q => { setLibJump(typeof q === 'string' && q ? { q, n: Date.now() } : null); setTab('library') }} onChanged={reload} />)}
        {(admin || astraSchool) && pane('mod', <Moderation me={user.id} admin={admin} school={astraSchool} toast={toast} onChanged={reload} onOpenProfile={setProfileId} />)}
        {pane('astra', <Astra jump={jump} admin={admin} me={user.id} astraSchool={astraSchool} school={profile.school} toast={toast} onSetSchool={() => setProfileId(user.id)} />)}
        {pane('library', <Library jump={libJump} openId={openId} loading={libLoading} wantText={wantText} items={full} admin={admin} astraSchool={astraSchool} reload={reload} toast={toast} me={user.id} school={profile.school} program={profile.program} onOpenProfile={setProfileId} />)}
        {tab !== 'search' && !myOpen && <FlowNext tab={shownTab} go={go} openMy={() => setProfileId(user.id)} openWelcome={() => openGuide(0)} />}
      </main>
      {profileId && <ErrorBoundary><Profile key={profileId} onOpenReviewer={openReviewer} viewId={profileId} user={user} avatar={avatar} admin={admin} profile={profile} items={items} theme={theme} setTheme={setTheme} onSaved={r => setProfile(p => ({ ...p, ...r }))} onClose={() => setProfileId(null)} toast={toast} onOpenProfile={setProfileId} /></ErrorBoundary>}
      <SpeedDial tab={shownTab} onGo={dialGo} onGuide={openGuide} />
      {welcome && <Welcome start={welcomeStart} onClose={() => setWelcome(false)} onCreate={() => { setWelcome(false); setTab('requests') }} onAstra={() => { setWelcome(false); setTab('astra') }} />}
      <TaskToast />
      <div className={msg ? 'toast on' : 'toast'} role="status">{msg}</div>
    </div>
    </PresenceCtx.Provider>
    </AstraCtx.Provider>
  )
}
