import type { Session } from '@supabase/supabase-js'

export type SessionRole = 'super_admin' | 'event_admin' | 'operator' | null

/**
 * Lee `event_role` (y el resto de claims del auth hook) del access token
 * JWT. decodeJwt es ~10 líneas y evita una dependencia (jwt-decode) para
 * solo leer claims de un JWT que ya tenemos en mano.
 *
 * `custom_access_token_hook` (0004_event_admins_and_auth_hook.sql) recibe
 * `event.claims` como input, pero Supabase Auth aplana ese resultado al
 * firmar el JWT final: `event_role`/`event_id`/`org_id` quedan en la RAÍZ
 * del payload, no bajo una clave `claims` anidada. Leerlos como
 * `decoded.claims?.event_role` siempre da `undefined` — bug verificado
 * 2026-09-10 con un JWT real que traía `event_role: "super_admin"` en la
 * raíz y ningún usuario (ni super_admin) podía pasar del login/AdminLayout.
 */
export function readClaims(session: Session | null) {
  if (!session) return null
  try {
    const payload = session.access_token.split('.')[1]
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const decoded = JSON.parse(decodeURIComponent(escape(json)))
    return {
      role: (decoded.event_role ?? null) as SessionRole,
      eventId: (decoded.event_id ?? null) as string | null,
      orgId: (decoded.org_id ?? null) as string | null,
    }
  } catch {
    return null
  }
}

/** Punto de entrada por defecto por rol (ver Login.tsx).
 *  - super_admin / event_admin → admin
 *  - operator → pos si tiene alguna sucursal de venta, si no kiosk */
export function homePathForRole(role: SessionRole, eventSlug: string, branchTypes: string[] = []) {
  if (role === 'super_admin' || role === 'event_admin') return `/e/${eventSlug}/admin`
  const hasSales = branchTypes.some((t) => t === 'sales_point' || t === 'both')
  return hasSales ? `/e/${eventSlug}/pos` : `/e/${eventSlug}/kiosk`
}