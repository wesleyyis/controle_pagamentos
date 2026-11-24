// Validação no navegador (o banco repete as regras essenciais com CHECK constraints).
import { dataValida } from './datas.js';

export const CICLOS = ['mensal', 'anual', 'semanal'];
const VALOR_MAX = 99999999.99;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Aceita número (29.9) ou texto ("29,90" / "1.234,56" / "29.90"). */
export function parseValor(v) {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return NaN;
  const t = v.trim();
  if (!t) return NaN;
  const normalizado = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  return Number(normalizado);
}

/** Retorna { dados } ou { detalhes } (mensagem por campo). */
export function validarConta(body, { aceitaAtiva = false } = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const detalhes = {};

  const nome = typeof b.nome === 'string' ? b.nome.trim() : '';
  if (nome.length < 1 || nome.length > 100) detalhes.nome = 'Informe o nome (até 100 caracteres).';

  const categoria = typeof b.categoria === 'string' ? b.categoria.trim() : '';
  if (categoria.length < 1 || categoria.length > 50) detalhes.categoria = 'Informe a categoria (até 50 caracteres).';

  const valorNum = parseValor(b.valor);
  if (!Number.isFinite(valorNum) || valorNum <= 0 || valorNum > VALOR_MAX) {
    detalhes.valor = 'Informe um valor maior que zero.';
  }

  if (!CICLOS.includes(b.ciclo)) detalhes.ciclo = 'Ciclo deve ser mensal, anual ou semanal.';
  if (!dataValida(b.proximo_vencimento)) detalhes.proximo_vencimento = 'Informe uma data válida.';

  let ativa;
  if (aceitaAtiva && b.ativa !== undefined) {
    if (typeof b.ativa !== 'boolean') detalhes.ativa = 'Deve ser verdadeiro ou falso.';
    else ativa = b.ativa;
  }

  if (Object.keys(detalhes).length) return { detalhes };
  return {
    dados: {
      nome,
      categoria,
      valor: Math.round((valorNum + Number.EPSILON) * 100) / 100,
      ciclo: b.ciclo,
      proximo_vencimento: b.proximo_vencimento,
      ativa,
    },
  };
}

export function validarCadastro({ nome, email, senha }) {
  const detalhes = {};
  const nomeLimpo = typeof nome === 'string' ? nome.trim() : '';
  if (nomeLimpo.length < 2 || nomeLimpo.length > 100) detalhes.nome = 'Informe seu nome (2 a 100 caracteres).';

  const emailLimpo = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!RE_EMAIL.test(emailLimpo) || emailLimpo.length > 150) detalhes.email = 'Informe um e-mail válido.';

  if (typeof senha !== 'string' || senha.length < 8 || senha.length > 72) {
    detalhes.senha = 'A senha deve ter de 8 a 72 caracteres.';
  }

  if (Object.keys(detalhes).length) return { detalhes };
  return { dados: { nome: nomeLimpo, email: emailLimpo } };
}
