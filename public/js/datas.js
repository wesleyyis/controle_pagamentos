// Datas sempre como texto 'AAAA-MM-DD' (evita deslocamento de fuso).
const FUSO = 'America/Sao_Paulo';
const MS_DIA = 24 * 60 * 60 * 1000;
const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

const formatador = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** "Hoje" no fuso de Brasília (o mesmo usado pelo agendador dos alertas). */
export const hojeISO = (agora = new Date()) => formatador.format(agora);

export function dataValida(s) {
  if (typeof s !== 'string') return false;
  const m = RE_DATA.exec(s);
  if (!m) return false;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (ano < 2000 || ano > 2100) return false;
  const dt = new Date(Date.UTC(ano, mes - 1, dia));
  return dt.getUTCFullYear() === ano && dt.getUTCMonth() === mes - 1 && dt.getUTCDate() === dia;
}

const paraUTC = (s) => {
  const [a, m, d] = s.split('-').map(Number);
  return Date.UTC(a, m - 1, d);
};

/** Diferença em dias inteiros (b - a). Positivo = b é depois de a. */
export const diasEntre = (a, b) => Math.round((paraUTC(b) - paraUTC(a)) / MS_DIA);
