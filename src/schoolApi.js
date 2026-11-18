// "Other universities": the school list with how many students each has, and following a whole school.
import { sb } from './supabase'
import { sameSchool } from './schools'

// Schools with students (most first). With a typed search it looks through every university, even ones nobody joined yet.
// `following: true` lists only the schools you follow.
export async function fetchSchoolDirectory({ q = '', following = false, limit = 40 } = {}) {
  const { data, error } = await sb.rpc('school_directory', { _q: q, _following: following, _limit: limit })
  if (error) throw error
  return (data || []).map(r => ({ school: r.school, users: r.users || 0, followers: r.followers || 0, i_follow: !!r.i_follow }))
}
export const followSchool = (me, school) => sb.from('school_follows').insert({ follower: me, school })
export const unfollowSchool = (me, school) => sb.from('school_follows').delete().eq('follower', me).eq('school', school)

// your own school is not an "other" school
export const otherSchools = (rows, mySchool) => (rows || []).filter(r => !sameSchool(r.school, mySchool))
export const schoolDbHint = e => (/relation|schema cache|school_directory|school_follows|function/i.test(e?.message || '') ? 'The database is out of date. Ask the admin to re-run supabase-setup.sql.' : e?.message || 'Something went wrong.')
