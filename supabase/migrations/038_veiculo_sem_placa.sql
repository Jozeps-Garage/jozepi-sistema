-- Permite cadastrar o veículo antes de ver o carro (placa vem depois).
-- Execute no Supabase → SQL Editor → Run.
--
-- Com plate NOT NULL, quem cadastrava o cliente sem ter o carro na frente
-- precisava inventar um valor — foi assim que nasceram placas como "123",
-- "0" e até o nome do dono no campo errado.
--
-- Se você já soltou o NOT NULL pelo painel, rodar isto de novo não faz mal.

ALTER TABLE vehicles
  ALTER COLUMN plate DROP NOT NULL;

-- Placa vazia e placa ausente passam a ser a mesma coisa, para a listagem não
-- ter que checar os dois casos.
UPDATE vehicles
   SET plate = NULL
 WHERE plate IS NOT NULL
   AND trim(plate) = '';

-- Veículo sem placa é pré-cadastro: é o que o app já usa para "falta preencher".
UPDATE vehicles
   SET pre_cadastro = TRUE
 WHERE plate IS NULL
   AND pre_cadastro IS DISTINCT FROM TRUE;
