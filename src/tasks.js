// v77: cancellable background tasks shown as toast cards (Create reviewer, Classroom builds, video download, transcribing).
// startTask(label) -> { signal, update(line, pct), done(msg), fail(msg), onCancel(fn), cancelled() }.
// Pressing Cancel on the toast aborts `signal` (stops downloads, uploads and the AI request) and runs the onCancel cleanup.
import { useEffect, useState } from 'react'

let tasks = [], seq = 0
const subs = new Set()
const snap = () => tasks.map(({ ctl, cleanup, ...t }) => t)
const emit = () => { const s = snap(); subs.forEach(f => f(s)) }
const find = id => tasks.find(t => t.id === id)
const drop = (id, ms) => setTimeout(() => dismissTask(id), ms)

export const cancelError = (m = 'Cancelled') => Object.assign(new Error(m), { cancelled: true, name: 'Cancelled' })
export const isCancel = e => !!(e && (e.cancelled || e.name === 'AbortError' || e.name === 'Cancelled'))
export const throwIfCancelled = signal => { if (signal?.aborted) throw cancelError() }

export function dismissTask(id) { tasks = tasks.filter(t => t.id !== id); emit() }

export function startTask(label) {
  const ctl = new AbortController()
  const t = { id: ++seq, label, line: '', pct: null, status: 'running', msg: '', ctl, cleanup: null }
  tasks = [...tasks, t]; emit()
  const live = () => find(t.id)
  const finish = (status, msg, ms) => { const x = live(); if (!x || x.status === 'cancelled') return; x.status = status; x.msg = msg || ''; x.pct = status === 'done' ? 100 : x.pct; emit(); if (ms) drop(t.id, ms) }
  return {
    id: t.id,
    signal: ctl.signal,
    cancelled: () => ctl.signal.aborted,
    update: (line, pct) => { const x = live(); if (x && x.status === 'running') { if (line != null) x.line = line; if (typeof pct === 'number') x.pct = Math.max(0, Math.min(100, Math.round(pct))); emit() } },
    onCancel: fn => { const x = live(); if (x) x.cleanup = fn },
    done: msg => finish('done', msg, 4200),
    fail: msg => finish('error', msg, 9000),
    close: () => dismissTask(t.id),
  }
}

// Called by the Cancel button: stop everything now, then let the owner of the task clean up (delete a half-made request, etc.).
export async function cancelTask(id) {
  const x = find(id)
  if (!x || x.status !== 'running') return
  x.status = 'cancelling'; x.line = 'Cancelling…'; emit()
  try { x.ctl.abort() } catch { /* ignore */ }
  try { await x.cleanup?.() } catch { /* the cleanup is best-effort */ }
  const y = find(id)
  if (y) { y.status = 'cancelled'; y.msg = 'Cancelled. Nothing was added to your Library.'; emit(); drop(id, 3500) }
}

export function useTasks() {
  const [l, setL] = useState([])
  useEffect(() => { subs.add(setL); setL(snap()); return () => { subs.delete(setL) } }, [])
  return l
}
if (typeof window !== 'undefined') window.addEventListener('beforeunload', e => { if (tasks.some(t => t.status === 'running')) { e.preventDefault(); e.returnValue = '' } })
