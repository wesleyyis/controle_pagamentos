-- Execute APENAS se você já importou o schema.sql antes desta etapa.
-- (Instalações novas já trazem a coluna no schema.sql.)
USE controle_pagamentos;

ALTER TABLE contas
  ADD COLUMN dia_ancora TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER proximo_vencimento;

UPDATE contas SET dia_ancora = DAY(proximo_vencimento);