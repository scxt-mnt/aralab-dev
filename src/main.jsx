import './safeStorage'
import { createRoot } from 'react-dom/client'
import App from './App'
import Legal from './Legal'
import ErrorBoundary from './ErrorBoundary'
import { envMissing, testMode } from './supabase'
import { stashIncoming } from './shareLink'
import './styles.css'
import { markInApp } from './inapp'
markInApp()   // v84: adds class `inapp` to <html> inside Facebook / Messenger / Instagram browsers
stashIncoming()   // v65: /r/<id> or ?r=<id> (a shared reviewer link): remember it, so it opens after sign-in
const legal = /^\/(privacy|terms|delete-account)\/?$/.test(location.pathname) ? location.pathname.replace(/\//g, '') : /^#(privacy|terms|delete-account)$/.test(location.hash) ? location.hash.slice(1) : ''
createRoot(document.getElementById('root')).render(legal ? <Legal page={legal} /> : envMissing
  ? <div className="login"><div className="clay tile" style={{ maxWidth: 440 }}><h2>Missing settings</h2><p className="mute">Create a file named <b>.env</b> in the project folder with <b>VITE_SUPABASE_URL</b> and <b>VITE_SUPABASE_ANON_KEY</b> (copy it from <b>.env.example</b>), then restart <b>npm run dev</b>.</p></div></div>
  : <>{testMode && <div className="test-ribbon">TEST MODE · sample data · live database not used</div>}<ErrorBoundary><App /></ErrorBoundary></>)
