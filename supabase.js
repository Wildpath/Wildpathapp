// WildPath — Supabase connection (Phase 2 backend)
// The CDN build exposes a global `supabase` object; `db` is the app-wide client.
const SUPABASE_URL = 'https://nkrphmjzyzeplzcgndxg.supabase.co'
const SUPABASE_KEY = 'sb_publishable_Mshz4fDoqdHNlarrdqrIaQ_HnPZpDwj'
const { createClient } = supabase
const db = createClient(SUPABASE_URL, SUPABASE_KEY)
