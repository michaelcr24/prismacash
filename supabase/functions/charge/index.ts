// Edge Function `charge` — sección 5.2 del plan.
// Único punto de entrada para cobrar: valida al operador, delega la mutación
// atómica de saldo a la función `charge()` de Postgres (0002_charge_function.sql)
// y devuelve el contrato { ok, new_balance, tx_id } / { error }.
import { assertBranchMembership, authenticateOperator } from '../_shared/operator.ts'
import { corsHeaders, json } from '../_shared/cors.ts'

interface ChargeRequest {
  device_uid: string
  event_id: string
  amount: number
  branch_id?: string
  terminal_id?: string
  client_tx_id?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const auth = await authenticateOperator(req)
  if (!auth.ok) return auth.response
  const { userClient, adminClient, userId } = auth.value

  let body: ChargeRequest
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

  // La mutación real corre con service role dentro de charge(), que ya
  // aplica el advisory lock y las verificaciones de estado/saldo.
  const { data, error } = await adminClient.rpc('charge', {
    p_device_uid: body.device_uid,
    p_event_id: body.event_id,
    p_amount: body.amount,
    p_branch_id: body.branch_id ?? null,
    p_terminal_id: body.terminal_id ?? null,
    p_attendant_id: userId,
    p_client_tx_id: body.client_tx_id ?? null,
  })

  if (error) {
    console.error('charge rpc error', error)
    return json({ ok: false, error: 'internal_error' }, 500)
  }

  return json(data, data.ok ? 200 : 402)
})
