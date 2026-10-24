-- Conserta o saldo de utensílios que depreciavam por uso.
-- Execute no Supabase → SQL Editor → Run.
--
-- A 047 trouxe `on_hand` a partir de `quantity`, que no modelo antigo era a
-- contagem de unidades. Só que para o utensílio marcado com depreciação por
-- uso (usage_per_wash_ml = 'usage') aquele mesmo campo guardava a VIDA ÚTIL
-- em usos — a Lavadora WAP4000, por exemplo, tinha 1000 ali.
--
-- Resultado: ela aparecia como "1000 unidades" e o total investido somava
-- R$ 849.000 de uma lavadora só.
--
-- Equipamento é peça única: o saldo volta para 1. Se algum deles for mesmo
-- patrimônio — e a lavadora é —, troque a categoria no cadastro, que aí ele
-- sai da contagem de vez.

UPDATE products
SET on_hand = 1
WHERE kind = 'utensilio'
  AND usage_per_wash_ml = 'usage'
  AND on_hand > 1;

-- Confira o que sobrou com saldo alto demais para ser contagem de prateleira:
-- SELECT name, on_hand, unit_label, total_cost
-- FROM products
-- WHERE kind <> 'patrimonio' AND on_hand > 50
-- ORDER BY on_hand DESC;
