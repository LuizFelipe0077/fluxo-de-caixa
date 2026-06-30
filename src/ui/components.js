/**
 * Camada de UI: renderização de painel, listas, gráficos, skeletons e toasts.
 * Toda saída com dados do usuário usa criação de nós (textContent), nunca
 * innerHTML com dado cru — prevenção de XSS por construção.
 */

import { criarElemento, encodeHTML } from '../utils/security.js';
import {
  formatarMoeda, formatarMoedaCompacta, formatarDataBR, formatarDataLegivel,
  obterAnoMes, rotularMes, rotularMesCurto
} from '../utils/formatters.js';
import {
  somarEntradas, somarSaidas, calcularLucroLiquido, calcularTaxasPagas,
  calcularTicketMedio, listarMesesDisponiveis, agruparTotalPor, montarSerieMensal
} from '../domain/financeiro.js';

const PALETA = {
  terra: '#C17B66', terra600: '#B5654F', terra700: '#A9543C', terra300: '#DBA791',
  oliva: '#7E8B63', rust: '#C0603F', areia: '#E2B7A2'
};
const FONTE_GRAFICO = "'Manrope', sans-serif";
const graficos = {};

const $ = id => document.getElementById(id);
const vazio = el => { while (el.firstChild) el.removeChild(el.firstChild); };

/* ===================== SKELETONS ===================== */
function blocoSkeleton(classe) {
  return criarElemento('div', { classe: `skeleton ${classe || ''}` });
}

export function mostrarSkeletonsPainel() {
  const hero = $('hero-balance');
  hero.classList.add('skeleton-hero');
  $('lista-recentes').replaceChildren(...Array.from({ length: 4 }, () => {
    const linha = criarElemento('div', { classe: 'recente-item' });
    linha.append(
      blocoSkeleton('sk-avatar'),
      criarElemento('div', { classe: 'recente-principal', filhos: [blocoSkeleton('sk-linha'), blocoSkeleton('sk-linha curta')] }),
      blocoSkeleton('sk-valor')
    );
    return linha;
  }));
  ['grafico-fluxo', 'grafico-servicos', 'grafico-saidas'].forEach(id => {
    const wrap = $(id).parentElement;
    wrap.classList.add('carregando-grafico');
  });
}

export function ocultarSkeletonsPainel() {
  $('hero-balance').classList.remove('skeleton-hero');
  ['grafico-fluxo', 'grafico-servicos', 'grafico-saidas'].forEach(id => {
    $(id).parentElement.classList.remove('carregando-grafico');
  });
}

export function mostrarSkeletonsLista(idLista) {
  const box = $(idLista);
  box.replaceChildren(...Array.from({ length: 5 }, () => {
    const card = criarElemento('article', { classe: 'cartao-mov sk-card' });
    card.append(
      blocoSkeleton('sk-linha m'),
      blocoSkeleton('sk-linha p'),
      blocoSkeleton('sk-chips')
    );
    return card;
  }));
}

/* ===================== PAINEL ===================== */
export function renderizarPainel(estadoAtual) {
  const { entradas, saidas, mesSelecionado } = estadoAtual;
  const ents = filtrarPorMes(entradas, mesSelecionado);
  const sais = filtrarPorMes(saidas, mesSelecionado);

  const liquido = calcularLucroLiquido(ents, sais);
  definirTexto('kpi-liquido', formatarMoeda(liquido));
  definirTexto('kpi-entradas', formatarMoeda(somarEntradas(ents)));
  definirTexto('kpi-saidas', formatarMoeda(somarSaidas(sais)));
  definirTexto('kpi-qtd', String(ents.length + sais.length));
  definirTexto('kpi-ticket', formatarMoedaCompacta(calcularTicketMedio(ents)));
  definirTexto('kpi-taxas', formatarMoedaCompacta(calcularTaxasPagas(ents)));
  definirTexto('hero-periodo', mesSelecionado ? ' · ' + rotularMes(mesSelecionado) : '');
  definirTexto('rotulo-mes', rotularMes(mesSelecionado));

  renderizarRecentes(ents, sais);
  renderizarGraficoFluxo(entradas, saidas);
  renderizarGraficoServicos(ents);
  renderizarGraficoSaidas(sais);
}

