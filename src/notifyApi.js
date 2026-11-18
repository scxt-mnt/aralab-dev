// Follow + notification data access.
import { sb } from './supabase'
export const fetchNotifs = async () => { const { data, error } = await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(40); if (error) throw error; return data || [] }
export const markRead = ids => sb.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids)
export const markAll = me => sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', me).is('read_at', null)
export function subscribeNotifs(me, onNew) {
  const ch = sb.channel('notif-' + me + Math.random().toString(36).slice(2, 6)).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${me}` }, p => onNew(p.new)).subscribe()
  return () => sb.removeChannel(ch)
}
const cnt = q => q.then(r => r.count || 0)
export async function followInfo(me, uid) {
  const head = { count: 'exact', head: true }
  const [followers, following, mine] = await Promise.all([
    cnt(sb.from('follows').select('follower', head).eq('followee', uid)),
    cnt(sb.from('follows').select('followee', head).eq('follower', uid)),
    me === uid ? 0 : cnt(sb.from('follows').select('follower', head).eq('follower', me).eq('followee', uid)),
  ])
  return { followers, following, iFollow: mine > 0 }
}
export const follow = (me, uid) => sb.from('follows').insert({ follower: me, followee: uid })
export const unfollow = (me, uid) => sb.from('follows').delete().eq('follower', me).eq('followee', uid)
