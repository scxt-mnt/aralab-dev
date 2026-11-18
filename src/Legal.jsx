// Privacy Policy + Terms & Community Rules. Public pages (no login): /privacy and /terms (also #privacy / #terms).
// Linked quietly from the login screen and the sidebar; they open in a new tab so they never get in the way.
import { useEffect } from 'react'
import { Logo } from './Icons'

const CONTACT = import.meta.env.VITE_CONTACT_EMAIL || ''
const UPDATED = 'November 4, 2026'
const contact = CONTACT ? <a href={`mailto:${CONTACT}`}>{CONTACT}</a> : 'the AraLab admin (use the contact details on the sign-in page of this site)'

const PRIVACY = (
  <>
    <p><b>Last updated: {UPDATED}.</b> AraLab is a study app for students. This page explains what we collect, why, and the choices you have.</p>
    <h2>What we collect</h2>
    <ul>
      <li><b>Account:</b> your email, name, profile photo (if you sign in with Google), school, program, bio and student ID number.</li>
      <li><b>What you create:</b> posts, comments, reactions, follows, flags, study time, goals and personal events.</li>
      <li><b>Notes you upload:</b> PDFs, images or text you send to build a reviewer, and the reviewer made from them.</li>
      <li><b>Usage records:</b> which reviewers you opened (counted once per student), stars, and generation attempts, so we can show stats and prevent misuse.</li>
    </ul>
    <h2>How we use it</h2>
    <ul>
      <li>To run the app: sign-in, your profile, the Feed, the Library, rankings and notifications.</li>
      <li>To build reviewers: your notes are sent to an AI service (Google Gemini) to check that they are study material and to write the reviewer. Files sent to the AI are deleted from it right after.</li>
      <li>To keep the community safe: Astra members and admins can review requests, flags and reports.</li>
      <li>To email you when your reviewer reaches a milestone, if you leave that setting on.</li>
    </ul>
    <h2>Google Classroom (optional)</h2>
    <p>If you press <b>Connect Google Classroom</b>, AraLab asks Google for <b>read-only</b> access to your class names, the Materials and announcements your teachers posted, and the files you confirm in Google’s file picker. We never post, edit or delete anything in Classroom or Drive.</p>
    <ul>
      <li>Your Google access token stays in your browser tab (about one hour) and is <b>not</b> sent to or stored on our servers.</li>
      <li>Lesson titles and the list of lessons are shown to you and are not saved. Only the lessons you choose to turn into reviewers are kept: the files and text you confirm are uploaded like any other notes.</li>
      <li>You can press <b>Disconnect</b> at any time, or remove AraLab at <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">myaccount.google.com/permissions</a>.</li>
    </ul>
    <p>AraLab’s use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a>, including the Limited Use requirements. We use Classroom and Drive data only to provide the reviewer feature you asked for. We do not sell it, use it for advertising, or let people read it except as needed to run the service, keep it secure or follow the law.</p>
    <h2>Who can see what</h2>
    <ul>
      <li>Reviewers you publish, your posts and your public profile are visible to other students. You can hide your name on a reviewer, or post anonymously. Anonymous posts show a random alias, and admins can still see the author for moderation.</li>
      <li>Your uploaded notes and requests are visible only to you, your school’s Astra members and admins.</li>
      <li>We do not sell your data or show ads.</li>
    </ul>
    <h2>Where it is stored</h2>
    <p>Data is stored with our hosting and database providers (Supabase and Vercel). Email, if enabled, is sent through an email provider. AI processing uses Google’s Gemini API.</p>
    <h2>Your choices</h2>
    <ul>
      <li>Edit your profile and settings any time, or delete your reviewers and requests from the app.</li>
      <li>To delete your account and the data tied to it, or to ask what we hold about you, contact {contact}.</li>
    </ul>
    <h2>Children</h2>
    <p>AraLab is for university students. If you believe a child under 13 has an account, tell us and we will remove it.</p>
    <h2>Changes</h2>
    <p>If we change this page we will update the date above. Questions? Contact {contact}.</p>
  </>
)