function renderizarRecentes(ents, sais) {
  const itens = [
    ...ents.map(e => ({ tipo: 'in', data: e.data, titulo: e.nome, sub: e.servico, valor: e.obtido })),
    ...sais.map(s => ({ tipo: 'out', data: s.data, titulo: s.subcategoria || s.categoria, sub: s.categoria, valor: s.valor }))
  ].sort((a, b) => String(b.data).localeCompare(String(a.data))).slice(0, 6);

  const box = $('lista-recentes');
  vazio(box);
  if (!itens.length) { box.appendChild(estadoVazio('Nenhuma movimentação no período.')); return; }

  for (const item of itens) {
    const linha = criarElemento('div', { classe: 'recente-item' });
    const avatar = criarElemento('div', { classe: `recente-avatar ${item.tipo}`, texto: item.tipo === 'in' ? '↓' : '↑' });
    const principal = criarElemento('div', { classe: 'recente-principal' });
    principal.append(
      criarElemento('strong', { texto: item.titulo || '—' }),
      criarElemento('small', { texto: `${item.sub || ''} · ${formatarDataLegivel(item.data)}` })
    );
    const valor = criarElemento('div', {
      classe: `recente-valor ${item.tipo}`,
      texto: `${item.tipo === 'in' ? '+' : '–'} ${formatarMoeda(item.valor)}`
    });
    linha.append(avatar, principal, valor);
    box.appendChild(linha);
  }
}

/* ===================== GRÁFICOS ===================== */
function destruirGrafico(nome) {
  if (graficos[nome]) { graficos[nome].destroy(); delete graficos[nome]; }
}

function renderizarGraficoFluxo(entradas, saidas) {
  destruirGrafico('fluxo');
  const serie = montarSerieMensal(entradas, saidas);
  const ctx = $('grafico-fluxo');
  if (typeof Chart === 'undefined' || !serie.length) return;
  graficos.fluxo = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: serie.map(p => rotularMesCurto(p.mes)),
      datasets: [
        { label: 'Entradas', data: serie.map(p => p.entradas), backgroundColor: PALETA.oliva, borderRadius: 6, maxBarThickness: 30 },
        { label: 'Saídas', data: serie.map(p => p.saidas), backgroundColor: PALETA.rust, borderRadius: 6, maxBarThickness: 30 }
      ]
    },
    options: opcoesBarras()
  });
}

function renderizarGraficoServicos(ents) {
  destruirGrafico('servicos');
  const mapa = agruparTotalPor(ents, e => e.servico, e => e.obtido);
  renderizarRosca('grafico-servicos', 'servicos', mapa,
    [PALETA.terra, PALETA.terra600, PALETA.terra300, PALETA.oliva, PALETA.areia], 'Sem entradas no período.');
}

function renderizarGraficoSaidas(sais) {
  destruirGrafico('saidas');
  const mapa = agruparTotalPor(sais, s => s.categoria, s => s.valor);
  renderizarRosca('grafico-saidas', 'saidas', mapa,
    [PALETA.rust, PALETA.terra300, PALETA.terra600, PALETA.terra700], 'Sem saídas no período.');
}

function renderizarRosca(idCanvas, nome, mapa, cores, msgVazia) {
  const ctx = $(idCanvas);
  const wrap = ctx.parentElement;
  // restaura canvas caso tenha sido substituído por estado vazio
  if (!wrap.contains(ctx)) { vazio(wrap); wrap.appendChild(ctx); }
  if (typeof Chart === 'undefined') return;
  if (!mapa.size) {
    vazio(wrap);
    wrap.appendChild(estadoVazio(msgVazia));
    return;
  }
  graficos[nome] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: [...mapa.keys()],
      datasets: [{ data: [...mapa.values()], backgroundColor: cores, borderWidth: 2, borderColor: '#fff' }]
    },
    options: opcoesRosca()
  });
}

function opcoesBarras() {
  return {
    responsive: true, maintainAspectRatio: false,
    animation: { duration: 600, easing: 'easeOutQuart' },
    plugins: {
      legend: { display: true, position: 'top', align: 'end', labels: legendaPadrao() },
      tooltip: tooltipPadrao()
    },
    scales: {
      x: { grid: { display: false }, ticks: { font: { family: FONTE_GRAFICO, size: 11 }, color: '#A99685' } },
      y: {
        grid: { color: 'rgba(0,0,0,.05)' }, border: { display: false },
        ticks: { font: { family: FONTE_GRAFICO, size: 11 }, color: '#A99685', callback: v => formatarMoedaCompacta(v) }
      }
    }
  };
}

