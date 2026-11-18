// In-memory stand-in for the parts of supabase-js this app uses. It does NOT simulate RLS; it exists so flows and UI can be tested offline.
export function createFake(seed = {}) {
  const db = { tables: {}, files: {}, tokens: {}, listeners: [], rpc: {}, triggers: {}, user: null, log: [], failNext: null }
  for (const [t, rows] of Object.entries(seed.tables || {})) db.tables[t] = rows.map(r => ({ ...r }))
  Object.assign(db.files, seed.files || {}); Object.assign(db.tokens, seed.tokens || {})
  const T = n => (db.tables[n] ||= [])
  const uuid = () => (globalThis.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => ((Math.random() * 16) | 0).toString(16)))
  const emit = (table, eventType, nw, old) => db.listeners.filter(l => l.table === table).forEach(l => (l.event === '*' || l.event === eventType) && l.cb({ eventType, new: nw, old, table }))
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

  class Q {
    constructor(t) { this.t = t; this.op = 'select'; this.f = []; this.o = null; this.l = null; this.r = null; this.mode = 'many'; this.ret = false; this.opts = {} }
    select(_c, opts = {}) { if (this.op === 'select') this.opts = opts; else this.ret = true; return this }
    insert(p) { this.op = 'insert'; this.p = p; return this }
    update(p) { this.op = 'update'; this.p = p; return this }
    upsert(p, o = {}) { this.op = 'upsert'; this.p = p; this.conflict = (o.onConflict || 'id').split(','); return this }
    delete() { this.op = 'delete'; return this }
    eq(c, v) { this.f.push(r => r[c] === v); return this }
    neq(c, v) { this.f.push(r => r[c] !== v); return this }
    in(c, a) { this.f.push(r => a.includes(r[c])); return this }
    gte(c, v) { this.f.push(r => r[c] >= v); return this }
    lt(c, v) { this.f.push(r => r[c] < v); return this }
    is(c, v) { this.f.push(r => r[c] === v); return this }
    order(c, { ascending = true } = {}) { this.o = [c, ascending]; return this }
    limit(n) { this.l = n; return this }
    range(a, b) { this.r = [a, b]; return this }
    maybeSingle() { this.mode = 'maybe'; return this }
    single() { this.mode = 'single'; return this }
    then(res, rej) { return this.exec().then(res, rej) }
    async exec() {
      if (db.failNext && db.failNext.table === this.t) { const e = db.failNext; db.failNext = null; return { data: null, error: { message: e.message } } }
      db.log.push(`${this.op} ${this.t}`)
      const rows = T(this.t), match = r => this.f.every(fn => fn(r))
      const done = (list, count) => {
        if (this.mode === 'maybe') return { data: list[0] || null, error: null }
        if (this.mode === 'single') return list.length ? { data: list[0], error: null } : { data: null, error: { message: 'No rows' } }
        return { data: list, error: null, count }
      }
      if (this.op === 'select') {
        let out = rows.filter(match)
        if (this.o) out = [...out].sort((a, b) => cmp(a[this.o[0]], b[this.o[0]]) * (this.o[1] ? 1 : -1))
        const count = out.length
        if (this.r) out = out.slice(this.r[0], this.r[1] + 1)
        if (this.l != null) out = out.slice(0, this.l)
        if (this.opts.head) return { data: null, error: null, count }
        return done(out.map(r => ({ ...r })), count)
      }
      if (this.op === 'insert' || this.op === 'upsert') {
        const made = []
        for (const p of [].concat(this.p)) {
          let row = { ...p }, old = null
          if (this.op === 'upsert') { old = rows.find(r => this.conflict.every(k => r[k] === row[k])); if (old) { Object.assign(old, row); emit(this.t, 'UPDATE', { ...old }, null); made.push({ ...old }); continue } }
          if (['posts', 'post_comments', 'reviewer_requests', 'events', 'personal_events', 'announcements'].includes(this.t) && !row.id) row.id = uuid()
          row.created_at ||= new Date().toISOString()
          if (db.triggers[this.t]) { try { row = db.triggers[this.t]('INSERT', row, null, db) } catch (e) { return { data: null, error: { message: e.message } } } }
          rows.push(row); made.push({ ...row }); emit(this.t, 'INSERT', { ...row }, null)
        }
        return this.ret ? done(made) : { data: null, error: null }
      }
      if (this.op === 'update') {
        const hit = rows.filter(match), out = []
        for (const r of hit) { const old = { ...r }; let nw = { ...r, ...this.p }; if (db.triggers[this.t]) nw = db.triggers[this.t]('UPDATE', nw, old, db); Object.assign(r, nw); out.push({ ...r }); emit(this.t, 'UPDATE', { ...r }, old) }
        return this.ret ? done(out) : { data: null, error: null }
      }
      if (this.op === 'delete') {
        const hit = rows.filter(match); db.tables[this.t] = rows.filter(r => !hit.includes(r))
        for (const r of hit) { emit(this.t, 'DELETE', null, { ...r }); db.onDelete?.(this.t, r) }
        return this.ret ? done(hit.map(r => ({ ...r }))) : { data: null, error: null }
      }
    }
  }

  const client = {
    from: t => new Q(t),
    rpc: async (name, args) => (db.rpc[name] ? { data: await db.rpc[name](args, db), error: null } : { data: null, error: { message: `no rpc ${name}` } }),
    auth: {
      getUser: async jwt => (db.tokens[jwt] ? { data: { user: db.tokens[jwt] }, error: null } : { data: { user: null }, error: { message: 'bad jwt' } }),
      getSession: async () => ({ data: { session: db.user ? { user: db.user, access_token: 'tok-' + db.user.id } : null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => {}, signInWithOAuth: async () => ({ error: null }),
      signInWithPassword: async () => ({ data: { session: null }, error: null }),
      signUp: async () => ({ data: { session: null, user: { id: uuid() } }, error: null }),
    },
    storage: {
      from: bucket => ({
        download: async path => { const f = db.files[`${bucket}/${path}`]; return f ? { data: { size: f.size ?? f.data.length, arrayBuffer: async () => Uint8Array.from(f.data).buffer }, error: null } : { data: null, error: { message: 'not found' } } },
        upload: async (path, blob) => { db.files[`${bucket}/${path}`] = { data: [], size: blob.size || 0 }; return { error: null } },
        getPublicUrl: path => ({ data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
        createSignedUrl: async path => ({ data: { signedUrl: `https://signed/${path}` }, error: null }),
        remove: async () => ({ error: null }),
      }),
    },
    channel: () => { const mine = []; const ch = { on(_t, f, cb) { const l = { table: f.table, event: f.event, cb }; mine.push(l); db.listeners.push(l); return ch }, subscribe() { return ch }, _mine: mine }; return ch },
    removeChannel: ch => { db.listeners = db.listeners.filter(l => !ch._mine.includes(l)) },
  }
  return { client, db }
}
