import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Per-request client bound to the caller's auth cookie. Use for the RPC call
 * and any read that must respect RLS (the RPC needs auth.uid()).
 */
export async function createRouteSupabaseClient() {
  const cookieStore = await cookies();
  return createServerClient(URL, ANON, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(toSet) {
        for (const { name, value, options } of toSet) {
          cookieStore.set(name, value, options);
        }
      },
    },
  });
}

/**
 * Service-role client. Bypasses RLS. ONLY use inside pipelines that have already
 * called createRouteSupabaseClient() and verified the caller has the required
 * capability — never expose this to a request without prior authorization.
 */
export function createServiceRoleClient() {
  return createClient(URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