function opcoesRosca() {
  return {
    responsive: true, maintainAspectRatio: false, cutout: '62%',
    animation: { duration: 600, easing: 'easeOutQuart' },
    plugins: { legend: { position: 'right', labels: legendaPadrao() }, tooltip: tooltipPadrao() }
  };
}

function legendaPadrao() {
  return { font: { family: FONTE_GRAFICO, size: 11.5, weight: '600' }, color: '#7A695C', usePointStyle: true, pointStyle: 'circle', boxWidth: 8, padding: 12 };
}

function tooltipPadrao() {
  return {
    backgroundColor: '#41342B', padding: 12, cornerRadius: 10,
    titleFont: { family: FONTE_GRAFICO, weight: '700' }, bodyFont: { family: FONTE_GRAFICO },
    callbacks: { label: ctx => ` ${ctx.label ? ctx.label + ': ' : ''}${formatarMoeda(ctx.parsed.y ?? ctx.parsed)}` }
  };
}

/* ===================== LISTAS ===================== */
/** Ordena do mais recente para o mais antigo: data desc; no mesmo dia, o cadastrado por último vem primeiro. */
function ordenarRecentePrimeiro(lista) {
  return lista
    .map((item, indice) => ({ item, indice }))
    .sort((a, b) => {
      const porData = String(b.item.data).localeCompare(String(a.item.data));
      return porData !== 0 ? porData : b.indice - a.indice;
    })
    .map(entrada => entrada.item);
}

export function renderizarEntradas(lista) {
  const box = $('lista-entradas');
  vazio(box);
  const total = somarEntradas(lista);
  resumoLista('resumo-entradas', `${lista.length} entrada(s)`, formatarMoeda(total));
  if (!lista.length) { box.appendChild(estadoVazio('Nenhuma entrada encontrada.', 'Ajuste a busca ou registre uma nova.')); return; }

  for (const e of ordenarRecentePrimeiro(lista)) {
    const chips = [chip(e.servico, true)];
    if (e.tipo) chips.push(chip(e.tipo));
    chips.push(chip(`${e.forma || '—'}${e.parcela ? ' · ' + e.parcela : ''}`));
    if (e.desconto > 0) chips.push(chip(`desc. ${formatarMoeda(e.desconto)}`));
    box.appendChild(cartaoMovimentacao({
      tipo: 'in', registro: 'entrada', id: e.id, titulo: e.nome || '—', valor: e.obtido, data: e.data, usuario: e.usuario, chips
    }));
  }
}

export function renderizarSaidas(lista) {
  const box = $('lista-saidas');
  vazio(box);
  const total = somarSaidas(lista);
  resumoLista('resumo-saidas', `${lista.length} saída(s)`, formatarMoeda(total));
  if (!lista.length) { box.appendChild(estadoVazio('Nenhuma saída encontrada.', 'Ajuste a busca ou registre uma nova.')); return; }

  for (const s of ordenarRecentePrimeiro(lista)) {
    const chips = [chip(s.categoria, true), chip(s.tipo)];
    if (s.observacoes) chips.push(chip(s.observacoes));
    box.appendChild(cartaoMovimentacao({
      tipo: 'out', registro: 'saida', id: s.id, titulo: s.subcategoria || s.categoria, valor: s.valor, data: s.data, usuario: s.usuario, chips
    }));
  }
}

