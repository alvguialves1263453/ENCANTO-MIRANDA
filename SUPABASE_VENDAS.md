# Vendas e caixa no Supabase

## Instalação obrigatória

As alterações locais não entram no banco automaticamente. No SQL Editor do projeto `qccboyqaskaiphlskmpa`, execute:

1. `supabase-sales-migration.sql` — cria/atualiza a estrutura base de pedidos, trilha financeira, sessões do caixa, RPCs, políticas RLS e retenção automática dos 7 pedidos mais recentes.

O migration pressupõe as tabelas já usadas pela loja: `produtos`, `cupons` e `configuracoes`, incluindo os campos registrados no `loja-db.js`.

## Permissão de administrador

As RPCs administrativas exigem uma sessão Supabase Auth cujo `app_metadata.role` seja `admin`. Configure esse claim no usuário proprietário pela área **Authentication → Users → usuário → Edit app metadata**:

```json
{"role":"admin"}
```

Não use `user_metadata` para autorização. O cliente não deve conseguir editar `app_metadata`.

## Fluxos cobertos

- Checkout do carrinho e da página do produto chama `site_criar_pedido`, aguarda a resposta confirmada e só então abre o WhatsApp. A chave idempotente de sessão impede pedidos duplicados em retries.
- O RPC consulta produtos, preços, imagens, cupons e frete no banco. Pedido inicial fica `Pendente`; não baixa estoque.
- `admin_finalizar_venda` finaliza venda, valida pagamentos, baixa estoque geral/por cor e grava pagamentos, caixa, estoque e auditoria em uma única transação. Dinheiro exige sessão de caixa aberta.
- `admin_cancelar_venda` registra motivo, estorna estoque uma vez e só lança saída financeira quando o reembolso for marcado como realizado.
- `admin_atualizar_status_pedido` e `admin_editar_pedido` gravam alterações autorizadas com histórico/auditoria.
- `admin_abrir_caixa`, `admin_fechar_caixa` e `admin_movimento_caixa` controlam abertura, divergência e entradas/saídas manuais.

## Verificações após executar

1. Marque o `app_metadata.role` do usuário administrativo.
2. Faça logout/login no painel para renovar o JWT.
3. Faça um pedido de teste real no carrinho; confirme que o WhatsApp só abre após o pedido aparecer em `pedidos`.
4. Abra o caixa antes de finalizar um pagamento em dinheiro.
5. Confirme na tela Vendas os registros em `vendas`, `pagamentos`, `movimentacoes_caixa`, `movimentacoes_estoque`, `historico_pedidos` e `auditoria_vendas`.
6. Teste concorrência e RLS no projeto antes de operar com clientes reais.

## Limites da versão atual

- A migration ainda precisa ser aplicada no Supabase remoto; até lá, os novos RPCs retornarão erro.
- A retenção de sete pedidos apaga permanentemente os pedidos excedentes e seus dados relacionados; vendas antigas removidas não repõem estoque.
- Os filtros atuais cobrem status, busca por pedido/cliente/telefone/produto e intervalo de datas; a exportação CSV exporta o histórico filtrado.
- Não há ainda paginação, relatórios gráficos, devolução parcial ou integração de comprovantes/PDF.
- Sessões de caixa fechadas permanecem armazenadas; dados de pedidos só são retidos para os 7 mais recentes.
