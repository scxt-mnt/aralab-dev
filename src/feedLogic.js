// Pure helpers for the feed (no React, no Supabase) so they can be unit-tested.
// keys are what the database stores; labels are shown to people; the icons live in Icons.jsx
export const REACTIONS = { like: 'Like', love: 'Love', fire: 'Fire', clap: 'Helpful', wow: 'Wow' }
export const STAT_LAYOUTS = { compact: 'Compact', rings: 'Goal ring', weekly: 'Weekly bars', subjects: 'Subjects' }

// Move a person's reaction on a post: same emoji again = remove, different emoji = switch. Returns new reactions object.
export function applyReaction(reactions, kind) {
  const counts = { ...(reactions?.counts || {}) }
  const prev = reactions?.mine || null
  const next = kind === prev ? null : kind
  if (prev) counts[prev] = Math.max(0, (counts[prev] || 0) - 1)
  if (next) counts[next] = (counts[next] || 0) + 1
  for (const k of Object.keys(counts)) if (!counts[k]) delete counts[k]
  return { counts, mine: next, total: Object.values(counts).reduce((a, b) => a + b, 0) }
}

// reaction summary, biggest first: [['fire', 3], ['like', 1]]
export const topReactions = (reactions, n = 3) =>
  Object.entries(reactions?.counts || {}).filter(([k, v]) => REACTIONS[k] && v > 0).sort((a, b) => b[1] - a[1]).slice(0, n)

// anonymous rows hide user_id from everyone but the writer, so "mine" can also come from the server's is_mine flag
const isMine = (row, me) => !!me && (row.is_mine === true || row.user_id === me)
export const canEditPost = (post, me) => isMine(post, me)
export const canDeletePost = (post, me, admin) => !!me && (isMine(post, me) || !!admin)
export const canEditComment = (c, me) => isMine(c, me)
export const canDeleteComment = (c, post, me, admin) => !!me && (isMine(c, me) || isMine(post, me) || !!admin)

// Who to show for a post/comment row. Anonymous rows never show a name or school; the writer (and admins, for moderation) get a private hint.
// The random alias ("Anonymous 7K2F9") is made by the database and lets readers tell whether two anonymous messages are the same person.
export function authorFor(people, row) {
  const known = row.user_id ? people[row.user_id] : null
  // Admin announcements show as the official account. The real admin is never exposed (the database blanks user_id for students); admins get a private hint like for anonymous posts.
  if (row.is_announcement) return { user_id: null, display_name: 'AraLab', avatar_url: null, official: true, hint: row.is_mine ? 'You' : known?.display_name ? `Admin view: ${known.display_name}` : '' }
  if (row.is_anonymous) return { user_id: null, display_name: row.anon_alias ? `Anonymous ${row.anon_alias}` : 'Anonymous student', avatar_url: null, anonymous: true, hint: row.is_mine ? 'You' : known?.display_name ? `Admin view: ${known.display_name}` : '' }
  return known || { user_id: row.user_id, display_name: 'Former student', avatar_url: null }
}

export const parsePostHash = (hash = '') => {
  const m = /^#post=([0-9a-f-]{36})$/i.exec(hash)
  return m ? m[1].toLowerCase() : null
}

export const ago = t => {
  const m = Math.round((Date.now() - new Date(t)) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : m < 43200 ? `${Math.round(m / 1440)}d ago` : new Date(t).toLocaleDateString()
}

// Live refresh replaces the newest page but keeps older pages the student already scrolled to.
// A post that is newer than the oldest fetched one but missing from the fresh page was deleted, so it is dropped.
export function mergeFirstPage(prev, fresh, pageSize) {
  if (!prev) return fresh
  const ids = new Set(fresh.map(p => p.id))
  const full = fresh.length >= pageSize, oldest = fresh[fresh.length - 1]?.created_at
  const tail = full ? prev.filter(p => !ids.has(p.id) && p.created_at < oldest) : []
  return [...fresh, ...tail]
}
