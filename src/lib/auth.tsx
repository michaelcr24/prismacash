import { useEffect, useState, type ReactNode } from 'react'
import { AuthContext, type AuthState } from './auth-context'
import { supabase } from './supabase'

/**
 * Sin esto, cualquier query que dependa de RLS puede dispararse antes de que
 * supabase-js termine de restaurar la sesión desde localStorage en una carga
 * de página completa (ej. entrar directo a /e/:slug/pos por URL) — la
 * petición sale como anónima, RLS filtra todo, y algo como `.single()`
 * termina en 406 en vez de esperar a la sesión real.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: true })

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setState({ session: data.session, loading: false })
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ session, loading: false })
    })

    return () => subscription.unsubscribe()
  }, [])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}
