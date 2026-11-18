import { createClient } from '@supabase/supabase-js'

export const supabaseUrl = () => process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
export const envProblem = () =>
  !supabaseUrl() || !process.env.SUPABASE_SERVICE_ROLE_KEY || !(process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY)
    ? 'Server is missing environment variables (SUPABASE_SERVICE_ROLE_KEY and GEMINI_API_KEY, or GROQ_API_KEY).' : ''

// service-role client: bypasses RLS, so it must only be used after the caller has been verified
export const makeDb = () => createClient(supabaseUrl(), process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
