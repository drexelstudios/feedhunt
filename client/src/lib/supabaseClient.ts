import { createClient } from "@supabase/supabase-js";

// These are public keys — safe to expose in the frontend
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY env vars");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
