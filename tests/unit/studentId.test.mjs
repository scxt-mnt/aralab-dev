import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync(new URL('../../supabase-setup.sql', import.meta.url), 'utf8')
const fix = readFileSync(new URL('../../fix-student-id.sql', import.meta.url), 'utf8')

// Regression (v60): the LAST profiles_guard() lost the student-ID line, so new accounts got no ID. The ID now lives in its own trigger.
test('student ID has its own trigger, created AFTER every profiles_guard() definition', () => {
  const lastGuard = sql.lastIndexOf('function public.profiles_guard()')
  const trg = sql.lastIndexOf('create trigger profiles_student_no_trg')
  assert.ok(lastGuard > 0 && trg > lastGuard, 'the student-ID trigger must come after the last guard')
  assert.match(sql, /before insert or update on public\.profiles for each row execute function public\.profiles_student_no\(\)/)
})
test('the trigger assigns on insert, never changes an existing ID, and ignores a typed-in value', () => {
  const fn = sql.slice(sql.indexOf('create or replace function public.profiles_student_no()'))
  assert.match(fn, /new\.student_no := old\.student_no/)
  assert.match(fn, /new\.student_no := public\.next_student_no\(\)/)
})
test('existing students without an ID are backfilled, and the counter is moved past the highest ID', () => {
  assert.match(sql, /update public\.profiles set display_name = display_name where student_no is null/)
  assert.match(sql, /setval\('public\.student_no_seq'/)
})
test('the standalone fix file is the same fix', () => {
  assert.ok(fix.includes('profiles_student_no_trg') && fix.includes('next_student_no()'))
})
