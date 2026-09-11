import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

export function authErrorCode(error: { message?: string }): string {
  const msg = (error?.message ?? '').toLowerCase()
  if (msg.includes('already registered') || msg.includes('duplicate')) return 'email_exists'
  if (msg.includes('password')) return 'invalid_password'
  if (msg.includes('does not exist')) return 'user_not_found'
  return 'auth_error'
}

export async function resolveOrgOfEvent(adminClient: SupabaseClient, eventId: string): Promise<string | null> {
  const { data } = await adminClient.from('events').select('org_id').eq('id', eventId).maybeSingle()
  return data?.org_id ?? null
}

export async function assignEventAdmin(adminClient: SupabaseClient, userId: string, eventId: string): Promise<void> {
  await adminClient.from('event_admins').insert({ user_id: userId, event_id: eventId }).onConflict('user_id,event_id').ignore()
}

export async function reconcileBranchMembers(
  adminClient: SupabaseClient,
  userId: string,
  eventId: string,
  branchIds: string[],
): Promise<void> {
  const target = new Set(branchIds ?? [])
  const { data: eventBranches } = await adminClient.from('branches').select('id').eq('event_id', eventId)
  const eventBranchIds = (eventBranches ?? []).map((b) => b.id)
  if (eventBranchIds.length === 0) return

  const { data: current } = await adminClient
    .from('branch_members')
    .select('id, branch_id')
    .eq('user_id', userId)
    .in('branch_id', eventBranchIds)

  const toDelete = (current ?? []).filter((c) => !target.has(c.branch_id)).map((c) => c.id)
  if (toDelete.length) await adminClient.from('branch_members').delete().in('id', toDelete)

  const existing = new Set((current ?? []).map((c) => c.branch_id))
  const toInsert = [...target]
    .filter((branchId) => !existing.has(branchId))
    .map((branch_id) => ({ user_id: userId, branch_id }))
  if (toInsert.length) await adminClient.from('branch_members').insert(toInsert)
}

export async function assignmentsToLose(
  adminClient: SupabaseClient,
  userId: string,
  currentRole: string,
  targetRole: string,
): Promise<string[]> {
  if (currentRole === targetRole) return []
  if (targetRole === 'event_admin' && currentRole === 'operator') {
    const { data } = await adminClient.from('branch_members').select('branch(name)').eq('user_id', userId)
    return (data ?? []).map((r) => `Sucursal: ${r.branch?.name ?? 'sin nombre'}`)
  }
  if (targetRole === 'operator' && currentRole === 'event_admin') {
    const { data } = await adminClient.from('event_admins').select('id').eq('user_id', userId)
    return (data ?? []).length ? ['Asignación como administrador de evento'] : []
  }
  return []
}

export async function reconcileAssignmentsForRole(
  adminClient: SupabaseClient,
  userId: string,
  eventId: string,
  role: string,
  branchIds: string[],
): Promise<void> {
  if (role === 'event_admin') {
    await adminClient.from('branch_members').delete().eq('user_id', userId)
    await assignEventAdmin(adminClient, userId, eventId)
  } else {
    await adminClient.from('event_admins').delete().eq('user_id', userId)
    await reconcileBranchMembers(adminClient, userId, eventId, branchIds)
  }
}
