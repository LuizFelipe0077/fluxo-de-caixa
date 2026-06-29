/**
 * Domínio financeiro — regras de negócio isoladas e testáveis.
 * Fonte da verdade: macros VBA + aba "Macro" de Controle - FINALIZADO.xlsm.
 *
 * Regra do Lucro Obtido:
 *   base  = bruto - desconto
 *   taxa  = 0          (Pix / Dinheiro)
 *         = 0,89%      (Débito)
 *         = tabela     (Crédito, conforme nº de parcelas)
 *   obtido = base - (base * taxa)
 */

import { obterAnoMes } from '../utils/formatters.js';

export const TAXA_DEBITO = 0.0089;

/** Tabela Nubank de crédito: índice 0 = 1x ... índice 11 = 12x. */
export const TAXAS_CREDITO = Object.freeze([
  0.0309, 0.0579, 0.0609, 0.0799, 0.0809, 0.0819,
  0.0949, 0.0968, 0.1037, 0.1105, 0.1227, 0.1238
]);

export const FORMAS_PAGAMENTO = Object.freeze(['Pix', 'Dinheiro', 'Débito', 'Crédito']);
export const SERVICOS = Object.freeze(['Tratamento estrias', 'Saúde integrativa', 'Melasma', 'Outros']);
export const TIPOS_ENTRADA = Object.freeze(['Procedimento', 'Sinal', 'Avaliação', 'Homecare', 'Diferença']);
export const CATEGORIAS_SAIDA = Object.freeze(['Despesa', 'Retirada']);
export const TIPOS_SAIDA = Object.freeze(['Variável', 'Fixo']);

/**
 * Calcula a quebra financeira de uma entrada.
 * @returns {{base:number, taxa:number, valorTaxa:number, obtido:number}}
 */
export function calcularLucroObtido({ bruto, desconto = 0, forma, indiceParcela = -1 }) {
  const base = (Number(bruto) || 0) - (Number(desconto) || 0);
  let taxa = 0;
  if (forma === 'Débito') {
    taxa = TAXA_DEBITO;
  } else if (forma === 'Crédito' && indiceParcela >= 0) {
    taxa = TAXAS_CREDITO[indiceParcela] || 0;
  }
  const valorTaxa = base * taxa;
  return {
    base,
    taxa,
    valorTaxa,
    obtido: Math.round((base - valorTaxa) * 100) / 100
  };
}

/** Descrição textual da parcela (ex.: "3x de 6,09%"). */
export function descreverParcela(indiceParcela) {
  if (indiceParcela < 0 || indiceParcela >= TAXAS_CREDITO.length) return '';
  const percentual = (TAXAS_CREDITO[indiceParcela] * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  return `${indiceParcela + 1}x de ${percentual}%`;
}

export function somarEntradas(entradas) {
  return entradas.reduce((total, entrada) => total + (Number(entrada.obtido) || 0), 0);
}

export function somarSaidas(saidas) {
  return saidas.reduce((total, saida) => total + (Number(saida.valor) || 0), 0);
}

export function calcularLucroLiquido(entradas, saidas) {
  return somarEntradas(entradas) - somarSaidas(saidas);
}

/** Total de taxas de cartão pagas (bruto - desconto - obtido). */
export function calcularTaxasPagas(entradas) {
  return entradas.reduce((total, e) => total + ((e.bruto - e.desconto) - e.obtido), 0);
}

export function calcularTicketMedio(entradas) {
  return entradas.length ? somarEntradas(entradas) / entradas.length : 0;
}

/** Lista ordenada de meses (YYYY-MM) presentes nos lançamentos. */
export function listarMesesDisponiveis(entradas, saidas) {
  const meses = new Set();
  entradas.forEach(e => meses.add(obterAnoMes(e.data)));
  saidas.forEach(s => meses.add(obterAnoMes(s.data)));
  return [...meses].filter(Boolean).sort();
}

/** Agrupa um total por uma chave qualquer (serviço, categoria...). */
export function agruparTotalPor(itens, obterChave, obterValor) {
  const mapa = new Map();
  for (const item of itens) {
    const chave = obterChave(item) || 'Outros';
    mapa.set(chave, (mapa.get(chave) || 0) + (Number(obterValor(item)) || 0));
  }
  return mapa;
}

/** Série mensal de entradas e saídas, para o gráfico de fluxo. */
export function montarSerieMensal(entradas, saidas) {
  const meses = listarMesesDisponiveis(entradas, saidas);
  return meses.map(mes => ({
    mes,
    entradas: somarEntradas(entradas.filter(e => obterAnoMes(e.data) === mes)),
    saidas: somarSaidas(saidas.filter(s => obterAnoMes(s.data) === mes))
  }));
}
