-- =====================================================================
-- Controle de Pagamentos - Schema MySQL
-- Importe pelo phpMyAdmin (aba "Importar") ou: mysql -u root < schema.sql
-- =====================================================================

CREATE DATABASE IF NOT EXISTS controle_pagamentos
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE controle_pagamentos;

-- ---------------------------------------------------------------------
-- RF01: usuários (senha armazenada apenas como hash bcrypt)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome          VARCHAR(100) NOT NULL,
  email         VARCHAR(150) NOT NULL,
  senha_hash    VARCHAR(255) NOT NULL,
  criado_em     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuarios_email (email)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- RF02: contas, boletos e assinaturas
-- proximo_vencimento avança conforme o ciclo ao "Marcar como Pago"
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contas (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id          INT UNSIGNED NOT NULL,
  nome                VARCHAR(100) NOT NULL,
  categoria           VARCHAR(50)  NOT NULL,
  valor               DECIMAL(10,2) UNSIGNED NOT NULL,
  ciclo               ENUM('mensal','anual','semanal') NOT NULL DEFAULT 'mensal',
  proximo_vencimento  DATE NOT NULL,
  -- Dia do mês original do vencimento: evita que 31/jan -> 28/fev vire 28 para sempre
  dia_ancora          TINYINT UNSIGNED NOT NULL DEFAULT 1,
  ativa               TINYINT(1) NOT NULL DEFAULT 1,
  criado_em           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_contas_usuario (usuario_id),
  KEY idx_contas_vencimento (proximo_vencimento, ativa),
  CONSTRAINT fk_contas_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Histórico de baixas ("Marcar como Pago")
-- Guarda o valor e o vencimento que foi quitado, mesmo que a conta mude depois.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pagamentos (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  conta_id          INT UNSIGNED NOT NULL,
  usuario_id        INT UNSIGNED NOT NULL,
  valor_pago        DECIMAL(10,2) UNSIGNED NOT NULL,
  data_vencimento   DATE NOT NULL,
  pago_em           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pagamentos_conta (conta_id),
  KEY idx_pagamentos_usuario (usuario_id, pago_em),
  CONSTRAINT fk_pagamentos_conta
    FOREIGN KEY (conta_id) REFERENCES contas (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_pagamentos_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- RF04: inscrições Web Push (um usuário pode ter vários dispositivos)
-- endpoint_hash (SHA-256 do endpoint) garante unicidade sem estourar
-- o limite de índice em endpoints longos.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id     INT UNSIGNED NOT NULL,
  endpoint       TEXT NOT NULL,
  endpoint_hash  CHAR(64) NOT NULL,
  p256dh         VARCHAR(255) NOT NULL,
  auth           VARCHAR(255) NOT NULL,
  user_agent     VARCHAR(255) NULL,
  criado_em      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_push_endpoint (endpoint_hash),
  KEY idx_push_usuario (usuario_id),
  CONSTRAINT fk_push_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- RN02: controle de idempotência dos alertas
-- Impede notificação duplicada se o cron rodar mais de uma vez no dia
-- (ex.: servidor reiniciado). 'vespera' = 1 dia antes; 'dia' = no vencimento.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notificacoes_enviadas (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  conta_id          INT UNSIGNED NOT NULL,
  tipo              ENUM('vespera','dia') NOT NULL,
  data_vencimento   DATE NOT NULL,
  enviada_em        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_notificacao (conta_id, tipo, data_vencimento),
  CONSTRAINT fk_notificacoes_conta
    FOREIGN KEY (conta_id) REFERENCES contas (id)
    ON DELETE CASCADE
) ENGINE=InnoDB;