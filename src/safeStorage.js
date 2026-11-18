// v84: some in-app browsers (and private modes) throw when the page touches localStorage / sessionStorage, which used to blank the whole app.
// If storage is not usable we put a simple in-memory stand-in in its place, so every later read/write just works for this visit.
function memory() {
  const m = new Map()
  return { getItem: k => (m.has(String(k)) ? m.get(String(k)) : null), setItem: (k, v) => { m.set(String(k), String(v)) }, removeItem: k => { m.delete(String(k)) }, clear: () => m.clear(), key: i => [...m.keys()][i] ?? null, get length() { return m.size } }
}
for (const name of ['localStorage', 'sessionStorage']) {
  let ok = true
  try { const s = window[name]; const k = '__rl_t'; s.setItem(k, '1'); s.removeItem(k) } catch { ok = false }
  if (!ok) { try { Object.defineProperty(window, name, { value: memory(), configurable: true }) } catch { /* nothing more we can do */ } }
}
