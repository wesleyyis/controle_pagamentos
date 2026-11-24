'use strict';

/**
 * Utilitários de data trabalhando SEMPRE com strings 'YYYY-MM-DD'.
 * Evita os deslocamentos de fuso que acontecem ao misturar Date local e UTC.
 */

const FUSO = process.env.CRON_TIMEZONE || 'America/Sao_Paulo';
const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_DIA = 24 * 60 * 60 * 1000;

const formatadorHoje = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Data de "hoje" no fuso configurado (padrão: America/Sao_Paulo). */
function hojeISO(agora = new Date()) {
  return formatadorHoje.format(agora);
}

function dataValida(s) {
  if (typeof s !== 'string') return false;
  const m = RE_DATA.exec(s);
  if (!m) return false;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (ano < 2000 || ano > 2100) return false;
  const dt = new Date(Date.UTC(ano, mes - 1, dia));
  return (
    dt.getUTCFullYear() === ano &&
    dt.getUTCMonth() === mes - 1 &&
    dt.getUTCDate() === dia
  );
}

function paraUTC(s) {
  const [a, m, d] = s.split('-').map(Number);
  return Date.UTC(a, m - 1, d);
}

function paraISO(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Diferença em dias inteiros (b - a). Positivo = b é depois de a. */
function diasEntre(a, b) {
  return Math.round((paraUTC(b) - paraUTC(a)) / MS_DIA);
}

function somarDias(s, n) {
  return paraISO(paraUTC(s) + n * MS_DIA);
}

function diasNoMes(ano, mes /* 1-12 */) {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

function diaDoMes(s) {
  return Number(s.slice(8, 10));
}

function montar(ano, mes, dia) {
  const mm = String(mes).padStart(2, '0');
  const dd = String(dia).padStart(2, '0');
  return `${ano}-${mm}-${dd}`;
}

/**
 * Avança o vencimento para o próximo ciclo.
 * - semanal: +7 dias
 * - mensal : mesmo dia do mês seguinte (usa o dia âncora para não "derivar"
 *            depois de meses curtos; 31/jan -> 28/fev -> 31/mar)
 * - anual  : mesmo dia/mês do ano seguinte (29/fev cai em 28/fev nos anos
 *            não bissextos e volta a 29 nos bissextos)
 */
function avancarVencimento(dataISO, ciclo, diaAncora) {
  const [ano, mes, dia] = dataISO.split('-').map(Number);
  const ancora = diaAncora || dia;

  if (ciclo === 'semanal') return somarDias(dataISO, 7);

  if (ciclo === 'mensal') {
    let novoAno = ano;
    let novoMes = mes + 1;
    if (novoMes > 12) {
      novoMes = 1;
      novoAno += 1;
    }
    return montar(novoAno, novoMes, Math.min(ancora, diasNoMes(novoAno, novoMes)));
  }

  if (ciclo === 'anual') {
    const novoAno = ano + 1;
    return montar(novoAno, mes, Math.min(ancora, diasNoMes(novoAno, mes)));
  }

  throw new Error(`Ciclo desconhecido: ${ciclo}`);
}

module.exports = {
  hojeISO,
  dataValida,
  diasEntre,
  somarDias,
  diaDoMes,
  avancarVencimento,
};