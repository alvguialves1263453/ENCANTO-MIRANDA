-- ============================================================
-- ENCANTO MIRANDA — Checkout dos visitantes (rode UMA vez)
-- COMO RODAR:
--  1. Abra https://supabase.com/dashboard > seu projeto
--  2. Menu lateral > SQL Editor > New query
--  3. Cole TODO este arquivo > RUN > espere "Success"
-- ============================================================
-- POR QUE ISSO EXISTE:
-- O PostgREST do projeto exigia SELECT para o INSERT com retorno padrão.
-- A produção usa retorno mínimo no checkout e permite ao papel anon apenas
-- INSERT em pedidos. Assim a cliente consegue enviar o pedido, mas nunca
-- consegue ler, alterar ou apagar pedidos.
-- ============================================================

-- 1) Visitantes (anon) podem somente CRIAR pedido.
--    O RLS fica desativado nesta tabela por compatibilidade do PostgREST;
--    os privilégios abaixo são a barreira efetiva para o papel anon.
alter table public.pedidos disable row level security;
revoke all on table public.pedidos from anon;
grant insert on table public.pedidos to anon;
grant select, insert, update, delete on table public.pedidos to authenticated;

drop policy if exists "visitantes_enviam_pedido" on public.pedidos;
create policy "visitantes_enviam_pedido"
  on public.pedidos
  for insert
  to anon, authenticated
  with check (true);

-- 2) Garante que as 5 tabelas da loja estão na publicação do Realtime
--    (sem isso o painel e a loja não se atualizam em tempo real entre aparelhos).
do $$
declare t text;
begin
  foreach t in array array['produtos','categorias','cupons','configuracoes','pedidos']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- 3) Conferência: deve listar 5 linhas (uma por tabela)
select tablename
from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public'
order by tablename;
