// Background upload jobs. A job keeps running while the student keeps using the app; UploadBar (top of the screen) shows progress.
import { useEffect, useState } from 'react'

let jobs = [], seq = 0
const subs = new Set()
const emit = () => subs.forEach(f => f(jobs.map(j => ({ ...j }))))
export const dismissJob = id => { jobs = jobs.filter(j => j.id !== id); emit() }
export const hasRunningJobs = () => jobs.some(j => j.status === 'running')

// task({ total(n), step() }) -> promise. Resolves/rejects with the task's result; the bar updates by itself.
export function runJob(label, task) {
  const job = { id: ++seq, label, total: 1, done: 0, status: 'running', error: '' }
  jobs = [...jobs, job]; emit()
  const live = () => jobs.find(j => j.id === job.id)
  const api = { total: n => { const j = live(); if (j) { j.total = Math.max(1, n); emit() } }, step: () => { const j = live(); if (j) { j.done = Math.min(j.total, j.done + 1); emit() } } }
  return Promise.resolve().then(() => task(api)).then(r => {
    const j = live(); if (j) { j.done = j.total; j.status = 'done'; emit(); setTimeout(() => dismissJob(job.id), 3500) }
    return r
  }).catch(e => { if (e?.cancelled) { dismissJob(job.id); throw e } const j = live(); if (j) { j.status = 'error'; j.error = e?.message || String(e); emit() } throw e })
}
export function useJobs() {
  const [l, setL] = useState([])
  useEffect(() => { subs.add(setL); setL(jobs.map(j => ({ ...j }))); return () => { subs.delete(setL) } }, [])
  return l
}
if (typeof window !== 'undefined') window.addEventListener('beforeunload', e => { if (hasRunningJobs()) { e.preventDefault(); e.returnValue = '' } })
