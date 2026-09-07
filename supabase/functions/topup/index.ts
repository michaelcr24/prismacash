// Edge Function `topup` — recarga de saldo a un dispositivo ya emitido
// (sección 5 del plan, tipo de transacción `topup`). Complementa a
// `issue-device` (alta + carga inicial): este es el camino para el quiosco
// cuando el asistente ya tiene dispositivo y solo quiere sumar saldo.
import { assertBranchMembership, authenticateOperator } from '../_shared/operator.ts'
import { corsHeaders, json } from '../_shared/cors.ts'

interface TopupRequest {
  event_id: string
  device_uid: string
  amount: number
  branch_id?: string
  client_tx_id?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const auth = await authenticateOperator(req)
  if (!auth.ok) return auth.response
  const { userClient, adminClient, userId } = auth.value

  let body: TopupRequest
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid_body' }, 400)
  }

  if (!body.device_uid || !body.event_id || !body.amount) {
    return json({ ok: false, error: 'invalid_body' }, 400)
  }

  if (body.branch_id && !(await assertBranchMembership(userClient, userId, body.branch_id))) {
    return json({ ok: false, error: 'branch_not_assigned' }, 403)
  }

  const { data, error } = await adminClient.rpc('topup', {
    p_device_uid: body.device_uid,
    p_event_id: body.event_id,
    p_amount: body.amount,
    p_branch_id: body.branch_id ?? null,
    p_attendant_id: userId,
    p_client_tx_id: body.client_tx_id ?? null,
  })

  if (error) {
    console.error('topup rpc error', error)
    return json({ ok: false, error: 'internal_error' }, 500)
  }

  return json(data, data.ok ? 200 : 409)
})
