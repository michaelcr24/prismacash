import { FunctionsHttpError } from '@supabase/supabase-js'

/**
 * `supabase.functions.invoke` trata cualquier respuesta no-2xx como excepción
 * y descarta el body — pero nuestras Edge Functions sí devuelven
 * `{ ok: false, error: '...' }` en esos status (402/403/409) a propósito.
 * Esto recupera ese body para poder mostrar el mensaje de negocio real.
 */
export async function readFunctionErrorCode(error: unknown): Promise<string | null> {
  if (!(error instanceof FunctionsHttpError)) return null
  try {
    const body = await error.context.json()
    return typeof body?.error === 'string' ? body.error : null
  } catch {
    return null
  }
}