function cartaoMovimentacao({ tipo, registro, id, titulo, valor, data, usuario, chips }) {
  const card = criarElemento('article', { classe: 'cartao-mov' });
  const acento = criarElemento('div', { classe: `mov-acento ${tipo}` });

  const corpo = criarElemento('div', { classe: 'mov-corpo' });
  const topo = criarElemento('div', { classe: 'mov-topo' });
  topo.append(
    criarElemento('span', { classe: 'mov-nome', texto: titulo }),
    criarElemento('span', { classe: `mov-valor ${tipo}`, texto: formatarMoeda(valor) })
  );
  const meta = criarElemento('div', { classe: 'mov-meta', filhos: chips });

  const acoes = criarElemento('div', { classe: 'mov-acoes' });
  acoes.append(
    botaoAcao('editar', registro, id, iconeLapis(), 'Editar registro'),
    botaoAcao('excluir', registro, id, iconeLixeira(), 'Excluir registro')
  );

  const rodape = criarElemento('div', { classe: 'mov-rodape' });
  const direita = criarElemento('div', { classe: 'mov-rodape-dir' });
  direita.append(
    criarElemento('span', { classe: 'mov-auditoria', filhos: [iconeUsuario(), criarElemento('span', { texto: usuario || '—' })] }),
    acoes
  );
  rodape.append(
    criarElemento('time', { classe: 'mov-data', texto: formatarDataBR(data), atributos: { datetime: String(data).slice(0, 10) } }),
    direita
  );

  corpo.append(topo, meta, rodape);
  card.append(acento, corpo);
  return card;
}

function botaoAcao(acao, registro, id, icone, rotulo) {
  return criarElemento('button', {
    classe: `mov-acao ${acao}`,
    atributos: { type: 'button', 'data-acao': acao, 'data-registro': registro, 'data-id': id, 'aria-label': rotulo, title: rotulo },
    filhos: [icone]
  });
}

function chip(texto, destaque = false) {
  return criarElemento('span', { classe: `chip ${destaque ? 'chip-destaque' : ''}`, texto });
}

function resumoLista(id, esquerda, total) {
  const box = $(id);
  vazio(box);
  box.append(
    criarElemento('span', { texto: esquerda }),
    criarElemento('span', { filhos: [document.createTextNode('Total '), criarElemento('strong', { texto: total })] })
  );
}

/* ===================== AUXILIARES ===================== */
function estadoVazio(mensagem, detalhe = '') {
  const box = criarElemento('div', { classe: 'estado-vazio' });
  box.appendChild(iconeSacola());
  box.appendChild(criarElemento('p', { texto: mensagem }));
  if (detalhe) box.appendChild(criarElemento('small', { texto: detalhe }));
  return box;
}

function definirTexto(id, texto) {
  const el = $(id);
  if (el) el.textContent = texto;
}

function filtrarPorMes(itens, mes) {
  return mes ? itens.filter(i => obterAnoMes(i.data) === mes) : itens;
}

/* ===================== TOAST ===================== */
let timerToast;
export function exibirToast(mensagem, tipo = '') {
  const toast = $('toast');
  toast.textContent = mensagem;
  toast.className = `toast mostrar ${tipo}`;
  toast.removeAttribute('hidden');
  clearTimeout(timerToast);
  timerToast = setTimeout(() => {
    toast.className = `toast ${tipo}`;
    setTimeout(() => toast.setAttribute('hidden', ''), 280);
  }, 2600);
}

/* ===================== ÍCONES (SVG inline, sem dado de usuário) ===================== */
function svg(d, extra = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const el = document.createElementNS(ns, 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', 'currentColor');
  el.setAttribute('stroke-width', extra.sw || '1.8');
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('width', extra.w || 14);
  el.setAttribute('height', extra.h || 14);
  for (const caminho of d) {
    const p = document.createElementNS(ns, caminho.tag || 'path');
    for (const [k, v] of Object.entries(caminho)) if (k !== 'tag') p.setAttribute(k, v);
    el.appendChild(p);
  }
  return el;
}
function iconeUsuario() {
  return svg([{ tag: 'circle', cx: 12, cy: 8, r: 4 }, { d: 'M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1' }], { sw: 2, w: 12, h: 12 });
}
function iconeSacola() {
  return svg([{ d: 'M3 9h18M3 9l2-5h14l2 5M3 9v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9' }], { sw: 1.5, w: 40, h: 40 });
}
function iconeLapis() {
  return svg([{ d: 'M12 20h9' }, { d: 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z' }], { sw: 1.8, w: 16, h: 16 });
}
function iconeLixeira() {
  return svg([{ d: 'M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }, { d: 'M10 11v6M14 11v6' }], { sw: 1.8, w: 16, h: 16 });
}

export { encodeHTML };
