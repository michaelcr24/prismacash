-- 0013_staff_users_view.sql
-- Expone el email (única columna que vive en auth.users) junto al perfil,
-- respetando las políticas RLS de profiles vía security_invoker.
create or replace view public.staff_users
with (security_invoker = true) as
select
  p.id,
  p.org_id,
  coalesce(u.email, '') as email,
  p.full_name,
  p.phone,
  p.role
from auth.users u
join profiles p on p.id = u.id;

grant select on public.staff_users to authenticated;
