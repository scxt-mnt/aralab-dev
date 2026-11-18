// All newsfeed data access lives here (posts, reactions, comments, stats). Components never talk to Supabase for the feed directly.
import { sb } from './supabase'

import { REACTIONS, STAT_LAYOUTS, authorFor } from './feedLogic'
import { cleanMentions } from './mentionLogic'
import { removePostVideo } from './videos'
export { REACTIONS, STAT_LAYOUTS }
export const MAX_POST = 2000
export const MAX_COMMENT = 1000
export const MAX_TITLE = 120
export const PAGE = 15
export const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' } }
export const postLink = id => `${location.origin}${location.pathname}#post=${id}`

// turn database errors into something a student can act on
export function friendly(error) {
  const m = String(error?.message || error || '')
  if (/too fast/i.test(m)) return m
  if (/Could not find the function|schema cache/i.test(m)) return 'Database is out of date. Re-run supabase-setup.sql in Supabase.'
  if (/no longer exists/i.test(m)) return 'That post was deleted.'
  if (/row-level security|permission denied|violates row/i.test(m)) return 'You are not allowed to do that.'
  if (/violates check constraint/i.test(m)) return 'That text is empty or too long.'
  if (/JWT|expired/i.test(m)) return 'Your session expired. Please sign in again.'
  if (/Failed to fetch|NetworkError/i.test(m)) return 'No connection. Check your internet and try again.'
  return m || 'Something went wrong.'
}
const must = ({ data, error }) => { if (error) throw new Error(friendly(error)); return data }

// ---------- reading ----------
async function profilesFor(ids) {
  const list = [...new Set(ids.filter(Boolean))]
  if (!list.length) return {}
  const rows = must(await sb.from('profiles').select('user_id,display_name,avatar_url,school').in('user_id', list)) || []
  return Object.fromEntries(rows.map(p => [p.user_id, p]))
}

// One page of the feed. { before: iso date } pages backwards, { authorId } = one student's posts, { id } = a single post.
export async function fetchFeed({ before, authorId, id, me, q: text, pinned } = {}) {
  let q = sb.from('posts_feed').select('*').order('created_at', { ascending: false }).limit(PAGE + 1)
  if (pinned) q = q.eq('is_pinned', true).limit(3)   // pinned announcements sit above the feed
  if (before) q = q.lt('created_at', before)
  if (authorId) { q = q.eq('user_id', authorId); if (authorId !== me) q = q.eq('is_anonymous', false) }   // someone else's profile never lists anonymous posts
  if (id) q = q.eq('id', id)
  if (text) q = q.ilike('body', `%${String(text).replace(/[%_\\]/g, '\\$&')}%`)
  const rows = must(await q) || []
  const hasMore = rows.length > PAGE
  const posts = rows.slice(0, PAGE)
  if (!posts.length) return { posts: [], hasMore: false }

  const ids = posts.map(p => p.id)
  const originIds = [...new Set(posts.map(p => p.shared_from).filter(Boolean))]
  const [origins, reacts, comments] = await Promise.all([
    originIds.length ? sb.from('posts_feed').select('*').in('id', originIds).then(must) : [],
    sb.from('post_reactions').select('post_id,user_id,emoji').in('post_id', ids).then(must),
    sb.from('post_comments_feed').select('post_id').in('post_id', ids).then(must),
  ])
  const originMap = Object.fromEntries((origins || []).map(o => [o.id, o]))
  const people = await profilesFor([...posts.map(p => p.user_id), ...(origins || []).map(o => o.user_id)])   // anonymous rows have a null user_id here, so they are skipped

  const counts = {}, mine = {}, nComments = {}
  for (const r of reacts || []) { (counts[r.post_id] ||= {})[r.emoji] = ((counts[r.post_id] || {})[r.emoji] || 0) + 1; if (r.user_id === me) mine[r.post_id] = r.emoji }
  for (const c of comments || []) nComments[c.post_id] = (nComments[c.post_id] || 0) + 1

  return {
    hasMore,
    posts: posts.map(p => {
      const o = p.shared_from ? originMap[p.shared_from] : null
      const c = counts[p.id] || {}
      return {
        ...p, author: authorFor(people, p),
        original: o ? { ...o, author: authorFor(people, o) } : null,
        reactions: { counts: c, mine: mine[p.id] || null, total: Object.values(c).reduce((a, b) => a + b, 0) },
        commentCount: nComments[p.id] || 0,
      }
    }),
  }
}

