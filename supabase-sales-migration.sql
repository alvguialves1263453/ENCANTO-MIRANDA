-- Sales + cash migration for the existing public.pedidos / public.produtos tables.
-- Execute in the Supabase SQL Editor. All financial and stock mutations below
-- are PostgreSQL transactions (each RPC call is atomic).
-- Before using admin RPCs, set the admin user's Supabase Auth app_metadata.role
-- to "admin" in the Auth user record. Do not put service_role credentials here.
begin;

create extension if not exists pgcrypto;

-- Bootstrap da tabela base para instalações novas; em bases existentes,
-- o restante desta migration completa as colunas faltantes sem sobrescrever dados.
create table if not exists public.pedidos (
  numero text primary key,
  data timestamptz not null default now(),
  cliente_nome text not null default '',
  cliente_fone text not null default '',
  cliente_endereco text not null default '',
  itens jsonb not null default '[]'::jsonb,
  subtotal numeric(12,2) not null default 0,
  desconto numeric(12,2) not null default 0,
  frete numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  pagamento text not null default '',
  pagamento_status text not null default 'Pendente',
  valor_recebido numeric(12,2) not null default 0,
  troco numeric(12,2) not null default 0,
  cupom text not null default '',
  observacao text not null default '',
  status text not null default 'Novo',
  estoque_baixado boolean not null default false,
  estoque_estornado boolean not null default false,
  fechado_em timestamptz,
  atualizado_em timestamptz not null default now()
);

create sequence if not exists public.pedidos_numero_seq;

do $$
declare
  v_proximo bigint;
begin
  select coalesce(max((substring(numero from '^#?([0-9]+)$'))::bigint) + 1, 1)
    into v_proximo
    from public.pedidos
   where numero ~ '^#?[0-9]+$';
  perform setval('public.pedidos_numero_seq', v_proximo, false);
end $$;

alter table public.pedidos
  add column if not exists frete numeric(12,2) not null default 0,
  add column if not exists pagamento_status text not null default 'Pendente',
  add column if not exists valor_recebido numeric(12,2) not null default 0,
  add column if not exists troco numeric(12,2) not null default 0,
  add column if not exists observacao text not null default '',
  add column if not exists origem text not null default 'Site',
  add column if not exists chave_idempotencia uuid,
  add column if not exists estoque_estornado boolean not null default false,
  add column if not exists fechado_em timestamptz,
  add column if not exists atualizado_em timestamptz not null default now(),
  add column if not exists motivo_cancelamento text,
  add column if not exists reembolso_status text not null default 'Não necessário';

alter table public.produtos add column if not exists estoque_por_cor jsonb not null default '{}'::jsonb;
alter table public.produtos add column if not exists estoque_por_variante jsonb not null default '{}'::jsonb;
alter table public.produtos add column if not exists fornecedor_id text;
create unique index if not exists pedidos_chave_idempotencia_uidx on public.pedidos(chave_idempotencia) where chave_idempotencia is not null;
create index if not exists pedidos_data_idx on public.pedidos(data desc);
create index if not exists pedidos_status_idx on public.pedidos(status);

create table if not exists public.vendas (
  id uuid primary key default gen_random_uuid(),
  pedido_numero text not null unique references public.pedidos(numero) on delete restrict,
  valor_original numeric(12,2) not null check (valor_original >= 0),
  desconto_negociado numeric(12,2) not null default 0 check (desconto_negociado >= 0),
  valor_final numeric(12,2) not null check (valor_final >= 0),
  status text not null default 'Finalizado',
  finalizada_em timestamptz not null default now(),
  cancelada_em timestamptz,
  cancelamento_motivo text,
  responsavel uuid references auth.users(id),
  reembolso_status text not null default 'Não necessário',
  reembolsada numeric(12,2) not null default 0 check (reembolsada >= 0),
  criado_em timestamptz not null default now()
);

create table if not exists public.pagamentos (
  id uuid primary key default gen_random_uuid(),
  venda_id uuid not null references public.vendas(id) on delete restrict,
  forma text not null check (forma in ('PIX','Dinheiro','Cartão de crédito','Cartão de débito','Transferência')),
  valor numeric(12,2) not null check (valor > 0),
  entregue numeric(12,2) not null default 0 check (entregue >= 0),
  troco numeric(12,2) not null default 0 check (troco >= 0),
  status text not null default 'Recebido',
  recebido_em timestamptz not null default now(),
  criado_por uuid references auth.users(id)
);

create table if not exists public.sessoes_caixa (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'Aberto' check (status in ('Aberto','Fechado')),
  operador_abertura uuid not null references auth.users(id),
  aberto_em timestamptz not null default now(),
  saldo_inicial numeric(12,2) not null default 0 check (saldo_inicial >= 0),
  observacao_abertura text not null default '',
  operador_fechamento uuid references auth.users(id),
  fechado_em timestamptz,
  saldo_esperado numeric(12,2),
  saldo_contado numeric(12,2),
  diferenca numeric(12,2),
  justificativa_fechamento text not null default ''
);

create table if not exists public.movimentacoes_caixa (
  id uuid primary key default gen_random_uuid(),
  sessao_id uuid references public.sessoes_caixa(id) on delete restrict,
  venda_id uuid references public.vendas(id) on delete restrict,
  pagamento_id uuid references public.pagamentos(id) on delete restrict,
  tipo text not null check (tipo in ('Venda','Reembolso','Entrada','Saída')),
  valor numeric(12,2) not null check (valor > 0),
  forma text not null,
  descricao text not null default '',
  criado_por uuid references auth.users(id),
  reversao_de uuid references public.movimentacoes_caixa(id),
  criado_em timestamptz not null default now()
);

