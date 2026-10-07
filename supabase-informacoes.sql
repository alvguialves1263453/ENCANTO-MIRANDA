-- Informações editáveis exibidas nos benefícios da loja.
-- O conteúdo fica em JSON para manter uma única configuração por loja.
alter table public.configuracoes
  add column if not exists informacoes jsonb not null default '{"atendimento":"Atendimento","horarioAtendimento":"Seg a Sáb, 9h–18h","prazoEnvio":"Envio em 2 dias úteis","envioDetalhe":"Correios com rastreio"}'::jsonb;

update public.configuracoes
set informacoes = coalesce(informacoes, '{"atendimento":"Atendimento","horarioAtendimento":"Seg a Sáb, 9h–18h","prazoEnvio":"Envio em 2 dias úteis","envioDetalhe":"Correios com rastreio"}'::jsonb)
where id = 1;
