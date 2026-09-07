-- Datos de prueba mínimos para probar el flujo completo end-to-end.
-- Corre esto DESPUÉS de las migraciones 0001-0006.
-- El usuario (auth.users) no se crea aquí — ver instrucciones en el README.

insert into organizations (id, name, slug)
values ('00000000-0000-0000-0000-000000000001', 'PrismaCash Demo', 'demo-org')
on conflict (slug) do nothing;

-- device_type = 'qr' para poder probar con la cámara de una laptop, sin
-- depender de hardware NFC.
insert into events (id, org_id, name, slug, status, device_type, currency)
values (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'Feria Demo',
  'demo',
  'active',
  'qr',
  'CRC'
)
on conflict (slug) do nothing;

-- type = 'both' para poder abrir /kiosk y /pos con la misma sucursal
-- mientras pruebas solo.
insert into branches (id, event_id, name, type)
values (
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000002',
  'Sucursal de prueba',
  'both'
)
on conflict do nothing;
