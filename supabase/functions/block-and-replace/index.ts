// Edge Function `block-and-replace` — sección 5.3 del plan.
// Bloquea el dispositivo extraviado y emite uno nuevo migrando el saldo,
// en una sola transacción vía block_and_replace() en Postgres.
import { assertBranchMembership, authenticateOperator } from '../_shared/operator.ts'
import { corsHeaders, json } from '../_shared/cors.ts'

interface BlockAndReplaceRequest {
  event_id: string
  old_device_uid: string
  new_device_uid: string
  new_device_type: 'nfc' | 'qr'
  branch_id?: string
  client_tx_id?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const auth = await authenticateOperator(req)
  if (!auth.ok) return auth.response
  const { userClient, adminClient, userId } = auth.value

  let body: BlockAndReplaceRequest
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid_body' }, 400)
  }

  if (!body.event_id || !body.old_device_uid || !body.new_device_uid || !body.new_device_type) {
    return json({ ok: false, error: 'invalid_body' }, 400)
  }

  if (body.branch_id && !(await assertBranchMembership(userClient, userId, body.branch_id))) {
    return json({ ok: false, error: 'branch_not_assigned' }, 403)
  }

  const { data, error } = await adminClient.rpc('block_and_replace', {
    p_old_device_uid: body.old_device_uid,
    p_event_id: body.event_id,
    p_new_device_uid: body.new_device_uid,
    p_new_device_type: body.new_device_type,
    p_branch_id: body.branch_id ?? null,
    p_attendant_id: userId,
    p_client_tx_id: body.client_tx_id ?? null,
  })

  if (error) {
    console.error('block_and_replace rpc error', error)
    return json({ ok: false, error: 'internal_error' }, 500)
  }

  return json(data, data.ok ? 200 : 409)
})
