import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Cloudflare Turnstile ──────────────────────────────────────
// Публични sitekeys (безопасни за клиента) — идват от .env, за да не
// стоят hardcode-нати в кода. Тайният ключ НЕ живее тук — той е само
// в Supabase Dashboard → Authentication → Attack Protection.
export const TURNSTILE_PROD_KEY = import.meta.env.VITE_TURNSTILE_PROD_KEY;
export const TURNSTILE_TEST_KEY = import.meta.env.VITE_TURNSTILE_TEST_KEY;
