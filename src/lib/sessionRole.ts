import type { Session } from '@supabase/supabase-js'

export type SessionRole = 'super_admin' | 'event_admin' | 'operator' | null

/**
 * Lee `event_role` (y el resto de claims del auth hook) del access token
 * JWT. decodeJwt es ~10 líneas y evita una dependencia (jwt-decode) para
 * solo leer claims de un JWT que ya tenemos en mano.
 */
export function readClaims(session: Session | null) {
  if (!session) return null
  try {
    const payload = session.access_token.split('.')[1]
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const decoded = JSON.parse(decodeURIComponent(escape(json)))
    return {
      role: (decoded.claims?.event_role ?? null) as SessionRole,
      eventId: (decoded.claims?.event_id ?? null) as string | null,
      orgId: (decoded.claims?.org_id ?? null) as string | null,
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