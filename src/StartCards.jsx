// Makes the two ways to build a reviewer easy to notice and understand.
//  mode "library"   : two big cards at the top of Library > Browse (can be hidden with the X)
//  mode "requests"  : slim banner pointing to Google Classroom
//  mode "classroom" : slim banner pointing to uploading your own notes
import { useState } from 'react'
import Icon from './Icons'

const KEY = 'rl-start-hide'
const read = () => { try { return localStorage.getItem(KEY) === '1' } catch { return false } }

export default function StartCards({ mode, go }) {
  const [hidden, setHidden] = useState(read)
  const hide = () => { try { localStorage.setItem(KEY, '1') } catch { /* ignore */ } setHidden(true) }
  if (mode === 'requests') return <div className="clay tile start-banner"><Icon name="school" size={20} /><span><b>Lessons in Google Classroom?</b> Import them here instead of uploading files.</span><button className="btn" onClick={() => go('classroom')}>Open Classroom</button></div>
  if (mode === 'classroom') return <div className="clay tile start-banner"><Icon name="sparkles" size={20} /><span><b>Have your own notes?</b> Upload a PDF, photo or text file and get a reviewer.</span><button className="btn" onClick={() => go('requests')}>Upload notes</button></div>
  if (hidden || mode === 'library') return null     // v83: the Browse / Create / Classroom tabs already say it
  return (
    <section className="start-cards" aria-label="Make a reviewer">
      <button type="button" className="start-card clay tile" onClick={() => go('requests')}>
        <span className="sc-ic"><Icon name="sparkles" size={24} /></span>
        <span className="sc-txt"><b>Create a reviewer</b><small>Upload your notes (PDF, photo or text). AI turns them into notes, flashcards and a quiz in seconds.</small></span>
        <span className="btn pri sc-go">Upload notes</span>
      </button>
      <button type="button" className="start-card clay tile" onClick={() => go('classroom')}>
        <span className="sc-ic gc"><Icon name="school" size={24} /></span>
        <span className="sc-txt"><b>AraLab × Google Classroom <i className="new-pill">New</i></b><small>Connect your account, see every lesson your teachers posted, and press Generate on the ones you want.</small></span>
        <span className="btn pri sc-go">Connect Classroom</span>
      </button>
      <button type="button" className="icon-btn start-x" aria-label="Hide these shortcuts" title="Hide" onClick={hide}><Icon name="x" size={15} /></button>
    </section>
  )
}
