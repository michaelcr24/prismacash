import { corsHeaders, json } from '../_shared/cors.ts'
import { authenticateSuperAdmin } from '../_shared/admin.ts'
import { assignmentsToLose, authErrorCode, reconcileAssignmentsForRole } from '../_shared/users.ts'

interface UpdateUserRequest {
  user_id: string
  full_name?: string
  phone?: string
  email?: string
  password?: string
  role?: 'event_admin' | 'operator'
  event_id: string
  branch_ids?: string[]
  confirm_loss?: boolean
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const auth = await authenticateSuperAdmin(req)
  if (!auth.ok) return auth.response
  const { adminClient } = auth.value

  let body: UpdateUserRequest
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid_body' }, 400)
  }
  if (!body.user_id || !body.event_id) return json({ ok: false, error: 'invalid_body' }, 400)
  if (body.password !== undefined && body.password !== '' && body.password.length < 8) {
    return json({ ok: false, error: 'password_too_short' }, 400)
  }
  const wantedRole = body.role ?? null
  if (wantedRole && wantedRole !== 'event_admin' && wantedRole !== 'operator') {
    return json({ ok: false, error: 'invalid_role' }, 400)
  }

  const { data: profileData, error: profErr } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', body.user_id)
    .maybeSingle()
  if (profErr || !profileData) return json({ ok: false, error: 'user_not_found' }, 404)
  if (profileData.role === 'super_admin') return json({ ok: false, error: 'cannot_edit_super_admin' }, 403)

  const currentRole: 'event_admin' | 'operator' = profileData.role
  const targetRole = wantedRole ?? currentRole

  if (targetRole !== currentRole) {
    const loss = await assignmentsToLose(adminClient, body.user_id, currentRole, targetRole)
    if (loss.length > 0 && !body.confirm_loss) {
      return json({ ok: false, error: 'confirm_assignment_loss', assignments: loss }, 409)
    }
  }

  try {
    const authUpdates: { email?: string; password?: string } = {}
    const { data: currentAuth } = await adminClient.auth.admin.getUserById(body.user_id)
    const currentEmail = currentAuth?.user?.email ?? ''
    if (body.email && body.email.trim().toLowerCase() !== currentEmail.toLowerCase()) {
      authUpdates.email = body.email.trim().toLowerCase()
    }
    if (body.password && body.password !== '') authUpdates.password = body.password
    if (Object.keys(authUpdates).length > 0) {
      const { error: authErr } = await adminClient.auth.admin.updateUserById(body.user_id, authUpdates)
      if (authErr) return json({ ok: false, error: authErrorCode(authErr) }, 409)
    }

    const profileUpdate: { full_name?: string | null; phone?: string | null; role?: 'event_admin' | 'operator' } = {}
    if (body.full_name !== undefined) profileUpdate.full_name = body.full_name.trim() || null
    if (body.phone !== undefined) profileUpdate.phone = body.phone.trim() || null
    if (body.role !== undefined) profileUpdate.role = body.role
    if (Object.keys(profileUpdate).length > 0) {
      const { error: updErr } = await adminClient.from('profiles').update(profileUpdate).eq('id', body.user_id)
      if (updErr) throw updErr
    }

    await reconcileAssignmentsForRole(adminClient, body.user_id, body.event_id, targetRole, body.branch_ids ?? [])
  } catch (e) {
    console.error('update-user error', e)
    return json({ ok: false, error: 'internal_error' }, 500)
  }

  return json({ ok: true, user_id: body.user_id }, 200)
})