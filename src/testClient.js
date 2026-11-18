// TEST MODE ONLY. A tiny in-browser stand-in for Supabase so the app can be tried with NO internet and NO live database.
// It is switched on by START-TEST.bat (VITE_TEST_MODE=1) and only inside `npm run dev`; a production build can never use it.
// Everything lives in memory: refresh the page and the sample data resets. Nothing is ever sent anywhere.

import { SAMPLE_CONTENT, renderReviewer } from './render.js'
import { computeScore, profilePoints } from './challengeLogic.js'

const ME = 'test-user-1'
const ago = (min) => new Date(Date.now() - min * 60000).toISOString()
const uuid = () => (globalThis.crypto?.randomUUID?.() || 'id-' + Math.random().toString(36).slice(2, 10))

export const TEST_USER = {
  id: ME, email: 'student@aralab.test', aud: 'authenticated', role: 'authenticated',
  user_metadata: { full_name: 'Test Student' }, app_metadata: { provider: 'email' },
}

const SCHOOL = 'Polytechnic University of the Philippines'
const people = [
  { user_id: ME, display_name: 'Test Student', avatar_url: '', onboarded: true, school: SCHOOL, program: 'BS Education', institute: '', bio: 'Testing AraLab on my phone.', weekly_goal: 5, banned: false, ban_reason: '', temp_ban_until: null, student_no: 'S26-000001', show_stats: true, show_contributions: true },
  { user_id: 'u2', display_name: 'Maria Santos', avatar_url: '', onboarded: true, school: SCHOOL, program: 'BS Education', bio: 'Study notes every night.', student_no: 'S26-000002', show_stats: true, show_contributions: true },
  { user_id: 'u3', display_name: 'Juan Dela Cruz', avatar_url: '', onboarded: true, school: 'University of the Philippines Diliman', program: 'BS Biology', bio: '', student_no: 'S26-000003', show_stats: true, show_contributions: true },
  { user_id: 'u4', display_name: 'Aira Reyes', avatar_url: '', onboarded: true, school: SCHOOL, program: 'BS Nursing', bio: '', student_no: 'S26-000004', show_stats: true, show_contributions: true },
]

const html = t => `<!doctype html><html><head><title>${t}</title><style>body{font-family:system-ui;padding:20px;line-height:1.5}</style></head><body><h1>${t}</h1><p>Sample reviewer used for testing.</p></body></html>`
const reviewers = [
  ['Professional Education: Principles of Teaching', 'ProfEd', 'ME'], ['General Education: Philippine History', 'GenEd', 'u2'],
  ['Anatomy & Physiology: Cardiovascular system', 'Science', 'u4'], ['Research Methods cheat sheet', 'Research', ME],
].map(([title, subject, owner_id], i) => {
  // v70: sample reviewers carry real content and use the same Study Flow design as the app
  const template = 'studyflow', theme = ['indigo', 'forest', 'sunset', 'indigo'][i], content = { ...SAMPLE_CONTENT, title }
  return { id: 'rv' + (i + 1), title, subject, size: 18000 + i * 4000, added: ago(i === 3 ? 60 * 24 * 8 : 60 * (i + 1) * 5), is_public: true, owner_id: owner_id === 'ME' ? ME : owner_id, removed_at: null, removed_reason: null, text: title.toLowerCase(), html: renderReviewer(content, template, theme), content, template, theme }
})

const notifications = [
  { id: 'n1', user_id: ME, kind: 'comment', text: 'Maria Santos commented on your post: “Thanks for sharing this reviewer!”', ref: 'p1', actor_id: 'u2', read_at: null, created_at: ago(3) },
  { id: 'n2', user_id: ME, kind: 'star', text: 'Aira Reyes starred your reviewer “Research Methods cheat sheet”.', ref: 'rv4', actor_id: 'u4', read_at: null, created_at: ago(42) },
  { id: 'n3', user_id: ME, kind: 'follow', text: 'Juan Dela Cruz started following you.', ref: null, actor_id: 'u3', read_at: null, created_at: ago(190) },
  { id: 'n4', user_id: ME, kind: 'mention', text: 'Maria Santos mentioned you in a post.', ref: 'p1', actor_id: 'u2', read_at: ago(1000), created_at: ago(1500) },
  { id: 'n5', user_id: ME, kind: 'visits', text: 'Your reviewer reached 25 students who studied it.', ref: 'rv4', actor_id: null, read_at: ago(3000), created_at: ago(3200) },
]

const posts = [
  { id: 'p1', user_id: 'u2', body: 'Just finished my Principles of Teaching review. Who wants to study together tonight?', created_at: ago(55), is_anonymous: false, is_pinned: false, is_announcement: false, shared_from: null, anon_alias: null, is_mine: false },
  { id: 'p2', user_id: ME, body: 'Testing the new mobile layout of AraLab.', created_at: ago(300), is_anonymous: false, is_pinned: false, is_announcement: false, shared_from: null, anon_alias: null, is_mine: true },
]

