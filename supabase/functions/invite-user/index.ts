import { corsHeaders, json } from '../_shared/cors.ts'
import { authenticateSuperAdmin } from '../_shared/admin.ts'
import {
  assignEventAdmin,
  authErrorCode,
  reconcileBranchMembers,
  resolveOrgOfEvent,
} from '../_shared/users.ts'

interface InviteUserRequest {
  email: string
  full_name?: string
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

  let body: InviteUserRequest
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid_body' }, 400)
  }

  const email = (body.email ?? '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: 'invalid_email' }, 400)
  if (body.role !== 'event_admin' && body.role !== 'operator') return json({ ok: false, error: 'invalid_role' }, 400)
  if (!body.event_id) return json({ ok: false, error: 'invalid_body' }, 400)

  let userId: string | null = null
  try {
    const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: body.full_name ? { full_name: body.full_name } : undefined,
    })
    if (error) return json({ ok: false, error: authErrorCode(error) }, 409)
    userId = data.user!.id

    const orgId = await resolveOrgOfEvent(adminClient, body.event_id)
    const { error: profileError } = await adminClient.from('profiles').insert({
      id: userId,
      org_id: orgId,
      full_name: body.full_name?.trim() || null,
      phone: null,
      role: body.role,
    })
    if (profileError) throw profileError

    if (body.role === 'event_admin') {
      await assignEventAdmin(adminClient, userId, body.event_id)
    } else {
      await reconcileBranchMembers(adminClient, userId, body.event_id, body.branch_ids ?? [])
    }
  } catch (e) {
    console.error('invite-user error', e)
    if (userId) await adminClient.auth.admin.deleteUser(userId).catch(() => {})
    return json({ ok: false, error: 'internal_error' }, 500)
  }

  return json({ ok: true, user_id: userId! }, 200)
})