import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { homePathForRole, readClaims, type SessionRole } from '../lib/sessionRole'
import { supabase } from '../lib/supabase'

export default function Login() {
  const navigate = useNavigate()
  const [eventSlug, setEventSlug] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function resolveOperatorBranches(eventId: string, userId: string): Promise<string[]> {
    // Tipos de sucursal del operador en este evento: sus branch_members
    // (filtrados a este usuario) cruzados con las branches del evento.
    const { data: members } = await supabase
      .from('branch_members')
      .select('branch_id')
      .eq('user_id', userId)
    const memberBranchIds = new Set((members ?? []).map((m) => m.branch_id))

    const { data: branches } = await supabase
      .from('branches')
      .select('id, type')
      .eq('event_id', eventId)
    return (branches ?? [])
      .filter((b) => memberBranchIds.has(b.id))
      .map((b) => b.type as string)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error: signInError, data: authData } = await supabase.auth.signInWithPassword({ email, password })

    if (signInError) {
      setLoading(false)
      setError('Correo o contraseña incorrectos.')
      return
    }

    // El auth hook ya metió los claims (event_role, event_id) en el JWT.
    const claims = readClaims(authData.session)
    let role: SessionRole = claims?.role ?? null
    let eventId = claims?.eventId ?? null

    if (!role) {
      // Fallback: si el access token no trae claims (hook no configurado o
      // sesión vieja), resolvemos el rol desde la tabla profiles.
      const userId = authData.session.user.id
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, org_id')
        .eq('id', userId)
        .maybeSingle()
      role = profile?.role ?? null
    }

    if (!eventId) {
      // Fallback: super_admin no tiene evento asignado en el JWT; lo
      // resolvemos por slug del evento que escribió el usuario.
      const { data: ev } = await supabase
        .from('events')
        .select('id')
        .eq('slug', eventSlug)
        .maybeSingle()
      eventId = ev?.id ?? null
    }

    let branchTypes: string[] = []
    if (role === 'operator' && eventId && authData?.session?.user) {
      try {
        branchTypes = await resolveOperatorBranches(eventId, authData.session.user.id)
      } catch {
        branchTypes = []
      }
    }

    setLoading(false)

    if (role === 'super_admin' && !eventId) {
      setError('No se pudo resolver el evento. Verifica el slug.')
      return
    }
    navigate(homePathForRole(role, eventSlug, branchTypes))
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-paper p-4">
      <div className="mb-8 text-center">
        <div
          className="mx-auto mb-4 grid h-[52px] w-[52px] place-items-center rounded-[18px] text-2xl text-white"
          style={{ background: 'var(--grad-brand)' }}
        >
          ✦
        </div>
        <h1 className="text-[28px] font-extrabold tracking-tight text-ink">PrismaCash</h1>
        <p className="mt-1 text-[13px] font-bold text-ink-soft">Pagos sin contacto · eventos</p>
      </div>

      <div
        className="w-full max-w-sm rounded-[20px] border border-line bg-paper-raised p-6"
        style={{ boxShadow: 'var(--shadow-card)' }}
      >
        <p className="mb-5 text-sm font-semibold text-ink-soft">Selecciona tu evento e inicia sesión.</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="field">
            <label>Evento (slug)</label>
            <input
              value={eventSlug}
              onChange={(e) => setEventSlug(e.target.value)}
              required
              placeholder="feria-primavera"
              className="input"
            />
          </div>
          <div className="field">
            <label>Correo</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="input"
            />
          </div>
          <div className="field">
            <label>Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="input"
            />
          </div>

          {error && <p className="text-sm text-rust">{error}</p>}

          <button type="submit" disabled={loading} className="cta-gold disabled:opacity-60">
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
