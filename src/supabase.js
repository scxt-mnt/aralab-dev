import { createClient } from '@supabase/supabase-js'
import { createTestClient } from './testClient'
const url = import.meta.env.VITE_SUPABASE_URL, key = import.meta.env.VITE_SUPABASE_ANON_KEY
// TEST MODE: START-TEST.bat sets VITE_TEST_MODE=1. It is honoured only by `npm run dev` (never in a production build),
// and swaps Supabase for an in-memory fake that is already signed in. The live database is never contacted.
export const testMode = import.meta.env.DEV && import.meta.env.VITE_TEST_MODE === '1'
export const envMissing = !testMode && (!url || !key)
// placeholders keep the app from crashing to a blank page when .env is missing (main.jsx shows a clear message)
export const sb = testMode ? createTestClient() : createClient(url || 'https://missing.invalid', key || 'missing')
