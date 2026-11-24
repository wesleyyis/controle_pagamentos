-- =====================================================================
-- Teste opcional do cálculo de vencimentos (rode no SQL Editor depois do 01_schema.sql).
-- Se algum caso falhar, aparece "assertion failed" apontando a linha.
-- =====================================================================
do $$
begin
  -- mensal: vira o ano
  assert public.proximo_vencimento_ciclo('2026-12-15', 'mensal', 15) = date '2027-01-15';
  -- mensal: dia 31 não "deriva" depois de fevereiro
  assert public.proximo_vencimento_ciclo('2026-01-31', 'mensal', 31) = date '2026-02-28';
  assert public.proximo_vencimento_ciclo('2026-02-28', 'mensal', 31) = date '2026-03-31';
  assert public.proximo_vencimento_ciclo('2026-03-31', 'mensal', 31) = date '2026-04-30';
  -- semanal
  assert public.proximo_vencimento_ciclo('2026-12-28', 'semanal', 28) = date '2027-01-04';
  -- anual: 29/fev em ano bissexto e não bissexto
  assert public.proximo_vencimento_ciclo('2028-02-29', 'anual', 29) = date '2029-02-28';
  assert public.proximo_vencimento_ciclo('2031-02-28', 'anual', 29) = date '2032-02-29';
  assert public.proximo_vencimento_ciclo('2026-11-18', 'anual', 18) = date '2027-11-18';
  raise notice 'proximo_vencimento_ciclo: todos os casos OK';
end;
$$;
