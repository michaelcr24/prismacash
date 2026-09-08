import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../../../lib/supabase'

export type ManageRole = 'event_admin' | 'operator'

export interface CreateUserInput {
  email: string
  password?: string
  full_name?: string
  phone?: string
  role: ManageRole
  event_id: string
  branch_ids?: string[]
}

export interface InviteUserInput {
  email: string
  full_name?: string
  role: ManageRole
  event_id: string
  branch_ids?: string[]
}

export interface UpdateUserInput {
  user_id: string
  full_name?: string
  phone?: string
  email?: string
  password?: string
  role?: ManageRole
  event_id: string
  branch_ids?: string[]
  confirm_loss?: boolean
}

export class UserApiError extends Error {
  code: string | null
  payload: unknown
  constructor(
    message: string,
    code: string | null = null,
    payload: unknown = null,
  ) {
    super(message)
    this.name = 'UserApiError'
    this.code = code
    this.payload = payload
  }
}

export type StaffRole = 'super_admin' | 'event_admin' | 'operator'
export interface StaffUserAssignment {
  branch_id: string | null
  branch_name: string | null
}
export interface StaffUserRow {
  id: string
  email: string
  full_name: string | null
  phone: string | null
  role: StaffRole
  assignments: StaffUserAssignment[]
}

interface InvokeResult {
  ok?: boolean
  error?: string
  [k: string]: unknown
}

async function invoke<T>(fn: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke<InvokeResult>(fn, { body: body as Record<string, unknown> })
  if (error) {
    let code: string | null = null
    let payload: unknown = null
    if (error instanceof FunctionsHttpError) {
      const parsed = (await (error.context.json() as Promise<InvokeResult | null>).catch(() => null))
      code = parsed?.error ?? null
      payload = parsed
    }
    throw new UserApiError(code ?? 'Error de conexión — intenta de nuevo.', code, payload)
  }
  if (!data || data.ok === false) {
    throw new UserApiError(data?.error ?? 'Error desconocido.', data?.error ?? null, data ?? null)
  }
  return data as unknown as T
}

export function createUser(input: CreateUserInput) {
  return invoke<{ ok: true; user_id: string; generated_password?: string }>('create-user', input)
}
export function inviteUser(input: InviteUserInput) {
  return invoke<{ ok: true; user_id: string }>('invite-user', input)
}
export function updateUser(input: UpdateUserInput) {
  return invoke<{ ok: true; user_id: string }>('update-user', input)
}
export function deleteUser(user_id: string) {
  return invoke<{ ok: true }>('delete-user', { user_id })
}
