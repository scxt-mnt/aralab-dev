// Calls /api/generate or /api/fix-reviewer and reports live progress. onUpdate(progressState) is called as it moves.
import { reduce } from './aiProgress'
export async function callAi(url, token, body, onUpdate = () => {}, signal) {
  let p = reduce(null, { stage: 'start' }); onUpdate(p)
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson', Authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal })
  if (!(res.headers.get('content-type') || '').includes('ndjson') || !res.body) return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) }
  const reader = res.body.getReader(), dec = new TextDecoder()
  let buf = '', out = null
  const line = l => { if (!l.trim()) return; let e; try { e = JSON.parse(l) } catch { return }
    if (e.type === 'done') out = { ok: e.status < 400, status: e.status, body: e.body || {} }
    else if (e.type === 'progress') { p = reduce(p, e); onUpdate(p) } }
  for (;;) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf('\n')) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1) } }
  line(buf)
  if (out?.ok) onUpdate(reduce(p, { stage: 'done' }))
  return out || { ok: false, status: 502, body: { error: 'The connection dropped before the AI finished. Reload and check the request: it may have finished or can be retried.' } }
}
