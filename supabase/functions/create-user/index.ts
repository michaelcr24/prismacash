import { corsHeaders, json } from '../_shared/cors.ts'
import { authenticateSuperAdmin } from '../_shared/admin.ts'
import {
  assignEventAdmin,
  authErrorCode,
  reconcileBranchMembers,
  resolveOrgOfEvent,
} from '../_shared/users.ts'

interface CreateUserRequest {
  email: string
  password?: string
  full_name?: string
  phone?: string
  role: 'event_admin' | 'operator'
  event_id: string
  branch_ids?: string[]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const auth = await authenticateSuperAdmin(req)
  if (!auth.ok) return auth.response
  const { adminClient } = auth.value

  let body: CreateUserRequest
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid_body' }, 400)
  }

  const email = (body.email ?? '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: 'invalid_email' }, 400)
  if (body.role !== 'event_admin' && body.role !== 'operator') return json({ ok: false, error: 'invalid_role' }, 400)
  if (!body.event_id) return json({ ok: false, error: 'invalid_body' }, 400)
  const wantsManualPassword = typeof body.password === 'string' && body.password !== ''
  if (wantsManualPassword && body.password!.length < 8) return json({ ok: false, error: 'password_too_short' }, 400)

  // El super_admin nunca introduce roles super_admin; solo event_admin/operator.
  const generatedPassword = wantsManualPassword ? undefined : crypto.randomUUID().slice(0, 10)
  const password = wantsManualPassword ? body.password! : generatedPassword!

  let userId: string | null = null
  try {
    const { data, error } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: body.full_name ? { full_name: body.full_name } : undefined,
    })
    if (error) return json({ ok: false, error: authErrorCode(error) }, 409)
    userId = data.user!.id

    const orgId = await resolveOrgOfEvent(adminClient, body.event_id)
    const { error: profileError } = await adminClient.from('profiles').insert({
      id: userId,
      org_id: orgId,
      full_name: body.full_name?.trim() || null,
      phone: body.phone?.trim() || null,
      role: body.role,
    })
    if (profileError) throw profileError

    if (body.role === 'event_admin') {
      await assignEventAdmin(adminClient, userId, body.event_id)
    } else {
      await reconcileBranchMembers(adminClient, userId, body.event_id, body.branch_ids ?? [])
    }
  } catch (e) {
    console.error('create-user error', e)
    if (userId) await adminClient.auth.admin.deleteUser(userId).catch(() => {})
    return json({ ok: false, error: 'internal_error' }, 500)
  }

  return json({ ok: true, user_id: userId!, generated_password: generatedPassword }, 200)
})