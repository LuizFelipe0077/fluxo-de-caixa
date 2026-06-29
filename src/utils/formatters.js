/**
 * Formatadores e máscaras (moeda, datas, percentuais).
 * Sem efeitos colaterais — funções puras.
 */

const LOCALE = 'pt-BR';
const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_LONGOS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const formatadorMoeda = new Intl.NumberFormat(LOCALE, {
  style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2
});

export function formatarMoeda(valor) {
  return formatadorMoeda.format(Number(valor) || 0);
}

export function formatarMoedaCompacta(valor) {
  const numero = Number(valor) || 0;
  if (Math.abs(numero) >= 1000) {
    return 'R$ ' + (numero / 1000).toLocaleString(LOCALE, { maximumFractionDigits: 1 }) + 'k';
  }
  return formatarMoeda(numero);
}

export function formatarPercentual(fracao) {
  return (Number(fracao) * 100).toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
}

/** ISO (YYYY-MM-DD) → dd/mm/aaaa */
export function formatarDataBR(iso) {
  const partes = obterAnoMesDia(iso).split('-');
  if (partes.length !== 3) return iso || '';
  const [ano, mes, dia] = partes;
  return `${dia}/${mes}/${ano}`;
}

/** ISO → "12 mar 2026" (legível, para <time>) */
export function formatarDataLegivel(iso) {
  const [ano, mes, dia] = obterAnoMesDia(iso).split('-');
  if (!dia) return iso || '';
  return `${dia} ${MESES_CURTOS[Number(mes) - 1]} ${ano}`;
}

export function obterAnoMesDia(iso) {
  return String(iso || '').slice(0, 10);
}

export function obterAnoMes(iso) {
  return String(iso || '').slice(0, 7);
}

/** "2026-03" → "Março 2026" */
export function rotularMes(anoMes) {
  if (!anoMes) return 'Todos os meses';
  const [ano, mes] = anoMes.split('-');
  return `${MESES_LONGOS[Number(mes) - 1]} ${ano}`;
}

/** "2026-03" → "mar/26" (eixo de gráfico) */
export function rotularMesCurto(anoMes) {
  const [ano, mes] = anoMes.split('-');
  return `${MESES_CURTOS[Number(mes) - 1]}/${ano.slice(2)}`;
}

export function dataDeHojeISO() {
  const agora = new Date();
  const fuso = agora.getTimezoneOffset() * 60000;
  return new Date(agora - fuso).toISOString().slice(0, 10);
}

export function carimboDeTempoAgora() {
  return new Date().toLocaleString(LOCALE);
}

/** Máscara de CPF progressiva: 000.000.000-00 */
export function aplicarMascaraCpf(valor) {
  const digitos = String(valor || '').replace(/\D/g, '').slice(0, 11);
  return digitos
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

export { MESES_LONGOS, MESES_CURTOS };
