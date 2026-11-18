import { useRef, useState } from 'react'
import { sb } from './supabase'
import { checkPhoto, uploadAvatar, importGooglePhoto } from './avatar'
import { useUniversities, normSchool, isUniversity } from './schools'
import SchoolInput from './SchoolInput'
import SuggestInput from './SuggestInput'
import { useProfileOptions } from './fieldOptions'
import { BIO_MAX, normProgram, normBio, setupError } from './programs'
import Icon, { Logo } from './Icons'

export default function Onboarding({ user, profile, onDone }) {
  const unis = useUniversities(), fo = useProfileOptions()
  const google = user.user_metadata || {}
  // Supabase normalises OAuth metadata, but Facebook can also return a nested picture object.
  const oauthPhoto = google.avatar_url || (typeof google.picture === 'string' ? google.picture : google.picture?.data?.url) || ''
  const [name, setName] = useState(profile.display_name || google.full_name || google.name || ''), [school, setSchool] = useState(profile.school || ''), [file, setFile] = useState(null)
  const [program, setProgram] = useState(profile.program || ''), [institute, setInstitute] = useState(profile.institute || ''), [bio, setBio] = useState(profile.bio || '')
  const [preview, setPreview] = useState(profile.avatar_url || oauthPhoto || ''), [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const pick = useRef()

  const choose = e => {
    const f = e.target.files[0]; e.target.value = ''
    if (!f) return
    const bad = checkPhoto(f); if (bad) return setErr(bad)
    setErr(''); setFile(f); setPreview(URL.createObjectURL(f))
  }
  const problem = setupError({ name, schoolOk: isUniversity(school), program })
  const ready = !problem
  const finish = async () => {
    if (problem) return setErr(problem)
    setBusy(true); setErr('')
    try {
      const row = { user_id: user.id, weekly_goal: profile.weekly_goal || 5, onboarded: true, display_name: name.trim().slice(0, 40), school: normSchool(school), program: normProgram(program), institute: normProgram(institute), bio: normBio(bio) }
      if (file) row.avatar_url = await uploadAvatar(user.id, file)
      else if (!profile.avatar_url && oauthPhoto) { const u = await importGooglePhoto(user.id, oauthPhoto); if (u) row.avatar_url = u }   // so other students can see it
      const { error } = await sb.from('profiles').upsert(row)
      if (error) throw error
      onDone({ ...profile, ...row })
    } catch (e) { setErr(/program|institute|bio|schema cache/i.test(e.message || '') && !/finish setting up/i.test(e.message || '') ? 'The database is out of date. Ask the admin to re-run supabase-setup.sql.' : e.message || 'Something went wrong.'); setBusy(false) }
  }

  return (
    <div className="login">
      <div className="clay onb">
        <Logo size={44} />
        <small className="onb-step">Welcome</small>
        <h1>Set up your account</h1>
        <p>This is required before you can use the app. Tell us who you are and what you study, so classmates from your university can find you and your school gets the right University Astra guide.</p>
        <button className="onb-av" onClick={() => pick.current.click()} aria-label="Choose a profile photo">
          {preview ? <img src={preview} alt="" referrerPolicy="no-referrer" /> : <span>{(name || user.email)[0]?.toUpperCase()}</span>}
          <i>Change</i>
        </button>
        <input ref={pick} type="file" accept="image/*" hidden onChange={choose} />
        <label className="onb-label">Display name <b className="req">*</b>
          <input className="clay-in" value={name} maxLength={40} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && ready && finish()} placeholder="Your name" autoFocus />
        </label>
        <label className="onb-label"><span><Icon name="school" size={15} /> University <b className="req">*</b></span>
          <SchoolInput value={school} maxLength={80} options={unis} onChange={setSchool} placeholder="Type your university, e.g. PUP or Bulacan State" />
        </label>
        <label className="onb-label"><span><Icon name="cap" size={15} /> Program <b className="req">*</b></span>
          <SuggestInput value={program} maxLength={100} onChange={setProgram} options={fo.programs} placeholder="e.g. Bachelor of Secondary Education" />
        </label>
        <label className="onb-label">College / Institute <small className="mute">optional</small>
          <SuggestInput value={institute} maxLength={100} onChange={setInstitute} options={fo.institutes} placeholder="e.g. College of Education" />
        </label>
        <label className="onb-label">Bio <small className="mute">optional · {bio.length}/{BIO_MAX}</small>
          <textarea className="clay-in" rows="3" value={bio} maxLength={BIO_MAX} onChange={e => setBio(e.target.value)} placeholder="A line about you: what you study, what you are reviewing for…" />
        </label>
        <small className="mute onb-note">Your name, university, program and bio are visible to other signed-in students.</small>
        {err && <div className="login-err" role="alert">{err}</div>}
        <button className="btn pri big" disabled={busy || !ready} onClick={finish}>{busy ? 'Saving…' : 'Continue'}</button>
      </div>
    </div>
  )
}
