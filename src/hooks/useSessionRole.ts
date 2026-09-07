import { useAuth } from '../lib/auth-context'
import { readClaims, type SessionRole } from '../lib/sessionRole'

/** Rol de la sesión desde los claims del JWT (ver sessionRole.ts). */
export function useSessionRole(): SessionRole {
  const { session } = useAuth()
  return readClaims(session)?.role ?? null
}
