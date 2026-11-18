// Who may generate a reviewer for a request. No imports on purpose, so it is easy to test.
// - an admin may generate any request
// - an Astra member may generate a request that is already approved, from a student of their own school
//   (and never their own request)
// -> { user, admin } or { error: { status, message } }
// v57: any signed-in user (used for small helper calls such as naming Classroom lessons).
export async function requireUser(db, authHeader) {
  const jwt = String(authHeader || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return { error: { status: 401, message: 'Not signed in.' } }
  const { data: u } = await db.auth.getUser(jwt)
  if (!u?.user) return { error: { status: 401, message: 'Not signed in.' } }
  return { user: u.user }
}

export async function requireAdmin(db, authHeader) {
  const jwt = String(authHeader || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return { error: { status: 401, message: 'Not signed in.' } }
  const { data: u } = await db.auth.getUser(jwt)
  if (!u?.user) return { error: { status: 401, message: 'Not signed in.' } }
  const { data: adm } = await db.from('admins').select('user_id').eq('user_id', u.user.id).maybeSingle()
  if (!adm) return { error: { status: 403, message: 'Admins only.' } }
  return { user: u.user, admin: true }
}

const norm = s => String(s || '').trim().toLowerCase()

export async function requireApprover(db, authHeader, targetUserId) {
  const jwt = String(authHeader || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return { error: { status: 401, message: 'Not signed in.' } }
  const { data: u } = await db.auth.getUser(jwt)
  if (!u?.user) return { error: { status: 401, message: 'Not signed in.' } }
  const { data: adm } = await db.from('admins').select('user_id').eq('user_id', u.user.id).maybeSingle()
  if (adm) return { user: u.user, admin: true }

  if (!targetUserId) return { error: { status: 403, message: 'Admins only.' } }
  if (targetUserId === u.user.id) return { error: { status: 403, message: 'You cannot generate your own request.' } }

  const [{ data: student }, { data: member }] = await Promise.all([
    db.from('profiles').select('school').eq('user_id', targetUserId).maybeSingle(),
    db.from('astra_members').select('school').eq('user_id', u.user.id).maybeSingle(),
  ])
  const school = norm(student?.school), mine = norm(member?.school)
  if (!school || !mine || school !== mine) {
    return { error: { status: 403, message: 'Only an admin or the Astra member of that student’s school can do this.' } }
  }
  return { user: u.user, admin: false, school: mine }
}

// v47: who may generate a request. Students generate their OWN requests straight away (no approval step);
// admins may generate any request (retry, support). Astra no longer approves: they monitor, pause, remove and report instead.
// -> { user, admin, self } or { error: { status, message } }
export async function requireGenerator(db, authHeader, ownerId) {
  const jwt = String(authHeader || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return { error: { status: 401, message: 'Not signed in.' } }
  const { data: u } = await db.auth.getUser(jwt)
  if (!u?.user) return { error: { status: 401, message: 'Not signed in.' } }
  const { data: adm } = await db.from('admins').select('user_id').eq('user_id', u.user.id).maybeSingle()
  if (adm) return { user: u.user, admin: true, self: ownerId === u.user.id }
  if (ownerId && ownerId === u.user.id) return { user: u.user, admin: false, self: true }
  return { error: { status: 403, message: 'You can only generate your own reviewer.' } }
}
