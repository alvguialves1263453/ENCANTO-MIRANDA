-- Endereço informado pela cliente na finalização do pedido.
alter table public.pedidos
  add column if not exists cliente_endereco text not null default '';

comment on column public.pedidos.cliente_endereco is
  'Endereço de entrega informado pela cliente';
