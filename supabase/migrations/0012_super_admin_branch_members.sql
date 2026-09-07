-- Super admin puede gestionar la membresía usuario↔sucursal desde el panel
-- admin (Staff). 0001 solo habilitaba RLS en branch_members (sin política);
-- las políticas SELECT viven en archivos posteriores: 0009
-- (auth_admin_read_branch_members) y 0011 (event_scoped_read_branch_members).
-- Esta política `for all` habilita además la lectura para superadmin: la de
-- 0011 exigía un claim event_id que superadmin no posee, por eso la lista de
-- Staff salía vacía para superadmin. Sin una política de escritura, PostgREST
-- deniega el INSERT/DELETE a superadmin.
create policy super_admin_all_branch_members on branch_members
  for all using (is_super_admin()) with check (is_super_admin());
