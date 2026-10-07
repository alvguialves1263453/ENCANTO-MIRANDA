-- ============================================================
-- ENCANTO MIRANDA — parcelas por produto (rode UMA vez)
-- COMO RODAR:
--  1. Abra https://supabase.com/dashboard > seu projeto
--  2. Menu lateral > SQL Editor > New query
--  3. Cole TODO este arquivo > RUN > espere "Success"
-- ============================================================

alter table produtos
  add column if not exists parcelas int not null default 6;

-- garante limite sensato nos registros antigos (1x a 12x)
update produtos set parcelas = 6 where parcelas is null or parcelas < 1 or parcelas > 12;
