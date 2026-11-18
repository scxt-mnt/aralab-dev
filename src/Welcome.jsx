// First-run guide shown once, right after a new student finishes account setup.
// Explains what AraLab is, what University Astra means, and exactly where to create a reviewer.
// It can be reopened any time from the "How it works" button in the sidebar.
import { useEffect, useState } from 'react'
import Icon from './Icons'

const STEPS = [
  {
    icon: 'library', tone: '#6c7bf0', title: 'Welcome to AraLab',
    lead: 'Student-made reviewers for state university students, all in one place.',
    points: [
      ['library', 'Library', 'Browse reviewers other students made. Open one, study it, and flag anything that is missing or wrong.'],
      ['feed', 'Feed', 'Post what you are studying, ask questions, and follow classmates.'],
      ['award', 'Ranking', 'Earn points for contributing reviewers, studying and getting flags accepted.'],
    ],
  },
  {
    icon: 'cap', tone: '#8b6cf0', title: 'What is University Astra?',
    lead: 'Astra has two parts, and both belong to your school.',
    points: [
      ['book', 'The Astra guide', 'A guide for your university: enrollment, programs, scholarships, campus life, tips and contacts. Open the University Astra tab to read it.'],
      ['award', 'Astra members', 'Trusted students from your school. They check flags, watch how classmates use AI generation, remove problem reviewers, write the guide, and report bad behavior. The admin decides bans.'],
      ['target', 'Become one', 'Not an Astra yet? Open the University Astra tab and press Apply as Astra. You need enough account age, points, published reviewers and accepted flags.'],
    ],
  },
  {
    icon: 'sparkles', tone: '#e0903f', title: 'Where do I create a reviewer?',
    lead: 'Open Library, then tap the Create tab at the top of the page. No account setup or approval needed: you press one button and it is built.',
    flow: [
      ['Add your notes', 'Drop in PDFs, Word, PowerPoint, photos or text, paste a link, or import a lesson from Google Classroom.'],
      ['AI builds it', 'It checks your notes, then builds the reviewer in seconds.'],
      ['It is in the Library', 'You get a notification and it shows up for everyone, with your name on it.'],
    ],
    tip: 'The round + Quick start button in the corner of every screen jumps to Create, Google Classroom, the Library and more.',
  },
]

// start: which step to open on (0 = intro, 2 = how to create a reviewer). The Quick start speed dial uses it.
export default function Welcome({ onClose, onCreate, onAstra, start = 0 }) {
  const [i, setI] = useState(Math.min(Math.max(start | 0, 0), STEPS.length - 1))
  const s = STEPS[i], last = i === STEPS.length - 1
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])

  return (
    <div className="scrim" onClick={onClose}>
      <div className="clay modal welcome" role="dialog" aria-modal="true" aria-label="How AraLab works" onClick={e => e.stopPropagation()}>
        <button className="icon-btn wl-x" aria-label="Close" onClick={onClose}><Icon name="x" size={18} /></button>
        <div className="wl-ico" style={{ background: s.tone }}><Icon name={s.icon} size={26} /></div>
        <small className="onb-step">Step {i + 1} of {STEPS.length}</small>
        <h2>{s.title}</h2>
        <p className="mute wl-lead">{s.lead}</p>

        {s.points && <ul className="wl-points">{s.points.map(([ic, t, d]) => (
          <li key={t}><span className="wl-pi"><Icon name={ic} size={17} /></span><div><b>{t}</b><small>{d}</small></div></li>))}</ul>}

        {s.flow && <ol className="wl-flow">{s.flow.map(([t, d], n) => (
          <li key={t}><span className="wl-n">{n + 1}</span><div><b>{t}</b><small>{d}</small></div></li>))}</ol>}

        {s.tip && <p className="wl-tip"><Icon name="bulb" size={16} /><span>{s.tip}</span></p>}

        <div className="wl-dots" aria-hidden="true">{STEPS.map((_, n) => <i key={n} className={n === i ? 'on' : ''} />)}</div>

        <div className="row wl-foot">
          {i > 0 ? <button className="btn" onClick={() => setI(i - 1)}>Back</button> : <button className="btn" onClick={onClose}>Skip</button>}
          {i === 1 && <button className="btn" onClick={onAstra}>Open Astra tab</button>}
          {last
            ? <><button className="btn" onClick={onClose}>Got it</button><button className="btn pri" onClick={onCreate}><Icon name="sparkles" size={15} /> Take me to Create reviewer</button></>
            : <button className="btn pri" onClick={() => setI(i + 1)}>Next</button>}
        </div>
      </div>
    </div>
  )
}