export async function fetchComments(postId, me) {
  const rows = must(await sb.from('post_comments_feed').select('*').eq('post_id', postId).order('created_at', { ascending: true }).limit(400)) || []
  const people = await profilesFor(rows.map(r => r.user_id))
  const ids = rows.map(r => r.id)
  const reacts = ids.length ? (must(await sb.from('comment_reactions').select('comment_id,user_id,emoji').in('comment_id', ids)) || []) : []
  const counts = {}, mine = {}
  for (const r of reacts) {
    const c = (counts[r.comment_id] ||= {})
    c[r.emoji] = (c[r.emoji] || 0) + 1
    if (r.user_id === me) mine[r.comment_id] = r.emoji
  }
  return rows.map(r => {
    const c = counts[r.id] || {}
    return { ...r, author: authorFor(people, r), reactions: { counts: c, mine: mine[r.id] || null, total: Object.values(c).reduce((a, b) => a + b, 0) } }
  })
}

// stats come from the server (it checks "show my stats" and computes them, so they can't be faked)
export async function fetchStats(userId) {
  const { data, error } = await sb.rpc('get_user_stats', { _uid: userId, _tz: tz() })
  if (error) throw new Error(friendly(error))
  return data || null
}

// contribution points also come from the server (it checks "show my contributions")
export async function fetchContributions(userId) {
  const { data, error } = await sb.rpc('get_user_contributions', { _uid: userId })
  if (error) throw new Error(friendly(error))
  return data || null
}

