/**
 * Camada de segurança do cliente.
 *
 * Responsabilidades:
 *   - Escape de HTML para prevenir XSS na renderização.
 *   - Criação segura de nós do DOM (sem innerHTML com dado cru).
 *   - Hash SHA-256 (Web Crypto) para não trafegar senha em texto puro.
 *   - Validações de tipagem/limites antes de enviar ao backend.
 *
 * IMPORTANTE: controles do lado do cliente reduzem ruído e erros honestos,
 * mas NÃO substituem a validação no backend (ver Code.gs e o relatório
 * de auditoria). A validação do servidor é a fronteira de confiança real.
 */

const MAPA_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

/** Escapa caracteres perigosos para inserção segura em HTML. */
export function encodeHTML(texto) {
  return String(texto ?? '').replace(/[&<>"'`]/g, caractere => MAPA_ESCAPE[caractere]);
}

/**
 * Cria um elemento DOM de forma segura.
 * Texto entra via textContent (nunca innerHTML), evitando injeção.
 */
export function criarElemento(tag, { classe, texto, atributos, filhos } = {}) {
  const elemento = document.createElement(tag);
  if (classe) elemento.className = classe;
  if (texto != null) elemento.textContent = String(texto);
  if (atributos) {
    for (const [chave, valor] of Object.entries(atributos)) {
      if (valor == null || valor === false) continue;
      elemento.setAttribute(chave, valor === true ? '' : String(valor));
    }
  }
  if (filhos) for (const filho of filhos) if (filho) elemento.appendChild(filho);
  return elemento;
}

/** Remove caracteres de controle e normaliza espaços de um texto de entrada. */
export function sanitizarEntradaDeDados(valor, limiteCaracteres = 200) {
  return String(valor ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')   // caracteres de controle
    .trim()
    .slice(0, limiteCaracteres);
}

/** Converte para número finito e não-negativo (ou lança erro). */
export function validarValorMonetario(valor, { permitirZero = true } = {}) {
  const numero = typeof valor === 'number' ? valor : Number(String(valor).replace(',', '.'));
  if (!Number.isFinite(numero)) throw new ErroDeValidacao('Valor numérico inválido.');
  if (numero < 0) throw new ErroDeValidacao('Valor não pode ser negativo.');
  if (!permitirZero && numero === 0) throw new ErroDeValidacao('Valor deve ser maior que zero.');
  if (numero > 9_999_999) throw new ErroDeValidacao('Valor acima do limite permitido.');
  return Math.round(numero * 100) / 100;
}

/** Garante que o texto pertence a um conjunto permitido (whitelist). */
export function validarOpcao(valor, opcoesPermitidas, rotulo = 'opção') {
  if (!opcoesPermitidas.includes(valor)) {
    throw new ErroDeValidacao(`Valor de ${rotulo} não permitido.`);
  }
  return valor;
}

/** Valida data no formato ISO YYYY-MM-DD dentro de um intervalo plausível. */
export function validarDataISO(valor) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) throw new ErroDeValidacao('Data inválida.');
  const data = new Date(valor + 'T00:00:00');
  if (Number.isNaN(data.getTime())) throw new ErroDeValidacao('Data inexistente.');
  const ano = data.getUTCFullYear();
  if (ano < 2000 || ano > 2100) throw new ErroDeValidacao('Data fora do intervalo permitido.');
  return valor;
}

/** Hash SHA-256 hexadecimal via Web Crypto API. */
export async function gerarHashSHA256(texto) {
  const dados = new TextEncoder().encode(texto);
  const buffer = await crypto.subtle.digest('SHA-256', dados);
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Gera um identificador opaco para a sessão (não-previsível). */
export function gerarTokenSessao() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Erro de validação tipado, para distinguir de erros inesperados. */
export class ErroDeValidacao extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroDeValidacao';
  }
}
