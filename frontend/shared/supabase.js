import { createClient } from "@supabase/supabase-js";
// временно добави в supabase.js горе
console.log(import.meta.env.VITE_SUPABASE_URL);
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
