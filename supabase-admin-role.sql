-- Autoriza a conta administrativa para as RPCs protegidas de vendas e caixa.
-- Execute uma vez no SQL Editor do projeto Supabase correto.
-- Este script mescla o papel em app_metadata sem apagar os metadados existentes.

begin;

update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('role', 'admin')
where lower(email) = lower('admin@encantomiranda.com.br')
returning id, email, raw_app_meta_data->>'role' as app_role;

commit;
