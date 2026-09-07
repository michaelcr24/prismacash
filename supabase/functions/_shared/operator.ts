import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

export interface AuthedOperator {
  userClient: SupabaseClient
  adminClient: SupabaseClient
  userId: string
}

/**
 * Valida el JWT del operador que llama a la función. No valida por sí solo
 * que pertenezca a la sucursal/terminal del request — eso lo hace cada
 * función con `assertBranchMembership`, porque el criterio (branch vs.
 * terminal) cambia según el endpoint.
 */
export async function authenticateOperator(
  req: Request,
): Promise<{ ok: true; value: AuthedOperator } | { ok: false; response: Response }> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return { ok: false, response: unauthorized() }
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })

  const {
    data: { user },
    error,
  } = await userClient.auth.getUser()

  if (error || !user) {
    return { ok: false, response: unauthorized() }
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  return { ok: true, value: { userClient, adminClient, userId: user.id } }
}

export async function assertBranchMembership(userClient: SupabaseClient, userId: string, branchId: string) {
  const { data } = await userClient
    .from('branch_members')
    .select('branch_id')
    .eq('user_id', userId)
    .eq('branch_id', branchId)
    .maybeSingle()
  return Boolean(data)
}

function unauthorized() {
  return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  })
}
