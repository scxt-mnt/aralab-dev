// Pure progress logic (no React): turns server progress events into { pct, line, state, at }.
export const FIRST_TOKEN_S = 18
const fmt = n => Number(n || 0).toLocaleString()
export function reduce(prev, e) {
  const p = prev || { pct: 0, line: 'Starting…', state: 'start', at: Date.now() }
  const set = (pct, line, state) => ({ ...p, pct: Math.max(p.pct, pct), line, state, at: state === p.state && p.model === e.model && p.n === e.n ? p.at : Date.now(), model: e.model, n: e.n })
  if (e.stage === 'files') return set(3 + 12 * (e.i / e.n), `Reading your files (${e.i}/${e.n})`, 'files')
  if (e.stage === 'upload') return set(3 + 12 * (e.i / e.n), `Sending ${e.name || 'a big file'} to the AI (${e.i}/${e.n})`, 'upload')
  if (e.stage === 'read') return set(14, 'Checking whether this is a finished reviewer…', 'read')
  if (e.stage === 'scan') return set(16, 'Checking your notes…', 'scan')
  if (e.stage === 'build') return set(93, 'Building the reviewer…', 'build')
  if (e.stage === 'save') return set(97, 'Saving…', 'save')
  if (e.stage === 'done') return set(100, 'Done', 'done')
  if (e.stage === 'ai') {
    if (e.state === 'detect') return set(16, 'Finding an available AI model…', 'detect')
    if (e.state === 'wait') return set(18, `${e.round > 1 ? 'Retrying' : 'Asking'} ${e.model} (${e.n}/${e.of})`, 'wait')
    if (e.state === 'write') return set(40 + 50 * (1 - Math.exp(-(e.chars || 0) / 9000)), `Writing with ${e.model} · ${fmt(e.chars)} characters`, 'write')
    if (e.state === 'switch') return set(p.pct, `${e.model} ${e.reason}${e.next ? ` → switching to ${e.next}` : ''}`, 'switch')
  }
  return p
}