const seedTables = () => ({
  profiles: people.map(p => ({ ...p })), reviewers: reviewers.map(r => ({ ...r })), notifications: notifications.map(n => ({ ...n })),
  posts_feed: posts.map(p => ({ ...p })), posts: posts.map(p => ({ ...p })), post_reactions: [{ post_id: 'p1', user_id: 'u3', emoji: 'like' }],
  post_comments_feed: [], post_comments: [], follows: [{ follower: ME, followee: 'u2' }], school_follows: [],
  reviewer_stats: reviewers.map((r, i) => ({ reviewer_id: r.id, visitors: 12 + i * 7, stars: 2 + i, visitor_faces: [] })),
  state_universities: [{ name: SCHOOL, active: true }, { name: 'University of the Philippines Diliman', active: true }],
  quiz_attempts: [{ user_id: 'u2', reviewer_id: 'rv1', correct: 9, total: 10, seconds: 60, score: 86, points: 17, at: ago(30) }, { user_id: 'u3', reviewer_id: 'rv1', correct: 7, total: 10, seconds: 90, score: 62, points: 12, at: ago(60 * 30) }, { user_id: 'u4', reviewer_id: 'rv1', correct: 10, total: 10, seconds: 45, score: 100, points: 20, at: ago(60 * 24 * 40) }],
  astra_members: [], admins: [], astra_guides: [], reviewer_requests: [], reviewer_flags: [], reviewer_stars: [], reviewer_collection: [], study_log: [], personal_events: [],
})

