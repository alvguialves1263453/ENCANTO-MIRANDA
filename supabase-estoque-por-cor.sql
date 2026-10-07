-- Execute no SQL Editor do Supabase para habilitar o estoque individual por cor.
alter table public.produtos
  add column if not exists estoque_por_cor jsonb not null default '{}'::jsonb;
