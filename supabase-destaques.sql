-- Destaques de produtos: controlado pelo painel e usado na seção Destaques da loja.
alter table public.produtos
  add column if not exists destaque boolean not null default false;

comment on column public.produtos.destaque is 'Exibe o produto na seção Destaques da loja';
