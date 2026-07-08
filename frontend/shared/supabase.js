import { createClient } from "@supabase/supabase-js";
// временно добави в supabase.js горе
console.log(import.meta.env.VITE_SUPABASE_URL);
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;

const PROD_TURNSTILE_SITE_KEY = import.meta.env.PROD_TURNSTILE_SITE_KEY;
const TEST_TURNSTILE_SITE_KEY = import.meta.env.TEST_TURNSTILE_SITE_KEY;

export const sb = createClient(
  SUPABASE_URL,
  SUPABASE_KEY,
  PROD_TURNSTILE_SITE_KEY,
  TEST_TURNSTILE_SITE_KEY,
);
