// Browser side of "Add a link": asks our server to download the link (a browser may not read other sites) and gets back a File.
import { sb } from './supabase'
import { convertFile } from './fileConvert'
import { normalizeUrl } from './linkLogic'

// url (what the student typed) -> File, already converted to something the server accepts. Throws an Error with a sentence for the student.
export async function fetchLinkFile(input, token) {
  const url = normalizeUrl(input)
  if (!url) throw new Error('That doesn’t look like a web link. Paste the full address, like https://…')
  const { data: s } = await sb.auth.getSession()
  let res
  try { res = await fetch('/api/fetch-link', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session?.access_token || token}` }, body: JSON.stringify({ url }) }) }
  catch { throw new Error('Could not reach the server. Locally, run "vercel dev" instead of "npm run dev".') }
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `Could not open that link (${res.status}).`) }
  const blob = await res.blob()
  let name = 'link'; try { name = decodeURIComponent(res.headers.get('X-File-Name') || 'link') } catch { /* keep default */ }
  const f = await convertFile(new File([blob], name, { type: blob.type }))
  f.fromLink = new URL(url).hostname.replace(/^www\./, '')
  return f
}
