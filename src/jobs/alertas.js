'use strict';

const cron = require('node-cron');
const { pool } = require('../../db');
const { hojeISO, somarDias } = require('../lib/datas');
const { enviarParaUsuario } = require('../lib/push');
const { montarNotificacao } = require('../lib/notificacoes');

let emExecucao = false;

/**
 * RN02: avisa as contas que vencem AMANHÃ ('vespera') e HOJE ('dia').
 *
 * Idempotência: antes de enviar, cada conta é "reservada" na tabela
 * notificacoes_enviadas (chave única conta + tipo + vencimento). Se a reserva
 * já existe, a conta é ignorada, então reiniciar o servidor ou rodar o job de
 * novo no mesmo dia não duplica alertas. Se nenhum envio der certo (usuário
 * sem aparelho inscrito, falha de rede), a reserva é desfeita para permitir
 * nova tentativa.
 */
async function executar() {
  if (emExecucao) {
    console.warn('[alertas] Execução anterior ainda em andamento; ignorando.');
    return null;
  }
  emExecucao = true;

  const resumo = { contasEncontradas: 0, notificacoes: 0, dispositivos: 0, puladas: 0 };

  try {
    const hoje = hojeISO();
    const amanha = somarDias(hoje, 1);

    const [contas] = await pool.execute(
      `SELECT id, usuario_id, nome, valor, proximo_vencimento
         FROM contas
        WHERE ativa = 1 AND proximo_vencimento IN (?, ?)
        ORDER BY usuario_id, proximo_vencimento, nome`,
      [hoje, amanha]
    );
    resumo.contasEncontradas = contas.length;

    // Agrupa por usuário + tipo: 1 notificação por grupo
    const grupos = new Map();
    for (const c of contas) {
      const tipo = c.proximo_vencimento === hoje ? 'dia' : 'vespera';
      const chave = `${c.usuario_id}|${tipo}`;
      if (!grupos.has(chave)) grupos.set(chave, { usuarioId: c.usuario_id, tipo, contas: [] });
      grupos.get(chave).contas.push(c);
    }

    for (const grupo of grupos.values()) {
      // Reserva cada conta; só segue com as que ainda não foram avisadas
      const reservadas = [];
      for (const c of grupo.contas) {
        const [r] = await pool.execute(
          `INSERT IGNORE INTO notificacoes_enviadas (conta_id, tipo, data_vencimento)
           VALUES (?, ?, ?)`,
          [c.id, grupo.tipo, c.proximo_vencimento]
        );
        if (r.affectedRows === 1) reservadas.push(c);
        else resumo.puladas += 1;
      }
      if (!reservadas.length) continue;

      let envio;
      try {
        envio = await enviarParaUsuario(grupo.usuarioId, montarNotificacao(reservadas, grupo.tipo));
      } catch (err) {
        console.error(`[alertas] Erro ao notificar usuário ${grupo.usuarioId}:`, err.message);
        envio = { enviadas: 0 };
      }

      if (envio.enviadas > 0) {
        resumo.notificacoes += 1;
        resumo.dispositivos += envio.enviadas;
      } else {
        // Nada foi entregue: libera a reserva para uma próxima tentativa
        for (const c of reservadas) {
          await pool.execute(
            'DELETE FROM notificacoes_enviadas WHERE conta_id = ? AND tipo = ? AND data_vencimento = ?',
            [c.id, grupo.tipo, c.proximo_vencimento]
          );
        }
      }
    }

    // Manutenção: registros antigos não servem mais para a idempotência
    await pool.execute('DELETE FROM notificacoes_enviadas WHERE data_vencimento < ?', [
      somarDias(hoje, -60),
    ]);

    console.log(
      `[alertas] ${hoje}: ${resumo.contasEncontradas} conta(s) a vencer, ` +
        `${resumo.notificacoes} notificação(ões) para ${resumo.dispositivos} dispositivo(s), ` +
        `${resumo.puladas} já avisada(s).`
    );
    return resumo;
  } catch (err) {
    console.error('[alertas] Falha na verificação diária:', err);
    return null;
  } finally {
    emExecucao = false;
  }
}

function iniciar() {
  const expressao = process.env.CRON_SCHEDULE || '0 8 * * *';
  const timezone = process.env.CRON_TIMEZONE || 'America/Sao_Paulo';

  if (!cron.validate(expressao)) {
    throw new Error(`CRON_SCHEDULE inválido: "${expressao}"`);
  }

  cron.schedule(expressao, executar, { timezone });
  console.log(`[alertas] Verificação diária agendada: "${expressao}" (${timezone}).`);

  // Útil em desenvolvimento: roda uma vez ao subir o servidor (é idempotente)
  if (process.env.ALERTAS_RODAR_AO_INICIAR === 'true') {
    setTimeout(executar, 3000);
  }
}

module.exports = { iniciar, executar };
