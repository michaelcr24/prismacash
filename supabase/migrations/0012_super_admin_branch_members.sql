-- Super admin puede gestionar la membresía usuario↔sucursal desde el panel
-- admin (Staff). branch_members solo tenía políticas SELECT (0001/0011); sin
-- una política de escritura, PostgREST deniega el INSERT/DELETE a superadmin.
create policy super_admin_all_branch_members on branch_members
  for all using (is_super_admin()) with check (is_super_admin());
