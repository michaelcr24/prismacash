// Edge Function `issue-device` — sección 5.1 del plan.
// Registra al asistente, asigna un dispositivo NFC/QR y aplica la recarga
// inicial, todo en una sola transacción vía issue_device() en Postgres.
import { assertBranchMembership, authenticateOperator } from '../_shared/operator.ts'
import { corsHeaders, json } from '../_shared/cors.ts'

interface IssueDeviceRequest {
  event_id: string
  device_uid: string
  device_type: 'nfc' | 'qr'
  attendee_name?: string
  attendee_phone?: string
  attendee_id?: string
  initial_amount?: number
  branch_id?: string
  client_tx_id?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const auth = await authenticateOperator(req)
  if (!auth.ok) return auth.response
  const { userClient, adminClient, userId } = auth.value

  let body: IssueDeviceRequest
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid_body' }, 400)
  }

  if (!body.event_id || !body.device_uid || !body.device_type) {
    return json({ ok: false, error: 'invalid_body' }, 400)
  }

  if (body.branch_id && !(await assertBranchMembership(userClient, userId, body.branch_id))) {
    return json({ ok: false, error: 'branch_not_assigned' }, 403)
  }

  const { data, error } = await adminClient.rpc('issue_device', {
    p_event_id: body.event_id,
    p_device_uid: body.device_uid,
    p_device_type: body.device_type,
    p_attendee_name: body.attendee_name ?? null,
    p_attendee_phone: body.attendee_phone ?? null,
    p_attendee_id: body.attendee_id ?? null,
    p_initial_amount: body.initial_amount ?? 0,
    p_branch_id: body.branch_id ?? null,
    p_attendant_id: userId,
    p_client_tx_id: body.client_tx_id ?? null,
  })

  if (error) {
    console.error('issue_device rpc error', error)
    return json({ ok: false, error: 'internal_error' }, 500)
  }

  return json(data, data.ok ? 200 : 409)
})
