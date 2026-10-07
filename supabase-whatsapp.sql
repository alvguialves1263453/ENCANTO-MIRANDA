-- Configuração persistente da mensagem de pedido do WhatsApp.
alter table public.configuracoes
  add column if not exists whatsapp_config jsonb not null default
  '{"mensagemPedido":"Olá! Sou [nome], quero finalizar meu pedido [pedido] na [loja].\n\n[itens]\n\nSubtotal: [subtotal]\nDesconto: [desconto]\nCupom: [cupom]\nTotal: [valor total]\nPagamento: [pagamento]"}'::jsonb;

comment on column public.configuracoes.whatsapp_config is
  'Configurações do WhatsApp da loja, incluindo o template da mensagem de pedido';
