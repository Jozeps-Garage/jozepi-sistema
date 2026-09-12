-- ============================================================
-- DESFAZ a migration 027 (pré-cadastro de cliente).
--
-- A 027 só adicionou duas colunas com valor padrão, então desfazer é derrubá-las.
-- Nenhuma tabela, coluna ou restrição anterior foi tocada: o banco volta ao formato exato.
--
-- ⚠️ O que se perde: a marcação de quais clientes/veículos estão incompletos. Os registros
-- em si CONTINUAM lá (com telefone vazio, como foram criados) — não some agendamento nem cliente.
-- Para achá-los depois de desfazer: select * from clients where phone = '';
-- ============================================================

DROP INDEX IF EXISTS public.idx_vehicles_pre_cadastro;
DROP INDEX IF EXISTS public.idx_clients_pre_cadastro;

ALTER TABLE public.vehicles DROP COLUMN IF EXISTS pre_cadastro;
ALTER TABLE public.clients  DROP COLUMN IF EXISTS pre_cadastro;