// ---------- writing ----------
// announcement = { title, video (public url), pinned }: admins only (the database refuses anyone else). It is stored as anonymous, so the author stays hidden.
export async function createPost({ me, body = '', attachStats = false, statsLayout = 'compact', anonymous = false, images = [], sharedFrom = null, announcement = null, mentions = [] }) {
  const text = body.trim(), title = String(announcement?.title || '').trim()
  if (text.length > MAX_POST) throw new Error(`Posts can be up to ${MAX_POST} characters.`)
  if (title.length > MAX_TITLE) throw new Error(`Titles can be up to ${MAX_TITLE} characters.`)
  if (!text && !title && !attachStats && !sharedFrom && !images.length && !announcement?.video) throw new Error('Write something or add a photo first.')
  let row = { user_id: me, body: text, stats: attachStats ? { tz: tz() } : null, stats_layout: STAT_LAYOUTS[statsLayout] ? statsLayout : 'compact', is_anonymous: !!anonymous, images, shared_from: sharedFrom, mentions: cleanMentions(mentions) }   // the server replaces `stats` with the real numbers
  if (announcement) row = { ...row, stats: null, shared_from: null, is_anonymous: true, is_announcement: true, title, video_url: announcement.video || null, is_pinned: !!announcement.pinned }
  return must(await sb.from('posts').insert(row).select('*').single())
}
export async function updatePost(id, body, allowEmpty = false, title, mentions) {   // allowEmpty: posts that carry stats or are reposts may have no text; title: announcements only
  const text = body.trim()
  if (!text && !allowEmpty) throw new Error('A post can’t be empty. Delete it instead.')
  if (text.length > MAX_POST) throw new Error(`Posts can be up to ${MAX_POST} characters.`)
  if (title !== undefined && title.trim().length > MAX_TITLE) throw new Error(`Titles can be up to ${MAX_TITLE} characters.`)
  const patch = title === undefined ? { body: text } : { body: text, title: title.trim() }
  if (mentions !== undefined) patch.mentions = cleanMentions(mentions)
  const { data, error } = await sb.from('posts').update(patch).eq('id', id).select('*')
  if (error) throw new Error(friendly(error))
  if (!data?.length) throw new Error('You are not allowed to edit this post.')
  return data[0]
}
export async function deletePost(id, post) {   // pass the post so an announcement's video file is removed too
  const { data, error } = await sb.from('posts').delete().eq('id', id).select('id')
  if (error) throw new Error(friendly(error))
  if (!data?.length) throw new Error('You are not allowed to delete this post, or it is already gone.')
  if (post?.video_url) removePostVideo(post.video_url)?.catch?.(() => {})
}
export async function setPinned(id, pinned) {   // owner admin only (the database ignores it for anyone else)
  const { data, error } = await sb.from('posts').update({ is_pinned: !!pinned }).eq('id', id).select('id,is_pinned')
  if (error) throw new Error(friendly(error))
  if (!data?.length) throw new Error('You are not allowed to pin this post.')
  return data[0].is_pinned
}
// kind = 'like' | ... | null (remove)
export async function setReaction(postId, me, kind) {
  if (kind && !REACTIONS[kind]) throw new Error('Unknown reaction.')
  if (kind) must(await sb.from('post_reactions').upsert({ post_id: postId, user_id: me, emoji: kind }, { onConflict: 'post_id,user_id' }))
  else must(await sb.from('post_reactions').delete().eq('post_id', postId).eq('user_id', me))
}
export async function setCommentReaction(commentId, me, kind) {
  if (kind && !REACTIONS[kind]) throw new Error('Unknown reaction.')
  if (kind) must(await sb.from('comment_reactions').upsert({ comment_id: commentId, user_id: me, emoji: kind }, { onConflict: 'comment_id,user_id' }))
  else must(await sb.from('comment_reactions').delete().eq('comment_id', commentId).eq('user_id', me))
}
export async function addComment(postId, me, body, anonymous = false, parentId = null, mentions = [], images = []) {
  const text = body.trim()
  if (!text && !images.length) throw new Error('Write a comment or add a photo first.')
  if (text.length > MAX_COMMENT) throw new Error(`Comments can be up to ${MAX_COMMENT} characters.`)
  return must(await sb.from('post_comments').insert({ post_id: postId, user_id: me, body: text, images, is_anonymous: !!anonymous, parent_id: parentId, mentions: cleanMentions(mentions) }).select('*').single())
}
export async function updateComment(id, body, mentions) {
  const text = body.trim()
  if (!text) throw new Error('A comment can’t be empty. Delete it instead.')
  const patch = { body: text }
  if (mentions !== undefined) patch.mentions = cleanMentions(mentions)
  const { data, error } = await sb.from('post_comments').update(patch).eq('id', id).select('*')
  if (error) throw new Error(friendly(error))
  if (!data?.length) throw new Error('You are not allowed to edit this comment.')
  return data[0]
}
export async function deleteComment(id) {
  const { data, error } = await sb.rpc('delete_comment', { _id: id })   // server checks: writer, post owner or admin
  if (error) throw new Error(friendly(error))
  if (!data) throw new Error('You are not allowed to delete this comment.')
}

// live updates: calls onChange (debounced) when anyone posts, comments or reacts
export function subscribeFeed(onChange) {
  let t
  const ping = () => { clearTimeout(t); t = setTimeout(onChange, 500) }
  const ch = sb.channel('feed-' + Math.random().toString(36).slice(2, 7))
  for (const table of ['posts', 'post_comments', 'post_reactions', 'comment_reactions']) ch.on('postgres_changes', { event: '*', schema: 'public', table }, ping)
  ch.subscribe()
  return () => { clearTimeout(t); sb.removeChannel(ch) }
}