create table if not exists public.movimentacoes_estoque (
  id uuid primary key default gen_random_uuid(),
  pedido_numero text references public.pedidos(numero) on delete restrict,
  produto_id text not null,
  cor text not null default '',
  tipo text not null check (tipo in ('Venda','Estorno')),
  quantidade integer not null check (quantidade > 0),
  estoque_anterior integer not null,
  estoque_resultante integer not null,
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now()
);

create table if not exists public.historico_pedidos (
  id bigint generated always as identity primary key,
  pedido_numero text not null references public.pedidos(numero) on delete restrict,
  status_anterior text,
  status_novo text not null,
  motivo text not null default '',
  alterado_por uuid references auth.users(id),
  alterado_em timestamptz not null default now()
);

create table if not exists public.auditoria_vendas (
  id bigint generated always as identity primary key,
  pedido_numero text not null references public.pedidos(numero) on delete restrict,
  acao text not null,
  antes jsonb,
  depois jsonb,
  ator uuid references auth.users(id),
  criado_em timestamptz not null default now()
);

create or replace function public.audit_pedido_update()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if row(old.status,old.subtotal,old.desconto,old.frete,old.total,old.pagamento,old.pagamento_status,old.valor_recebido,old.troco,old.itens)
     is distinct from row(new.status,new.subtotal,new.desconto,new.frete,new.total,new.pagamento,new.pagamento_status,new.valor_recebido,new.troco,new.itens) then
    insert into public.auditoria_vendas(pedido_numero,acao,antes,depois,ator)
    values(new.numero,'pedido_update',to_jsonb(old),to_jsonb(new),auth.uid());
  end if;
  if old.status is distinct from new.status then
    insert into public.historico_pedidos(pedido_numero,status_anterior,status_novo,motivo,alterado_por)
    values(new.numero,old.status,new.status,'Atualização do pedido',auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists pedidos_audit_update on public.pedidos;
create trigger pedidos_audit_update after update on public.pedidos for each row execute function public.audit_pedido_update();

create index if not exists vendas_finalizada_idx on public.vendas(finalizada_em desc);
create index if not exists pagamentos_venda_idx on public.pagamentos(venda_id);
create index if not exists caixa_criado_idx on public.movimentacoes_caixa(criado_em desc);
create index if not exists estoque_pedido_idx on public.movimentacoes_estoque(pedido_numero);
create index if not exists historico_pedido_idx on public.historico_pedidos(pedido_numero, alterado_em desc);
create index if not exists movimentacoes_caixa_sessao_idx on public.movimentacoes_caixa(sessao_id, criado_em desc);
create index if not exists movimentacoes_caixa_venda_idx on public.movimentacoes_caixa(venda_id);
create index if not exists movimentacoes_caixa_pagamento_idx on public.movimentacoes_caixa(pagamento_id);
create index if not exists movimentacoes_estoque_produto_idx on public.movimentacoes_estoque(produto_id, criado_em desc);
create unique index if not exists sessoes_caixa_aberta_uidx on public.sessoes_caixa(status) where status = 'Aberto';

alter table public.pedidos enable row level security;
alter table public.vendas enable row level security;
alter table public.pagamentos enable row level security;
alter table public.movimentacoes_caixa enable row level security;
alter table public.sessoes_caixa enable row level security;
alter table public.movimentacoes_estoque enable row level security;
alter table public.historico_pedidos enable row level security;
alter table public.auditoria_vendas enable row level security;

create or replace function public.sales_admin_authorized()
returns boolean language sql stable security definer set search_path=public,auth as $$
  select auth.uid() is not null and coalesce(auth.jwt()->'app_metadata'->>'role','')='admin';
$$;
revoke all on function public.sales_admin_authorized() from public, anon;
grant execute on function public.sales_admin_authorized() to authenticated;

create or replace function public.admin_abrir_caixa(p_saldo_inicial numeric,p_observacao text default '')
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row public.sessoes_caixa%rowtype;
begin
  if not public.sales_admin_authorized() then raise exception 'admin_auth_required'; end if;
  if p_saldo_inicial<0 or p_saldo_inicial>999999999 then raise exception 'invalid_opening_balance'; end if;
  perform 1 from public.sessoes_caixa where status='Aberto' for update;
  if found then raise exception 'cash_session_already_open'; end if;
  begin
    insert into public.sessoes_caixa(operador_abertura,saldo_inicial,observacao_abertura) values(auth.uid(),p_saldo_inicial,left(coalesce(p_observacao,''),1000)) returning * into v_row;
  exception when unique_violation then
    raise exception 'cash_session_already_open';
  end;
  return to_jsonb(v_row);
end $$;

create or replace function public.admin_fechar_caixa(p_sessao uuid,p_saldo_contado numeric,p_justificativa text default '')
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row public.sessoes_caixa%rowtype; v_mov numeric(12,2); v_esperado numeric(12,2);
begin
  if not public.sales_admin_authorized() then raise exception 'admin_auth_required'; end if;
  select * into v_row from public.sessoes_caixa where id=p_sessao for update;
  if not found or v_row.status<>'Aberto' then raise exception 'cash_session_not_open'; end if;
  if p_saldo_contado<0 then raise exception 'invalid_counted_balance'; end if;
  select coalesce(sum(case when tipo in ('Venda','Entrada') then valor else -valor end),0) into v_mov
    from public.movimentacoes_caixa where sessao_id=p_sessao and forma='Dinheiro';
  v_esperado:=v_row.saldo_inicial+v_mov;
  if abs(p_saldo_contado-v_esperado)>0.01 and length(trim(coalesce(p_justificativa,'')))<3 then raise exception 'cash_difference_justification_required'; end if;
  update public.sessoes_caixa set status='Fechado',operador_fechamento=auth.uid(),fechado_em=now(),saldo_esperado=v_esperado,saldo_contado=p_saldo_contado,diferenca=p_saldo_contado-v_esperado,justificativa_fechamento=left(coalesce(p_justificativa,''),1000) where id=p_sessao returning * into v_row;
  return to_jsonb(v_row);
end $$;

create or replace function public.admin_movimento_caixa(p_tipo text,p_valor numeric,p_forma text,p_descricao text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_session uuid; v_mov public.movimentacoes_caixa%rowtype; v_saldo numeric(12,2);
begin
  if not public.sales_admin_authorized() then raise exception 'admin_auth_required'; end if;
  if p_tipo not in ('Entrada','Saída') or p_valor<=0 or p_forma not in ('Dinheiro','PIX','Cartão','Transferência','Outros') then raise exception 'invalid_cash_movement'; end if;
  if p_forma='Dinheiro' then
    select id into v_session from public.sessoes_caixa where status='Aberto' order by aberto_em desc limit 1 for update;
    if v_session is null then raise exception 'open_cash_session_required'; end if;
    select coalesce((select saldo_inicial from public.sessoes_caixa where id=v_session),0)+coalesce(sum(case when tipo in ('Venda','Entrada') then valor else -valor end),0) into v_saldo from public.movimentacoes_caixa where sessao_id=v_session and forma='Dinheiro';
    if p_tipo='Saída' and p_valor>v_saldo then raise exception 'cash_balance_insufficient'; end if;
  end if;
  insert into public.movimentacoes_caixa(sessao_id,tipo,valor,forma,descricao,criado_por) values(v_session,p_tipo,round(p_valor,2),p_forma,left(coalesce(p_descricao,''),500),auth.uid()) returning * into v_mov;
  return to_jsonb(v_mov);
end $$;

drop policy if exists "public can create pedidos" on public.pedidos;
drop policy if exists "admins can delete pedidos" on public.pedidos;
drop policy if exists "admins can read pedidos" on public.pedidos;
drop policy if exists "admins can update pedidos" on public.pedidos;
drop policy if exists pedidos_admin_read on public.pedidos;
create policy pedidos_admin_read on public.pedidos for select to authenticated using (public.sales_admin_authorized());
drop policy if exists pedidos_admin_update on public.pedidos;
revoke all on public.pedidos from anon, authenticated;
grant select on public.pedidos to authenticated;

do $$ declare t text; begin
  foreach t in array array['vendas','pagamentos','sessoes_caixa','movimentacoes_caixa','movimentacoes_estoque','historico_pedidos','auditoria_vendas'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.sales_admin_authorized())', t || '_admin_read', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Retém somente os pedidos mais recentes e apaga seus dados dependentes.
-- Estoque não é devolvido: uma venda antiga continua tendo sido realizada.
create or replace function public.purge_old_orders(p_keep integer default 7)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_removed integer := 0;
begin
  if p_keep < 1 then raise exception 'invalid_order_retention_limit'; end if;
  perform pg_advisory_xact_lock(72819430);

  delete from public.movimentacoes_caixa m
   where m.venda_id in (
     select v.id from public.vendas v
      where v.pedido_numero in (select p.numero from public.pedidos p order by p.data desc, p.numero desc offset p_keep)
   )
      or m.pagamento_id in (
     select pay.id from public.pagamentos pay join public.vendas v on v.id=pay.venda_id
      where v.pedido_numero in (select p.numero from public.pedidos p order by p.data desc, p.numero desc offset p_keep)
   );
  delete from public.pagamentos pay
   where pay.venda_id in (select v.id from public.vendas v where v.pedido_numero in (select p.numero from public.pedidos p order by p.data desc, p.numero desc offset p_keep));
  delete from public.movimentacoes_estoque m
   where m.pedido_numero in (select p.numero from public.pedidos p order by p.data desc, p.numero desc offset p_keep);
  delete from public.auditoria_vendas a
   where a.pedido_numero in (select p.numero from public.pedidos p order by p.data desc, p.numero desc offset p_keep);
  delete from public.historico_pedidos h
   where h.pedido_numero in (select p.numero from public.pedidos p order by p.data desc, p.numero desc offset p_keep);
  delete from public.vendas v
   where v.pedido_numero in (select p.numero from public.pedidos p order by p.data desc, p.numero desc offset p_keep);
  delete from public.pedidos p
   where p.numero in (select old.numero from (select p0.numero from public.pedidos p0 order by p0.data desc, p0.numero desc offset p_keep) old);
  get diagnostics v_removed = row_count;
  return v_removed;
end $$;
revoke all on function public.purge_old_orders(integer) from public, anon, authenticated;

create or replace function public.site_criar_pedido(
  p_chave uuid, p_cliente jsonb, p_itens jsonb, p_pagamento text, p_desconto numeric default 0, p_frete numeric default 0
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_numero text; v_itens jsonb := '[]'::jsonb; v_item jsonb; v_prod public.produtos%rowtype; v_qtd int; v_need int; v_cor text; v_sub numeric(12,2) := 0; v_desc numeric(12,2):=0; v_frete numeric(12,2):=0; v_pedido public.pedidos%rowtype; v_stock int; v_coupon record; v_settings jsonb; v_codigo text; v_image text;
begin
  if p_chave is null then raise exception 'idempotency_key_required'; end if;
  -- Serializa novas encomendas para que duas criações concorrentes também respeitem o limite.
  perform pg_advisory_xact_lock(72819430);
  if length(trim(coalesce(p_cliente->>'nome','')))<2 then raise exception 'customer_name_required'; end if;
  if auth.uid() is null and length(regexp_replace(coalesce(p_cliente->>'fone',''), '[^0-9]', '', 'g')) not between 10 and 13 then raise exception 'customer_phone_invalid'; end if;
  select * into v_pedido from public.pedidos where chave_idempotencia = p_chave;
  if found then return to_jsonb(v_pedido); end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'items_required'; end if;
  for v_item in select value from jsonb_array_elements(p_itens) loop
    v_qtd := greatest(1, least(99, coalesce((v_item->>'qtd')::int, 0)));
    select * into v_prod from public.produtos where id::text = v_item->>'id' and coalesce(rascunho,false) = false for share;
    if not found then raise exception 'product_unavailable'; end if;
    v_image:=v_prod.foto::text;
    if left(btrim(coalesce(v_image,'')),1)='[' then v_image:=coalesce((v_image::jsonb->>0),v_image);
    elsif left(btrim(coalesce(v_image,'')),1)='{' then v_image:=coalesce((v_image::jsonb->'geral'->>0),v_image); end if;
    v_cor := btrim(coalesce(v_item->>'cor',''));
    select coalesce(sum(greatest(1, least(99, coalesce((x.value->>'qtd')::int, 0)))), 0)::int
      into v_need
      from jsonb_array_elements(p_itens) x(value)
     where x.value->>'id' = v_item->>'id'
       and btrim(coalesce(x.value->>'cor','')) = v_cor;
    if coalesce(v_prod.estoque_por_cor,'{}'::jsonb) <> '{}'::jsonb then
      if v_cor = '' or not (v_prod.estoque_por_cor ? v_cor) then raise exception 'invalid_product_color:%', v_prod.nome; end if;
      v_stock := coalesce((v_prod.estoque_por_cor->>v_cor)::int,0);
    else v_stock := coalesce(v_prod.estoque,0); end if;
    if v_stock < 9999 and v_stock < v_need then raise exception 'insufficient_stock:%', v_prod.nome; end if;
    v_sub := v_sub + round(v_prod.preco * v_qtd, 2);
    v_itens := v_itens || jsonb_build_array(jsonb_build_object('id',v_prod.id,'nome',v_prod.nome,'foto',v_image,'cor',coalesce(v_item->>'cor',''),'tam',coalesce(v_item->>'tam',''),'qtd',v_qtd,'preco',v_prod.preco,'subtotal',round(v_prod.preco*v_qtd,2)));
  end loop;
  -- Never trust browser-submitted discount or delivery fee. Recalculate coupons
  -- from the public coupon table and delivery rules from saved store settings.
  v_codigo := upper(trim(coalesce(p_cliente->>'cupom','')));
  if v_codigo <> '' then
    select * into v_coupon from public.cupons where upper(codigo)=v_codigo;
    if not found or (nullif(v_coupon.validade::text,'') is not null and nullif(v_coupon.validade::text,'')::date < current_date) or v_sub < coalesce(v_coupon.minimo,0) then raise exception 'invalid_coupon'; end if;
    v_desc := case when v_coupon.tipo='porcento' then round(v_sub*least(100,greatest(0,v_coupon.valor))/100,2) else least(v_sub,greatest(0,v_coupon.valor)) end;
  end if;
  select to_jsonb(c) into v_settings from public.configuracoes c order by id limit 1;
  if coalesce((v_settings->'informacoes'->>'freteGratisAtivo')::boolean,false) and coalesce((v_settings->>'frete_gratis')::numeric,0)>0 and v_sub-v_desc>=coalesce((v_settings->>'frete_gratis')::numeric,0) then
    v_frete:=0;
  else v_frete:=greatest(0,coalesce((v_settings->'informacoes'->>'fretePadrao')::numeric,0)); end if;
  v_numero := '#' || lpad(nextval('public.pedidos_numero_seq')::text, 6, '0');
  insert into public.pedidos(numero,data,cliente_nome,cliente_fone,cliente_endereco,itens,subtotal,desconto,frete,total,pagamento,pagamento_status,cupom,status,estoque_baixado,origem,chave_idempotencia,observacao)
  values(v_numero,now(),left(coalesce(p_cliente->>'nome',''),120),left(coalesce(p_cliente->>'fone',''),30),left(coalesce(p_cliente->>'endereco',''),300),v_itens,v_sub,v_desc,v_frete,greatest(0,v_sub-v_desc+v_frete),left(coalesce(p_pagamento,''),50),'Pendente',v_codigo,'Pendente',false,case when auth.uid() is null then 'Site' else 'Painel' end,p_chave,left(coalesce(p_cliente->>'observacao',''),1000)) on conflict do nothing returning * into v_pedido;
   if not found then select * into v_pedido from public.pedidos where chave_idempotencia=p_chave; return to_jsonb(v_pedido); end if;
    insert into public.historico_pedidos(pedido_numero,status_novo,motivo) values(v_numero,'Pendente','Pedido recebido pelo site; aguardando confirmação no WhatsApp.');
   perform public.purge_old_orders(7);
   return to_jsonb(v_pedido);
end $$;

create or replace function public.admin_finalizar_venda(p_numero text, p_valor_final numeric, p_pagamentos jsonb, p_observacao text default '')
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_p public.pedidos%rowtype; v_v public.vendas%rowtype; v_pay jsonb; v_forma text; v_formas text:=''; v_val numeric(12,2); v_entregue numeric(12,2); v_troco numeric(12,2); v_soma numeric(12,2):=0; v_recebido numeric(12,2):=0; v_troco_total numeric(12,2):=0; v_prod public.produtos%rowtype; v_qtd int; v_cor text; v_anterior int; v_result int; v_session uuid;
begin
  if not public.sales_admin_authorized() then raise exception 'admin_auth_required'; end if;
  select * into v_p from public.pedidos where numero=p_numero for update;
  if not found then raise exception 'order_not_found'; end if;
  if exists(select 1 from public.vendas where pedido_numero=p_numero and status='Finalizado') then raise exception 'already_finalized'; end if;
  if v_p.status='Cancelado' then raise exception 'order_cancelled'; end if;
  if p_valor_final is null or p_valor_final < 0 or p_valor_final > v_p.total then raise exception 'invalid_final_amount'; end if;
  if jsonb_typeof(p_pagamentos)<>'array' or jsonb_array_length(p_pagamentos)=0 then raise exception 'payments_required'; end if;
  select id into v_session from public.sessoes_caixa where status='Aberto' order by aberto_em desc limit 1 for update;
  insert into public.vendas(pedido_numero,valor_original,desconto_negociado,valor_final,responsavel,reembolso_status)
  values(p_numero,v_p.total,greatest(0,v_p.total-p_valor_final),p_valor_final,auth.uid(),'Não necessário') returning * into v_v;
  for v_pay in select value from jsonb_array_elements(p_pagamentos) loop
    v_forma := v_pay->>'forma'; v_val := round(coalesce((v_pay->>'valor')::numeric,0),2); v_entregue := round(coalesce((v_pay->>'entregue')::numeric,v_val),2);
    if v_forma not in ('PIX','Dinheiro','Cartão de crédito','Cartão de débito','Transferência') or v_val <= 0 then raise exception 'invalid_payment'; end if;
    v_troco := case when v_forma='Dinheiro' then greatest(0,v_entregue-v_val) else 0 end;
    if v_forma='Dinheiro' and v_entregue < v_val then raise exception 'cash_received_below_due'; end if;
    if v_forma='Dinheiro' and v_session is null then raise exception 'open_cash_session_required'; end if;
    if position(v_forma in v_formas)=0 then v_formas:=case when v_formas='' then v_forma else v_formas||' + '||v_forma end; end if;
    v_soma := v_soma + v_val;
    v_recebido := v_recebido + v_entregue;
    v_troco_total := v_troco_total + v_troco;
    insert into public.pagamentos(venda_id,forma,valor,entregue,troco,criado_por) values(v_v.id,v_forma,v_val,v_entregue,v_troco,auth.uid());
    insert into public.movimentacoes_caixa(sessao_id,venda_id,tipo,valor,forma,descricao,criado_por) values(case when v_forma='Dinheiro' then v_session else null end,v_v.id,'Venda',v_val,v_forma,'Recebimento venda '||p_numero,auth.uid());
  end loop;
  if round(v_soma,2) <> round(p_valor_final,2) then raise exception 'payment_total_mismatch'; end if;
  for v_pay in select value from jsonb_array_elements(v_p.itens) loop
    v_qtd := (v_pay->>'qtd')::int; v_cor := coalesce(v_pay->>'cor','');
    select * into v_prod from public.produtos where id::text=v_pay->>'id' for update;
    if not found then raise exception 'product_unavailable'; end if;
    if coalesce(v_prod.estoque_por_cor,'{}'::jsonb) <> '{}'::jsonb then
      if v_cor='' or not (v_prod.estoque_por_cor ? v_cor) then raise exception 'invalid_product_color:%', v_prod.nome; end if;
      v_anterior := coalesce((v_prod.estoque_por_cor->>v_cor)::int,0);
      if v_anterior < 9999 and v_anterior < v_qtd then raise exception 'insufficient_stock:%',v_prod.nome; end if;
      if v_anterior < 9999 then update public.produtos set estoque_por_cor=jsonb_set(estoque_por_cor,array[v_cor],to_jsonb(v_anterior-v_qtd),true), estoque=greatest(0,estoque-v_qtd) where id=v_prod.id; v_result:=v_anterior-v_qtd; else v_result:=v_anterior; end if;
    else
      v_anterior := coalesce(v_prod.estoque,0);
      if v_anterior < 9999 and v_anterior < v_qtd then raise exception 'insufficient_stock:%',v_prod.nome; end if;
      if v_anterior < 9999 then update public.produtos set estoque=greatest(0,estoque-v_qtd) where id=v_prod.id; v_result:=v_anterior-v_qtd; else v_result:=v_anterior; end if;
    end if;
    insert into public.movimentacoes_estoque(pedido_numero,produto_id,cor,tipo,quantidade,estoque_anterior,estoque_resultante,criado_por) values(p_numero,v_prod.id::text,v_cor,'Venda',v_qtd,v_anterior,v_result,auth.uid());
  end loop;
  update public.vendas set status='Finalizado' where id=v_v.id returning * into v_v;
   update public.pedidos set status='Concluído',pagamento=left(v_formas,100),pagamento_status='Pago',desconto=desconto+greatest(0,v_p.total-p_valor_final),total=p_valor_final,valor_recebido=v_recebido,troco=v_troco_total,observacao=left(coalesce(p_observacao,''),1000),estoque_baixado=true,estoque_estornado=false,fechado_em=now(),atualizado_em=now() where numero=p_numero returning * into v_p;
  insert into public.auditoria_vendas(pedido_numero,acao,depois,ator) values(p_numero,'finalizar',to_jsonb(v_v),auth.uid());
  return jsonb_build_object('order',to_jsonb(v_p),'sale',to_jsonb(v_v));
end $$;

create or replace function public.admin_cancelar_venda(p_numero text, p_motivo text, p_reembolso_status text default 'Pendente')
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_p public.pedidos%rowtype; v_v public.vendas%rowtype; v_m record; v_payment record; v_prod public.produtos%rowtype; v_anterior int; v_qtd int; v_cor text; v_session uuid;
begin
  if not public.sales_admin_authorized() then raise exception 'admin_auth_required'; end if;
  if length(trim(coalesce(p_motivo,'')))<3 then raise exception 'cancellation_reason_required'; end if;
  if p_reembolso_status not in ('Pendente','Realizado','Não necessário') then raise exception 'invalid_refund_status'; end if;
  select * into v_p from public.pedidos where numero=p_numero for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_p.status='Cancelado' then raise exception 'already_cancelled'; end if;
  select * into v_v from public.vendas where pedido_numero=p_numero for update;
  if not found then update public.pedidos set status='Cancelado',motivo_cancelamento=left(p_motivo,500),reembolso_status='Não necessário',estoque_estornado=true,atualizado_em=now() where numero=p_numero returning * into v_p;
  else
    if v_v.status='Cancelado' then raise exception 'already_cancelled'; end if;
    if v_p.estoque_baixado and not v_p.estoque_estornado then
      for v_m in select * from public.movimentacoes_estoque where pedido_numero=p_numero and tipo='Venda' loop
        select * into v_prod from public.produtos where id::text=v_m.produto_id for update;
        if not found then raise exception 'product_unavailable_for_restock'; end if;
        v_qtd:=v_m.quantidade; v_cor:=v_m.cor;
        if v_cor<>'' and coalesce(v_prod.estoque_por_cor,'{}'::jsonb) ? v_cor then
          v_anterior:=coalesce((v_prod.estoque_por_cor->>v_cor)::int,0);
          update public.produtos set estoque_por_cor=jsonb_set(estoque_por_cor,array[v_cor],to_jsonb(v_anterior+v_qtd),true),estoque=estoque+v_qtd where id=v_prod.id;
        else v_anterior:=coalesce(v_prod.estoque,0); update public.produtos set estoque=estoque+v_qtd where id=v_prod.id; end if;
        insert into public.movimentacoes_estoque(pedido_numero,produto_id,cor,tipo,quantidade,estoque_anterior,estoque_resultante,criado_por) values(p_numero,v_prod.id::text,v_cor,'Estorno',v_qtd,v_anterior,v_anterior+v_qtd,auth.uid());
      end loop;
    end if;
    update public.vendas set status='Cancelado',cancelada_em=now(),cancelamento_motivo=left(p_motivo,500),reembolso_status=p_reembolso_status where id=v_v.id returning * into v_v;
    if p_reembolso_status='Realizado' then
      for v_payment in select * from public.pagamentos where venda_id=v_v.id and status='Recebido' loop
        v_session:=null;
        if v_payment.forma='Dinheiro' then select id into v_session from public.sessoes_caixa where status='Aberto' order by aberto_em desc limit 1 for update; if v_session is null then raise exception 'open_cash_session_required_for_cash_refund'; end if; end if;
        insert into public.movimentacoes_caixa(sessao_id,venda_id,pagamento_id,tipo,valor,forma,descricao,criado_por)
        values(v_session,v_v.id,v_payment.id,'Reembolso',v_payment.valor,v_payment.forma,'Reembolso venda '||p_numero,auth.uid());
        update public.pagamentos set status='Reembolsado' where id=v_payment.id;
      end loop;
      update public.vendas set reembolsada=valor_final where id=v_v.id returning * into v_v;
    elsif p_reembolso_status='Pendente' then
      update public.pagamentos set status='Reembolso pendente' where venda_id=v_v.id and status='Recebido';
    end if;
    update public.pedidos set status='Cancelado',motivo_cancelamento=left(p_motivo,500),reembolso_status=p_reembolso_status,estoque_estornado=true,atualizado_em=now() where numero=p_numero returning * into v_p;
  end if;
  insert into public.auditoria_vendas(pedido_numero,acao,antes,depois,ator) values(p_numero,'cancelar',to_jsonb(v_p),jsonb_build_object('motivo',p_motivo,'reembolso',p_reembolso_status),auth.uid());
  return jsonb_build_object('order',to_jsonb(v_p),'sale',to_jsonb(v_v));
end $$;

create or replace function public.admin_excluir_pedido(p_numero text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_p public.pedidos%rowtype;
  v_m record;
  v_prod public.produtos%rowtype;
  v_anterior int;
  v_qtd int;
  v_cor text;
  v_venda_ids uuid[];
begin
  if not public.sales_admin_authorized() then raise exception 'admin_auth_required'; end if;
  select * into v_p from public.pedidos where numero = p_numero for update;
  if not found then raise exception 'order_not_found'; end if;

  -- A exclusão é física, mas a baixa precisa ser revertida antes de remover seus movimentos.
  if v_p.estoque_baixado and not v_p.estoque_estornado then
    for v_m in select * from public.movimentacoes_estoque where pedido_numero = p_numero and tipo = 'Venda' order by criado_em for update loop
      select * into v_prod from public.produtos where id::text = v_m.produto_id for update;
      if not found then raise exception 'product_unavailable_for_restock'; end if;
      v_qtd := v_m.quantidade;
      v_cor := coalesce(v_m.cor, '');
      if coalesce(v_prod.estoque_por_cor,'{}'::jsonb) <> '{}'::jsonb then
        if v_cor = '' or not (v_prod.estoque_por_cor ? v_cor) then raise exception 'invalid_product_color:%', v_prod.nome; end if;
        v_anterior := coalesce((v_prod.estoque_por_cor->>v_cor)::int, 0);
        update public.produtos
           set estoque_por_cor = jsonb_set(estoque_por_cor, array[v_cor], to_jsonb(v_anterior + v_qtd), true), estoque = estoque + v_qtd
         where id = v_prod.id;
      else
        v_anterior := coalesce(v_prod.estoque, 0);
        update public.produtos set estoque = estoque + v_qtd where id = v_prod.id;
      end if;
    end loop;
  end if;

  select coalesce(array_agg(id), '{}'::uuid[]) into v_venda_ids from public.vendas where pedido_numero = p_numero;
  if cardinality(v_venda_ids) > 0 then
    delete from public.movimentacoes_caixa where venda_id = any(v_venda_ids);
    delete from public.pagamentos where venda_id = any(v_venda_ids);
  end if;
  delete from public.movimentacoes_estoque where pedido_numero = p_numero;
  delete from public.auditoria_vendas where pedido_numero = p_numero;
  delete from public.historico_pedidos where pedido_numero = p_numero;
  delete from public.vendas where pedido_numero = p_numero;
  delete from public.pedidos where numero = p_numero;
  return jsonb_build_object('numero', p_numero, 'deleted', true);
end $$;

create or replace function public.admin_atualizar_status_pedido(p_numero text, p_status text, p_motivo text default '')
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_p public.pedidos%rowtype; v_anterior text;
begin
  if not public.sales_admin_authorized() then raise exception 'admin_auth_required'; end if;
  if p_status not in ('Pendente','Em atendimento','Aguardando pagamento','Novo','Em preparação','Enviado','Arquivado') then raise exception 'invalid_status_transition'; end if;
  select * into v_p from public.pedidos where numero=p_numero for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_p.status in ('Concluído','Cancelado') and p_status <> 'Arquivado' then raise exception 'closed_order_status_locked'; end if;
  v_anterior:=v_p.status;
  update public.pedidos set status=p_status,atualizado_em=now() where numero=p_numero returning * into v_p;
  insert into public.auditoria_vendas(pedido_numero,acao,antes,depois,ator) values(p_numero,'status',jsonb_build_object('status',v_anterior),jsonb_build_object('status',p_status),auth.uid());
  return to_jsonb(v_p);
end $$;

create or replace function public.admin_editar_pedido(p_numero text,p_desconto numeric,p_frete numeric,p_pagamento text,p_pagamento_status text,p_observacao text default '')
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_p public.pedidos%rowtype;
begin
  if not public.sales_admin_authorized() then raise exception 'admin_auth_required'; end if;
  select * into v_p from public.pedidos where numero=p_numero for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_p.status in ('Concluído','Cancelado','Arquivado') then raise exception 'closed_order_locked'; end if;
  if p_desconto<0 or p_desconto>v_p.subtotal or p_frete<0 then raise exception 'invalid_financial_values'; end if;
  if p_pagamento_status not in ('Pendente','Pago','Estornado') then raise exception 'invalid_payment_status'; end if;
  update public.pedidos set desconto=p_desconto,frete=p_frete,total=greatest(0,subtotal-p_desconto+p_frete),pagamento=left(coalesce(p_pagamento,''),50),pagamento_status=p_pagamento_status,observacao=left(coalesce(p_observacao,''),1000),atualizado_em=now() where numero=p_numero returning * into v_p;
  return to_jsonb(v_p);
end $$;

create or replace function public.admin_editar_itens_pedido(p_numero text,p_itens jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_p public.pedidos%rowtype; v_input jsonb; v_prod public.produtos%rowtype; v_out jsonb:='[]'::jsonb; v_sub numeric(12,2):=0; v_qtd integer; v_need integer; v_cor text; v_foto text;
begin
  if not public.sales_admin_authorized() then raise exception 'admin_auth_required'; end if;
  select * into v_p from public.pedidos where numero=p_numero for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_p.status in ('Concluído','Cancelado','Arquivado') then raise exception 'closed_order_locked'; end if;
  if jsonb_typeof(p_itens)<>'array' or jsonb_array_length(p_itens)=0 then raise exception 'items_required'; end if;
  for v_input in select value from jsonb_array_elements(p_itens) loop
    v_qtd:=coalesce((v_input->>'qtd')::integer,0);v_cor:=coalesce(v_input->>'cor','');
    if v_qtd<1 or v_qtd>99 then raise exception 'invalid_item_quantity'; end if;
    select * into v_prod from public.produtos where id::text=v_input->>'id' and coalesce(rascunho,false)=false for share;
    if not found then raise exception 'product_unavailable'; end if;
    select sum(greatest(0,coalesce((x.value->>'qtd')::integer,0))) into v_need from jsonb_array_elements(p_itens) x(value) where x.value->>'id'=v_input->>'id' and coalesce(x.value->>'cor','')=v_cor;
    if coalesce(v_prod.estoque_por_cor,'{}'::jsonb) <> '{}'::jsonb then
      if v_cor='' or not (v_prod.estoque_por_cor ? v_cor) then raise exception 'invalid_product_color:%', v_prod.nome; end if;
      if coalesce((v_prod.estoque_por_cor->>v_cor)::integer,0)<v_need then raise exception 'insufficient_stock:%',v_prod.nome; end if;
    elsif coalesce(v_prod.estoque,0)<9999 and coalesce(v_prod.estoque,0)<v_need then raise exception 'insufficient_stock:%',v_prod.nome; end if;
    v_foto:=v_prod.foto::text;
    if left(btrim(coalesce(v_foto,'')),1)='[' then v_foto:=coalesce(v_foto::jsonb->>0,v_foto); elsif left(btrim(coalesce(v_foto,'')),1)='{' then v_foto:=coalesce(v_foto::jsonb->'geral'->>0,v_foto); end if;
    v_sub:=v_sub+round(v_prod.preco*v_qtd,2);
    v_out:=v_out||jsonb_build_array(jsonb_build_object('id',v_prod.id,'nome',v_prod.nome,'foto',v_foto,'cor',v_cor,'tam',coalesce(v_input->>'tam',''),'qtd',v_qtd,'preco',v_prod.preco,'subtotal',round(v_prod.preco*v_qtd,2)));
  end loop;
  update public.pedidos set itens=v_out,subtotal=v_sub,desconto=least(desconto,v_sub),total=greatest(0,v_sub-least(desconto,v_sub)+frete),atualizado_em=now() where numero=p_numero returning * into v_p;
  return to_jsonb(v_p);
end $$;

create or replace function public.admin_registrar_reembolso(p_numero text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_p public.pedidos%rowtype; v_v public.vendas%rowtype; v_payment record; v_session uuid; v_total numeric(12,2):=0;
begin
  if not public.sales_admin_authorized() then raise exception 'admin_auth_required'; end if;
  select * into v_p from public.pedidos where numero=p_numero for update;
  if not found or v_p.status<>'Cancelado' then raise exception 'cancelled_order_required'; end if;
  select * into v_v from public.vendas where pedido_numero=p_numero for update;
  if not found then raise exception 'sale_not_found'; end if;
  if v_v.reembolso_status='Realizado' then return jsonb_build_object('order',to_jsonb(v_p),'sale',to_jsonb(v_v),'already_refunded',true); end if;
  for v_payment in select * from public.pagamentos where venda_id=v_v.id and status in ('Recebido','Reembolso pendente') loop
    v_session:=null;
    if v_payment.forma='Dinheiro' then select id into v_session from public.sessoes_caixa where status='Aberto' order by aberto_em desc limit 1 for update; if v_session is null then raise exception 'open_cash_session_required_for_cash_refund'; end if; end if;
    insert into public.movimentacoes_caixa(sessao_id,venda_id,pagamento_id,tipo,valor,forma,descricao,criado_por)
      values(v_session,v_v.id,v_payment.id,'Reembolso',v_payment.valor,v_payment.forma,'Reembolso venda '||p_numero,auth.uid());
    update public.pagamentos set status='Reembolsado' where id=v_payment.id;
    v_total:=v_total+v_payment.valor;
  end loop;
  update public.vendas set reembolsada=v_total,reembolso_status='Realizado' where id=v_v.id returning * into v_v;
  update public.pedidos set reembolso_status='Realizado',atualizado_em=now() where numero=p_numero returning * into v_p;
  insert into public.auditoria_vendas(pedido_numero,acao,antes,depois,ator) values(p_numero,'reembolso',to_jsonb(v_v),jsonb_build_object('valor',v_total),auth.uid());
  return jsonb_build_object('order',to_jsonb(v_p),'sale',to_jsonb(v_v));
end $$;

revoke all on function public.site_criar_pedido(uuid,jsonb,jsonb,text,numeric,numeric) from public;
grant execute on function public.site_criar_pedido(uuid,jsonb,jsonb,text,numeric,numeric) to anon, authenticated;
revoke all on function public.admin_finalizar_venda(text,numeric,jsonb,text) from public, anon;
grant execute on function public.admin_finalizar_venda(text,numeric,jsonb,text) to authenticated;
revoke all on function public.admin_cancelar_venda(text,text,text) from public, anon;
grant execute on function public.admin_cancelar_venda(text,text,text) to authenticated;
revoke all on function public.admin_excluir_pedido(text) from public, anon;
grant execute on function public.admin_excluir_pedido(text) to authenticated;
revoke all on function public.admin_atualizar_status_pedido(text,text,text) from public, anon;
grant execute on function public.admin_atualizar_status_pedido(text,text,text) to authenticated;
revoke all on function public.admin_editar_pedido(text,numeric,numeric,text,text,text) from public, anon;
grant execute on function public.admin_editar_pedido(text,numeric,numeric,text,text,text) to authenticated;
revoke all on function public.admin_editar_itens_pedido(text,jsonb) from public, anon;
grant execute on function public.admin_editar_itens_pedido(text,jsonb) to authenticated;
revoke all on function public.admin_registrar_reembolso(text) from public, anon;
grant execute on function public.admin_registrar_reembolso(text) to authenticated;
revoke all on function public.admin_abrir_caixa(numeric,text) from public, anon;
grant execute on function public.admin_abrir_caixa(numeric,text) to authenticated;
revoke all on function public.admin_fechar_caixa(uuid,numeric,text) from public, anon;
grant execute on function public.admin_fechar_caixa(uuid,numeric,text) to authenticated;
revoke all on function public.admin_movimento_caixa(text,numeric,text,text) from public, anon;
grant execute on function public.admin_movimento_caixa(text,numeric,text,text) to authenticated;

do $$ declare t text; begin
  foreach t in array array['produtos','categorias','cupons','configuracoes','pedidos','vendas','pagamentos','movimentacoes_caixa','sessoes_caixa','movimentacoes_estoque'] loop
    begin execute format('alter publication supabase_realtime add table public.%I',t);
    exception when duplicate_object then null; when undefined_object then null; end;
  end loop;
end $$;

-- O painel nunca deve gravar diretamente no catálogo/configuração por REST.
-- Leitura pública existente permanece intacta; toda escrita passa pelo painel autorizado.
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and tablename in ('produtos','categorias','cupons','configuracoes')
       and cmd in ('*','a','w','d','INSERT','UPDATE','DELETE','ALL')
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

do $$ declare t text; begin
  foreach t in array array['produtos','categorias','cupons','configuracoes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_write', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.sales_admin_authorized()) with check (public.sales_admin_authorized())', t || '_admin_write', t);
  end loop;
end $$;

-- A migration já deixa o banco respeitando o teto, removendo os mais antigos.
select public.purge_old_orders(7);

commit;
