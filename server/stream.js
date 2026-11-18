// Runs an API job and, when the browser asks for it (Accept: application/x-ndjson), streams progress lines
// ({"type":"progress",...}) followed by one {"type":"done",status,body}. Otherwise behaves like a plain JSON API.
export async function respond(req, res, run) {
  if (!/ndjson/.test(req.headers.accept || '')) { const r = await run(() => {}); return res.status(r.status).json(r.body) }
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8'); res.setHeader('Cache-Control', 'no-cache, no-transform'); res.setHeader('X-Accel-Buffering', 'no')
  const send = o => { try { res.write(JSON.stringify(o) + '\n') } catch { /* client left */ } }
  send({ type: 'progress', stage: 'start' })
  let r
  try { r = await run(e => send({ type: 'progress', ...e })) } catch (e) { r = { status: 500, body: { error: String(e.message || e) } } }
  send({ type: 'done', status: r.status, body: r.body }); res.end()
}
