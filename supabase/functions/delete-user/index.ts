import { corsHeaders, json } from '../_shared/cors.ts'
import { authenticateSuperAdmin } from '../_shared/admin.ts'
import { authErrorCode } from '../_shared/users.ts'

interface DeleteUserRequest {
  user_id: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const auth = await authenticateSuperAdmin(req)
  if (!auth.ok) return auth.response
  const { adminClient } = auth.value

  let body: DeleteUserRequest
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid_body' }, 400)
  }
  if (!body.user_id) return json({ ok: false, error: 'invalid_body' }, 400)

  const { data: profileData } = await adminClient.from('profiles').select('role').eq('id', body.user_id).maybeSingle()
  if (profileData?.role === 'super_admin') return json({ ok: false, error: 'cannot_delete_super_admin' }, 403)

  const { error } = await adminClient.auth.admin.deleteUser(body.user_id)
  if (error) return json({ ok: false, error: authErrorCode(error) }, 409)

  return json({ ok: true, user_id: body.user_id }, 200)
})
