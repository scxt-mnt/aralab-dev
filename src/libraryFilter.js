// Pure filter/sort logic for the Library (no React, no network) so it can be unit tested.
export const SCOPES = [['all', 'Titles, subjects and notes'], ['title', 'Titles only'], ['subject', 'Subjects only']]
export const WHO = [['any', 'Anyone'], ['mine', 'Mine'], ['following', 'People I follow'], ['school', 'My university'], ['admin', 'Added by the admin']]
export const WHEN = [['any', 'Any time', 0], ['7', 'Past week', 7], ['30', 'Past month', 30], ['90', 'Past 3 months', 90], ['365', 'Past year', 365]]
export const SORTS = [['new', 'Newest'], ['old', 'Oldest'], ['az', 'A to Z'], ['za', 'Z to A'], ['subject', 'Subject'], ['big', 'Largest'], ['stars', 'Most starred'], ['visits', 'Most visited']]
export const blankFilters = () => ({ q: '', scope: 'all', who: 'any', when: 'any', subject: null })

const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()
// every word must appear (any order), so "cell membrane" finds a reviewer with both words anywhere
export const words = q => norm(q).split(' ').filter(Boolean).slice(0, 8)

export function filterItems(items, f, ctx = {}) {
  const ws = words(f.q), now = ctx.now ?? Date.now()
  const days = WHEN.find(w => w[0] === f.when)?.[2] || 0
  const mySchool = norm(ctx.mySchool)
  return items.filter(i => {
    if (f.subject === '__flagged') { if (!ctx.flagCount?.[i.id]) return false }
    else if (f.subject === '__mine') { if (i.owner_id !== ctx.me) return false }
    else if (f.subject === '__collection') { if (!ctx.collection?.has(i.id)) return false }
    else if (f.subject && i.subject !== f.subject) return false
    if (f.who === 'mine' && i.owner_id !== ctx.me) return false
    if (f.who === 'admin' && i.owner_id) return false
    if (f.who === 'following' && !(i.owner_id && ctx.following?.has(i.owner_id))) return false
    if (f.who === 'school' && !(i.owner_id && mySchool && norm(ctx.people?.[i.owner_id]?.school) === mySchool)) return false
    if (days && !(i.added >= now - days * 864e5)) return false
    if (!ws.length) return true
    const hay = norm(f.scope === 'title' ? i.title : f.scope === 'subject' ? i.subject : `${i.title} ${i.subject} ${i.text}`)
    return ws.every(w => hay.includes(w))
  })
}

export function sortItems(rows, sort) {
  const cmp = {
    az: (a, b) => a.title.localeCompare(b.title), za: (a, b) => b.title.localeCompare(a.title),
    old: (a, b) => a.added - b.added, big: (a, b) => (b.size || 0) - (a.size || 0),
    subject: (a, b) => a.subject.localeCompare(b.subject) || b.added - a.added,
    stars: (a, b) => (b.stars || 0) - (a.stars || 0) || b.added - a.added, visits: (a, b) => (b.visitors || 0) - (a.visitors || 0) || b.added - a.added,
  }[sort] || ((a, b) => b.added - a.added)
  return [...rows].sort(cmp)
}

export const activeCount = f => (f.scope !== 'all') + (f.who !== 'any') + (f.when !== 'any')
