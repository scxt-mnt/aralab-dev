// v57: AI names for Classroom lessons. Asked once per lesson, then remembered in this browser, so the list never waits on the AI twice.
import { titleKey } from './classroomLogic'

const KEY = 'rl-gc-titles', BATCH = 25, KEEP = 1500
export function loadTitles() { try { const j = JSON.parse(localStorage.getItem(KEY) || '{}'); return j && typeof j === 'object' ? j : {} } catch { return {} } }
function saveTitles(m) {
  try { const keys = Object.keys(m); if (keys.length > KEEP) for (const k of keys.slice(0, keys.length - KEEP)) delete m[k]; localStorage.setItem(KEY, JSON.stringify(m)) } catch { /* private mode: names last until reload */ }
}

const brief = (l, i) => ({ id: String(i), title: l.title, text: l.description, course: l.courseName, files: l.files.map(f => f.title) })

// Names every lesson that has no remembered name yet. onTitles(map) is called after each batch. Never throws: the original titles stay if the AI is unavailable.
export async function nameLessons(lessons, token, have, onTitles) {
  const todo = lessons.filter(l => !have[titleKey(l)])
  let map = { ...have }
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH)
    try {
      const res = await fetch('/api/lesson-titles', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ lessons: chunk.map(brief) }) })
      if (!res.ok) { if (res.status === 401 || res.status === 429) break; continue }
      const { titles = {} } = await res.json().catch(() => ({}))
      chunk.forEach((l, n) => { const t = titles[String(n)]; if (typeof t === 'string' && t.trim()) map[titleKey(l)] = t.trim() })
      saveTitles(map); onTitles({ ...map })
    } catch { break }
  }
  return map
}