export function createTestClient() {
  const tables = seedTables(), listeners = []
  const T = n => (tables[n] ||= [])
  const emit = (table, eventType, nw) => listeners.filter(l => l.table === table && (l.event === '*' || l.event === eventType)).forEach(l => l.cb({ eventType, new: nw, table }))
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

  class Q {
    constructor(t) { this.t = t; this.op = 'select'; this.f = []; this.o = null; this.l = null; this.r = null; this.mode = 'many'; this.head = false }
    select(_c, o = {}) { if (this.op === 'select') this.head = !!o.head; return this }
    insert(p) { this.op = 'insert'; this.p = p; return this }
    update(p) { this.op = 'update'; this.p = p; return this }
    upsert(p, o = {}) { this.op = 'upsert'; this.p = p; this.key = (o.onConflict || 'id').split(',').map(s => s.trim()); return this }
    delete() { this.op = 'delete'; return this }
    eq(c, v) { this.f.push(r => r[c] === v); return this }
    neq(c, v) { this.f.push(r => r[c] !== v); return this }
    in(c, a) { this.f.push(r => a.includes(r[c])); return this }
    is(c, v) { this.f.push(r => (v === null ? r[c] == null : r[c] === v)); return this }
    gte(c, v) { this.f.push(r => r[c] >= v); return this }
    gt(c, v) { this.f.push(r => r[c] > v); return this }
    lte(c, v) { this.f.push(r => r[c] <= v); return this }
    lt(c, v) { this.f.push(r => r[c] < v); return this }
    not(c, op, v) { if (op === 'is') this.f.push(r => (v === null ? r[c] != null : r[c] !== v)); else if (op === 'eq') this.f.push(r => r[c] !== v); return this }
    or() { return this }
    match(o) { this.f.push(r => Object.entries(o).every(([k, v]) => r[k] === v)); return this }
    like(c, v) { return this.ilike(c, v) }
    contains() { return this }
    ilike(c, v) { const s = String(v).replace(/%/g, '').toLowerCase(); this.f.push(r => String(r[c] ?? '').toLowerCase().includes(s)); return this }
    order(c, { ascending = true } = {}) { this.o = [c, ascending]; return this }
    limit(n) { this.l = n; return this }
    range(a, b) { this.r = [a, b]; return this }
    maybeSingle() { this.mode = 'maybe'; return this }
    single() { this.mode = 'single'; return this }
    then(res, rej) { return this.exec().then(res, rej) }
    async exec() {
      const rows = T(this.t), match = r => this.f.every(fn => fn(r))
      const done = (list, count) => this.mode === 'maybe' ? { data: list[0] || null, error: null }
        : this.mode === 'single' ? (list.length ? { data: list[0], error: null } : { data: null, error: { message: 'No rows' } })
        : { data: list, error: null, count }
      if (this.op === 'select') {
        let out = rows.filter(match)
        if (this.o) out = [...out].sort((a, b) => cmp(a[this.o[0]], b[this.o[0]]) * (this.o[1] ? 1 : -1))
        const count = out.length
        if (this.r) out = out.slice(this.r[0], this.r[1] + 1)
        if (this.l != null) out = out.slice(0, this.l)
        return this.head ? { data: null, error: null, count } : done(out.map(r => ({ ...r })), count)
      }
      if (this.op === 'insert' || this.op === 'upsert') {
        const made = []
        for (const p of [].concat(this.p)) {
          const row = { id: uuid(), created_at: new Date().toISOString(), ...p }
          const old = this.op === 'upsert' ? rows.find(r => this.key.every(k => r[k] === row[k])) : null
          if (old) { Object.assign(old, p); made.push({ ...old }); emit(this.t, 'UPDATE', { ...old }); continue }
          rows.push(row); made.push({ ...row }); emit(this.t, 'INSERT', { ...row })
        }
        return done(made)
      }
      if (this.op === 'update') { const hit = rows.filter(match); hit.forEach(r => { Object.assign(r, this.p); emit(this.t, 'UPDATE', { ...r }) }); return done(hit.map(r => ({ ...r }))) }
      if (this.op === 'delete') { const hit = rows.filter(match); tables[this.t] = rows.filter(r => !hit.includes(r)); return done(hit) }
    }
  }

  // Auth: always signed in as the test student.
  const session = { user: TEST_USER, access_token: 'test-token' }
  const client = {
    from: t => new Q(t),
    rpc: async (name, args = {}) => {
      if (name === 'submit_quiz_attempt') {   // same rules as the SQL function
        const mine = T('quiz_attempts').filter(r => r.user_id === ME && r.reviewer_id === args._reviewer)
        const best = mine.reduce((m, r) => Math.max(m, r.score), 0), got = mine.reduce((s, r) => s + r.points, 0)
        const score = computeScore({ correct: args._correct, total: args._total, seconds: args._seconds })
        const points = profilePoints({ score, best, awarded: got })
        T('quiz_attempts').push({ user_id: ME, reviewer_id: args._reviewer, correct: args._correct, total: args._total, seconds: args._seconds, score, points, at: new Date().toISOString() })
        return { data: { score, points, best_before: best, best: Math.max(best, score), seconds: args._seconds }, error: null }
      }
      if (name === 'quiz_leaderboard') {
        const d0 = new Date(); d0.setHours(0, 0, 0, 0); const m0 = new Date(d0.getFullYear(), d0.getMonth(), 1)
        const since = args._period === 'today' ? d0 : args._period === 'month' ? m0 : new Date(0)
        const by = {}
        for (const r of T('quiz_attempts').filter(r => r.reviewer_id === args._reviewer && new Date(r.at) >= since)) { const b = (by[r.user_id] ||= { best: r, n: 0 }); b.n++; if (r.score > b.best.score || (r.score === b.best.score && r.seconds < b.best.seconds)) b.best = r }
        const rows = Object.values(by).sort((a, b) => b.best.score - a.best.score || a.best.seconds - b.best.seconds)
        return { data: rows.map((b, i) => { const p = people.find(x => x.user_id === b.best.user_id) || {}; return { rank: i + 1, user_id: b.best.user_id, display_name: p.display_name, avatar_url: '', school: p.school, score: b.best.score, seconds: b.best.seconds, attempts: b.n, is_me: b.best.user_id === ME } }), error: null }
      }
      const d = new Date(), day = i => { const x = new Date(d - i * 864e5); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
      const data = name === 'get_user_stats'
        ? { streak: 3, week: 5400, total: 36000, goal: 5, opened: 4, top_subject: 'ProfEd', today: 900, days: [6, 5, 4, 3, 2, 1, 0].map(i => ({ day: day(i), secs: i % 3 ? 1200 : 2400 })), subjects: [{ subject: 'ProfEd', secs: 18000 }, { subject: 'GenEd', secs: 9000 }] }
        : name === 'get_user_contributions' ? { quiz_points: 12, quiz_attempts: 2, points: 187, seconds: 36000, reviewers: 1, reviewer_points: 50, study_hours: 10, study_points: 100, flags: 1, flag_points: 25 }
        : name === 'school_directory' ? [] : null
      return { data, error: null }
    },
    auth: {
      getSession: async () => ({ data: { session } }),
      getUser: async () => ({ data: { user: TEST_USER }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => { location.reload(); return {} }, signInWithOAuth: async () => ({ error: null }),
      signInWithPassword: async () => ({ data: { session }, error: null }), signUp: async () => ({ data: { session, user: TEST_USER }, error: null }),
    },
    storage: { from: bucket => ({
      upload: async () => ({ error: null }), download: async () => ({ data: null, error: { message: 'test mode: no files' } }),
      getPublicUrl: p => ({ data: { publicUrl: `data:image/gif;base64,R0lGODlhAQABAAAAACw=#${bucket}/${p}` } }),
      createSignedUrl: async () => ({ data: { signedUrl: '' }, error: null }), remove: async () => ({ error: null }),
    }) },
    channel: () => { const mine = []; const ch = { on(_t, f, cb) { const l = { table: f.table, event: f.event, cb }; mine.push(l); listeners.push(l); return ch }, subscribe() { return ch }, _mine: mine }; return ch },
    removeChannel: ch => { ch?._mine?.forEach(l => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1) }) },
  }

  // Console helper: window.__testNotify('Hello') pushes a live notification (shows the toast + bell badge).
  if (typeof window !== 'undefined') window.__testNotify = (text = 'This is a live test notification.', kind = 'comment') => {
    const n = { id: uuid(), user_id: ME, kind, text, ref: 'p1', actor_id: 'u2', read_at: null, created_at: new Date().toISOString() }
    T('notifications').push(n); emit('notifications', 'INSERT', { ...n })
  }
  return client
}