const TERMS = (
  <>
    <p><b>Last updated: {UPDATED}.</b> By using AraLab you agree to these rules. They exist to keep the app useful and safe for every student.</p>
    <h2>Using AraLab</h2>
    <ul>
      <li>Use your own account and keep your sign-in private. Give accurate school and program details.</li>
      <li>AraLab is a study aid. Reviewers are written by AI from notes, so they can contain mistakes. Check them against your lessons and teacher.</li>
    </ul>
    <h2>What you may upload</h2>
    <ul>
      <li>Only study notes and material you have the right to use. Do not upload exams you were told to keep private, or other people’s copyrighted books or paid courses.</li>
      <li>No sexual, hateful, violent or illegal content, no private information about other people, and no spam.</li>
      <li>You keep ownership of your notes. By publishing a reviewer you let AraLab show it to other students in the Library.</li>
    </ul>
    <h2>Community rules</h2>
    <ul>
      <li>Be respectful in posts and comments. No harassment, bullying, impersonation or sharing of private details.</li>
      <li>Flag reviewers that are wrong or incomplete, in good faith. Do not misuse flags or reports.</li>
      <li>Do not try to break, overload or get around the app, its AI check, or other students’ accounts.</li>
    </ul>
    <h2>Checks and enforcement</h2>
    <ul>
      <li>Notes are checked by AI before a reviewer is built. Requests that are not study material, are inappropriate, or already exist in the Library are not generated.</li>
      <li>Astra members (for their own school) and admins can pause your generation, remove a reviewer or post with a reason, or report you. Admins can suspend or ban accounts that break these rules.</li>
      <li>If you think an action was a mistake, contact your Astra member or the admin.</li>
    </ul>
    <h2>Google Classroom</h2>
    <p>Connecting Classroom is optional and read-only. Only turn lessons into reviewers if you are allowed to share that material with other students. Your teacher’s rules about sharing course content still apply.</p>
    <h2>No guarantees</h2>
    <p>AraLab is provided as is, without a promise that it is always available or error-free. We are not responsible for exam results. We may change or stop features, and update these rules (the date above will change).</p>
    <p>Questions? Contact {contact}.</p>
  </>
)

const DELETE = (
  <>
    <p><b>Last updated: {UPDATED}.</b> You can delete your AraLab account and the data linked to it at any time. This page is the data deletion instruction for accounts created with Email, Google or Facebook.</p>
    <h2>Delete it yourself (instant)</h2>
    <ol>
      <li>Sign in to AraLab.</li>
      <li>Open <b>My</b> (your profile) and scroll to <b>Settings</b>.</li>
      <li>Press <b>Delete my account</b>, type <b>DELETE</b> and confirm.</li>
    </ol>
    <h2>Cannot sign in? Ask us</h2>
    <p>Email {contact} from the address you used to sign up (for Facebook or Google sign-in, the email on that account) with the subject <b>Delete my AraLab account</b>. We delete it and reply to confirm.</p>
    <h2>What is deleted</h2>
    <ul>
      <li>Your account, sign-in link (Email, Google or Facebook), name, photo, school, program and bio.</li>
      <li>Your posts, comments, reactions, follows, stars, flags, study time, goals and notifications.</li>
      <li>Your reviewer requests, the files you uploaded to build reviewers, and the reviewers you published.</li>
    </ul>
    <h2>What we may keep</h2>
    <p>Records needed to keep the community safe (for example a moderation record about a ban) and routine server logs, for a limited time. Nothing we keep is used to identify you in the app after deletion.</p>
  </>
)

export default function Legal({ page = 'privacy' }) {
  const kind = page === 'terms' ? 'terms' : page === 'delete-account' ? 'delete' : 'privacy'
  const priv = kind === 'privacy'
  useEffect(() => { document.documentElement.dataset.theme = localStorage.getItem('rl-theme') || 'light'; document.title = `${kind === 'delete' ? 'Delete your account' : priv ? 'Privacy Policy' : 'Terms & Community Rules'} · AraLab` }, [priv])
  return (
    <div className="legal">
      <div className="clay tile legal-card">
        <a className="legal-brand" href="/"><Logo size={32} /><b>AraLab</b></a>
        <nav className="legal-tabs" aria-label="Legal"><a className={kind === 'privacy' ? 'on' : ''} href="/privacy">Privacy Policy</a><a className={kind === 'terms' ? 'on' : ''} href="/terms">Terms &amp; Community Rules</a><a className={kind === 'delete' ? 'on' : ''} href="/delete-account">Delete account</a></nav>
        <h1>{kind === 'delete' ? 'Delete your account' : priv ? 'Privacy Policy' : 'Terms & Community Rules'}</h1>
        {kind === 'delete' ? DELETE : priv ? PRIVACY : TERMS}
        <p className="mute"><a href="/">← Back to AraLab</a></p>
      </div>
    </div>
  )
}
