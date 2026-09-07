-- Corrige un hueco de seguridad de 0002: Postgres otorga EXECUTE a PUBLIC
-- por defecto al crear una función, y "revoke ... from authenticated, anon"
-- no retira ese grant de PUBLIC (los roles lo heredan igual). Resultado:
-- cualquier cliente anónimo podía invocar charge() directamente vía
-- PostgREST, saltándose por completo la Edge Function y su validación de
-- operador/terminal.
--
-- Verificado en el proyecto: una llamada anónima a /rest/v1/rpc/charge
-- devolvía 200 en vez de ser rechazada.

revoke all on function charge(text, uuid, numeric, uuid, uuid, uuid, uuid) from public;
revoke all on function charge(text, uuid, numeric, uuid, uuid, uuid, uuid) from authenticated, anon;

-- La Edge Function llama a charge() con el cliente service_role, que en
-- Supabase ya tiene privilegios amplios sobre el esquema público por
-- defecto; se deja explícito para no depender de ese default.
grant execute on function charge(text, uuid, numeric, uuid, uuid, uuid, uuid) to service_role;
