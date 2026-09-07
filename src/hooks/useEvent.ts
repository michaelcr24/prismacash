import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'

export interface EventRow {
  id: string
  slug: string
  name: string
  status: 'draft' | 'active' | 'closed'
  device_type: 'nfc' | 'qr' | 'hybrid'
  brand_primary: string
  brand_secondary: string
  logo_url: string | null
  currency: string
}

/**
 * RLS ya limita esto al evento asignado al usuario autenticado (o a todos
 * si es super_admin) vía el claim `event_id` del JWT — ver sección 7 del
 * plan y 0004_event_admins_and_auth_hook.sql.
 */
export function useEvent(eventSlug: string | undefined) {
  const { loading: authLoading } = useAuth()
  return useQuery({
    queryKey: ['event', eventSlug],
    // esperar a que la sesión termine de restaurarse evita que esta query
    // salga como anónima en una carga de página completa (ver lib/auth.tsx)
    enabled: Boolean(eventSlug) && !authLoading,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('events')
        .select('id, slug, name, status, device_type, brand_primary, brand_secondary, logo_url, currency')
        .eq('slug', eventSlug)
        .single()
      if (error) throw error
      return data as EventRow
    },
  })
}
