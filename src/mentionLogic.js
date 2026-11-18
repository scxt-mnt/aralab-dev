// Pure helpers for @mentions and comment threads (no React, no Supabase) so they can be unit-tested.

// The @token the reader is currently typing at the end of the text: { start, query } or null.
// `start` is the index of the "@". A mention query is one word (letters, numbers, . _ -).
export function mentionToken(text) {
  const s = String(text || '')
  const m = /(^|[\s(])@([\p{L}\p{N}._-]{0,30})$/u.exec(s)
  if (!m) return null
  return { start: m.index + m[1].length, query: m[2] }
}

export const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The mentions we send to the database: { id, name } only, deduplicated, max 20.
export function cleanMentions(mentions) {
  const out = [], seen = new Set()
  for (const m of Array.isArray(mentions) ? mentions : []) {
    const id = typeof m === 'string' ? m : m?.id
    const name = typeof m === 'string' ? '' : String(m?.name || '').trim().slice(0, 80)
    if (!id || !name || seen.has(id)) continue
    seen.add(id); out.push({ id, name })
    if (out.length >= 20) break
  }
  return out
}

// Keep only mentions whose "@Name" is still in the text (so deleting a mention also removes the notification).
export function liveMentions(text, mentions) {
  const s = String(text || '')
  return cleanMentions(mentions).filter(m => s.includes('@' + m.name))
}

// Replace the @token being typed with the picked student's name.
export function insertMention(text, token, name) {
  const s = String(text || '')
  if (!token) return s
  const before = s.slice(0, token.start)
  const after = s.slice(token.start + 1 + token.query.length).replace(/^\s+/, '')
  return `${before}@${name} ${after}`
}

// Flat comment rows -> top-level comments with a `replies` array. Deeper replies are flattened into their
// thread (one level, like Facebook), so a reply to a reply still shows in the same conversation.
export function commentTree(rows) {
  const all = (Array.isArray(rows) ? rows : []).map(c => ({ ...c, replies: [] }))
  const byId = new Map(all.map(c => [c.id, c]))
  const rootOf = c => {
    let cur = c, guard = 0
    while (cur.parent_id && byId.has(cur.parent_id) && guard++ < 50) cur = byId.get(cur.parent_id)
    return cur
  }
  const roots = []
  for (const c of all) {
    const root = rootOf(c)
    if (root.id !== c.id) root.replies.push(c)
    else roots.push(c)
  }
  const byTime = (a, b) => new Date(a.created_at) - new Date(b.created_at)
  roots.sort(byTime)
  for (const r of roots) r.replies.sort(byTime)
  return roots
}

// Split a body into plain text and @mention pieces so the UI can highlight (and link) them safely.
export function mentionParts(text, mentions) {
  const s = String(text || '')
  const names = [...new Set((Array.isArray(mentions) ? mentions : []).map(m => String(m?.name || '').trim()).filter(n => n && s.includes('@' + n)))]
    .sort((a, b) => b.length - a.length)
  if (!names.length) return [{ text: s }]
  const re = new RegExp(`@(${names.map(escapeRe).join('|')})`, 'g')
  const out = []
  let last = 0, m
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) })
    out.push({ mention: m[1] })
    last = m.index + m[0].length
    if (re.lastIndex === m.index) re.lastIndex++
  }
  if (last < s.length) out.push({ text: s.slice(last) })
  return out
}
