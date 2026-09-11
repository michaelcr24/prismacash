import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { json } from './cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

export interface AuthedAdmin {
  userClient: SupabaseClient
  adminClient: SupabaseClient
  userId: string
}

/**
 * Valida el JWT del caller y exige que su perfil sea super_admin.
 * `adminClient` (service_role) se usa para todas las mutaciones.
 */
export async function authenticateSuperAdmin(
  req: Request,
): Promise<{ ok: true; value: AuthedAdmin } | { ok: false; response: Response }> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return { ok: false, response: json({ ok: false, error: 'unauthorized' }, 401) }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })

  const {
    data: { user },
    error,
  } = await userClient.auth.getUser()
  if (error || !user) return { ok: false, response: json({ ok: false, error: 'unauthorized' }, 401) }

  const { data: profile } = await userClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  if (profile?.role !== 'super_admin') return { ok: false, response: json({ ok: false, error: 'forbidden' }, 403) }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  return { ok: true, value: { userClient, adminClient, userId: user.id } }
}
