/**
 * Ponto de entrada. Orquestra autenticação, navegação, formulários,
 * filtros e exportação, delegando regras ao domínio e renderização à UI.
 */

import { CONFIG } from './config.js';
import { estado } from './core/estado.js';
import { sessao } from './core/auth.js';
import { api } from './services/api.js';
import {
  calcularLucroObtido, descreverParcela, TAXAS_CREDITO,
  FORMAS_PAGAMENTO, SERVICOS, TIPOS_ENTRADA, CATEGORIAS_SAIDA, TIPOS_SAIDA,
  somarEntradas, somarSaidas, listarMesesDisponiveis
} from './domain/financeiro.js';
import {
  sanitizarEntradaDeDados, validarValorMonetario, validarOpcao,
  validarDataISO, ErroDeValidacao, criarElemento
} from './utils/security.js';
import {
  formatarMoeda, formatarDataBR, obterAnoMes, obterAnoMesDia,
  rotularMes, dataDeHojeISO, carimboDeTempoAgora, aplicarMascaraCpf
} from './utils/formatters.js';
import {
  renderizarPainel, renderizarEntradas, renderizarSaidas,
  mostrarSkeletonsPainel, ocultarSkeletonsPainel, mostrarSkeletonsLista, exibirToast
} from './ui/components.js';

const $ = id => document.getElementById(id);
let formaSelecionada = 'Pix';

/* ===================== INICIALIZAÇÃO ===================== */
window.addEventListener('DOMContentLoaded', () => {
  configurarSelects();
  registrarEventos();
  refletirModoConexao();

  const sessaoAtiva = sessao.restaurar();
  if (sessaoAtiva) abrirAplicacao(sessaoAtiva.nome);
});

function refletirModoConexao() {
  const badge = $('badge-sync');
  badge.className = `badge-sync ${CONFIG.USAR_API ? 'online' : 'demo'}`;
  badge.textContent = CONFIG.USAR_API ? '● Online' : '● Demo';
}

/* ===================== AUTENTICAÇÃO ===================== */
async function aoEnviarLogin(evento) {
  evento.preventDefault();
  const botao = $('botao-entrar');
  const erro = $('login-erro');
  erro.textContent = '';
  botao.disabled = true;
  botao.textContent = 'Verificando…';

  try {
    const resultado = await sessao.autenticar($('login-usuario').value, $('login-senha').value);
    if (resultado) {
      $('login-form').reset();
      abrirAplicacao(resultado.nome);
    } else {
      erro.textContent = 'Usuário ou senha incorretos.';
    }
  } catch {
    erro.textContent = 'Não foi possível validar o acesso. Tente novamente.';
  } finally {
    botao.disabled = false;
    botao.textContent = 'Entrar';
  }
}

async function abrirAplicacao(nome) {
  estado.definir({ usuario: nome });
  $('tela-login').setAttribute('hidden', '');
  $('aplicacao').removeAttribute('hidden');
  await carregarDados();
}

function encerrarSessao() {
  sessao.encerrar();
  estado.definir({ usuario: null, entradas: [], saidas: [], mesSelecionado: null });
  $('aplicacao').setAttribute('hidden', '');
  $('tela-login').removeAttribute('hidden');
}

/* ===================== CARGA DE DADOS ===================== */
async function carregarDados() {
  estado.definir({ carregando: true });
  mostrarSkeletonsPainel();
  mostrarSkeletonsLista('lista-entradas');
  mostrarSkeletonsLista('lista-saidas');
  try {
    const { entradas, saidas } = await api.carregarLancamentos();
    estado.definir({ entradas, saidas, carregando: false });
    ocultarSkeletonsPainel();
    renderizarTudo();
  } catch {
    estado.definir({ carregando: false });
    exibirToast('Falha ao carregar os dados.', 'erro');
  }
}

function renderizarTudo() {
  renderizarPainel(estado.obter());
  aplicarFiltrosEntradas();
  aplicarFiltrosSaidas();
}

/* ===================== NAVEGAÇÃO ===================== */
const SUBTITULOS = { painel: 'Painel', entradas: 'Entradas', saidas: 'Saídas' };
function navegar(tela) {
  if (tela === 'exportar') { exportarParaExcel(); return; }
  estado.definir({ telaAtual: tela });
  document.querySelectorAll('.tela').forEach(s => s.classList.toggle('ativa', s.id === `tela-${tela}`));
  document.querySelectorAll('.nav-item').forEach(n => {
    const ativo = n.dataset.tela === tela;
    n.classList.toggle('ativo', ativo);
    if (ativo) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current');
  });
  $('subtitulo-tela').textContent = SUBTITULOS[tela] || '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ===================== FILTRO DE MÊS (PAINEL) ===================== */
function passoMes(direcao) {
  const meses = listarMesesDisponiveis(estado.obter('entradas'), estado.obter('saidas'));
  if (!meses.length) return;
  const atual = estado.obter('mesSelecionado');
  let indice = atual === null ? (direcao > 0 ? 0 : meses.length - 1) : meses.indexOf(atual) + direcao;
  estado.definir({ mesSelecionado: (indice < 0 || indice >= meses.length) ? null : meses[indice] });
  renderizarPainel(estado.obter());
}

/* ===================== FILTROS DE LISTAS ===================== */
function lerFiltros(prefixo) {
  return {
    busca: sanitizarEntradaDeDados($(`${prefixo}-busca`).value, 60).toLowerCase(),
    de: $(`${prefixo}-de`).value,
    ate: $(`${prefixo}-ate`).value
  };
}

function aplicarFiltrosEntradas() {
  const f = lerFiltros('entradas');
  const fServico = $('entradas-fservico').value;
  const fPagamento = $('entradas-fpagamento').value;
  const lista = estado.obter('entradas')
    .slice()
    .sort((a, b) => String(b.data).localeCompare(String(a.data)))
    .filter(e => {
      if (f.de && obterAnoMesDia(e.data) < f.de) return false;
      if (f.ate && obterAnoMesDia(e.data) > f.ate) return false;
      if (fServico && e.servico !== fServico) return false;
      if (fPagamento && e.forma !== fPagamento) return false;
      if (f.busca && !`${e.nome} ${e.servico} ${e.tipo} ${e.cpf}`.toLowerCase().includes(f.busca)) return false;
      return true;
    });
  renderizarEntradas(lista);
}

function aplicarFiltrosSaidas() {
  const f = lerFiltros('saidas');
  const fCategoria = $('saidas-fcategoria').value;
  const fTipo = $('saidas-ftipo').value;
  const lista = estado.obter('saidas')
    .slice()
    .sort((a, b) => String(b.data).localeCompare(String(a.data)))
    .filter(s => {
      if (f.de && obterAnoMesDia(s.data) < f.de) return false;
      if (f.ate && obterAnoMesDia(s.data) > f.ate) return false;
      if (fCategoria && s.categoria !== fCategoria) return false;
      if (fTipo && s.tipo !== fTipo) return false;
      if (f.busca && !`${s.categoria} ${s.subcategoria} ${s.observacoes}`.toLowerCase().includes(f.busca)) return false;
      return true;
    });
  renderizarSaidas(lista);
}

function limparFiltros(prefixo) {
  [`${prefixo}-busca`, `${prefixo}-de`, `${prefixo}-ate`].forEach(id => { $(id).value = ''; });
  document.querySelectorAll(`#${prefixo}-filtros select`).forEach(s => { s.value = ''; });
}

/* ===================== SELECTS / FORMULÁRIOS ===================== */
function opcao(valor, rotulo) {
  return criarElemento('option', { texto: rotulo ?? valor, atributos: { value: valor } });
}

function preencherSelect(id, valores, { placeholder } = {}) {
  const select = $(id);
  select.replaceChildren();
  if (placeholder) select.appendChild(opcao('', placeholder));
  valores.forEach(v => select.appendChild(opcao(v)));
}

function configurarSelects() {
  preencherSelect('e-servico', SERVICOS);
  preencherSelect('e-tipo', TIPOS_ENTRADA, { placeholder: '—' });
  const parcelas = $('e-parcela');
  parcelas.replaceChildren();
  TAXAS_CREDITO.forEach((_, i) => parcelas.appendChild(opcao(String(i), descreverParcela(i))));
  preencherSelect('s-categoria', CATEGORIAS_SAIDA);
  preencherSelect('s-tipo', TIPOS_SAIDA);

  preencherSelect('entradas-fservico', SERVICOS, { placeholder: 'Todos' });
  preencherSelect('entradas-fpagamento', FORMAS_PAGAMENTO, { placeholder: 'Todas' });
  preencherSelect('saidas-fcategoria', CATEGORIAS_SAIDA, { placeholder: 'Todas' });
  preencherSelect('saidas-ftipo', TIPOS_SAIDA, { placeholder: 'Todos' });
}

function selecionarForma(forma) {
  formaSelecionada = forma;
  document.querySelectorAll('#e-forma .seg-btn').forEach(b => {
    const ativo = b.dataset.pagamento === forma;
    b.classList.toggle('ativo', ativo);
    b.setAttribute('aria-pressed', String(ativo));
  });
  $('e-parcela-grupo').hidden = forma !== 'Crédito';
  atualizarPreviaCalculo();
}

function atualizarPreviaCalculo() {
  const bruto = Number(String($('e-bruto').value).replace(',', '.')) || 0;
  const desconto = Number(String($('e-desconto').value).replace(',', '.')) || 0;
  const indiceParcela = formaSelecionada === 'Crédito' ? (Number($('e-parcela').value) || 0) : -1;
  const r = calcularLucroObtido({ bruto, desconto, forma: formaSelecionada, indiceParcela });
  $('calc-base').textContent = formatarMoeda(r.base);
  $('calc-taxa').textContent = '– ' + formatarMoeda(r.valorTaxa);
  $('calc-final').textContent = formatarMoeda(r.obtido);
}

/* ===================== MODAIS (<dialog>) ===================== */
function abrirDialogo(id) { const d = $(id); if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', ''); }
function fecharDialogo(id) { const d = $(id); if (typeof d.close === 'function') d.close(); else d.removeAttribute('open'); }

function abrirNovaEntrada() {
  $('form-entrada').reset();
  $('e-data').value = dataDeHojeISO();
  selecionarForma('Pix');
  abrirDialogo('dialogo-entrada');
}
function abrirNovaSaida() {
  $('form-saida').reset();
  $('s-data').value = dataDeHojeISO();
  abrirDialogo('dialogo-saida');
}

/* ===================== SALVAR (com validação e auditoria) ===================== */
async function aoSalvarEntrada(evento) {
  evento.preventDefault();
  try {
    const forma = validarOpcao(formaSelecionada, FORMAS_PAGAMENTO, 'pagamento');
    const indiceParcela = forma === 'Crédito' ? (Number($('e-parcela').value) || 0) : -1;
    const bruto = validarValorMonetario($('e-bruto').value, { permitirZero: false });
    const desconto = validarValorMonetario($('e-desconto').value || 0);
    if (desconto > bruto) throw new ErroDeValidacao('Desconto maior que o valor bruto.');

    const { obtido } = calcularLucroObtido({ bruto, desconto, forma, indiceParcela });
    const registro = {
      data: validarDataISO($('e-data').value),
      nome: sanitizarEntradaDeDados($('e-nome').value, 80),
      cpf: sanitizarEntradaDeDados($('e-cpf').value, 14),
      servico: validarOpcao($('e-servico').value, SERVICOS, 'serviço'),
      tipo: $('e-tipo').value ? validarOpcao($('e-tipo').value, TIPOS_ENTRADA, 'tipo') : '',
      forma,
      bruto, desconto,
      parcela: forma === 'Crédito' ? descreverParcela(indiceParcela) : '',
      obtido,
      usuario: estado.obter('usuario'),       // auditoria: quem
      timestamp: carimboDeTempoAgora()          // auditoria: quando
    };
    if (!registro.nome) throw new ErroDeValidacao('Informe o nome do cliente.');

    await persistir(api.adicionarEntrada(registro), 'Entrada registrada');
    fecharDialogo('dialogo-entrada');
    await recarregarLocal();
  } catch (erro) {
    exibirToast(erro instanceof ErroDeValidacao ? erro.message : 'Erro ao salvar.', 'erro');
  }
}

async function aoSalvarSaida(evento) {
  evento.preventDefault();
  try {
    const registro = {
      data: validarDataISO($('s-data').value),
      categoria: validarOpcao($('s-categoria').value, CATEGORIAS_SAIDA, 'categoria'),
      subcategoria: sanitizarEntradaDeDados($('s-subcategoria').value, 60),
      tipo: validarOpcao($('s-tipo').value, TIPOS_SAIDA, 'tipo'),
      valor: validarValorMonetario($('s-valor').value, { permitirZero: false }),
      observacoes: sanitizarEntradaDeDados($('s-obs').value, 120),
      usuario: estado.obter('usuario'),
      timestamp: carimboDeTempoAgora()
    };
    await persistir(api.adicionarSaida(registro), 'Saída registrada');
    fecharDialogo('dialogo-saida');
    await recarregarLocal();
  } catch (erro) {
    exibirToast(erro instanceof ErroDeValidacao ? erro.message : 'Erro ao salvar.', 'erro');
  }
}

async function persistir(promessa, mensagemOk) {
  const resposta = await promessa;
  if (resposta && resposta.ok === false) throw new ErroDeValidacao(resposta.erro || 'O servidor recusou o registro.');
  exibirToast(mensagemOk + ' ✓', 'ok');
}

/** Recarrega a partir do serviço (em demo, lê a memória já atualizada). */
async function recarregarLocal() {
  const { entradas, saidas } = await api.carregarLancamentos();
  estado.definir({ entradas, saidas });
  renderizarTudo();
}

/* ===================== EXPORTAÇÃO (SheetJS) ===================== */
function exportarParaExcel() {
  if (typeof XLSX === 'undefined') { exibirToast('Exportação indisponível.', 'erro'); return; }
  const mes = estado.obter('mesSelecionado');
  const filtra = itens => mes ? itens.filter(i => obterAnoMes(i.data) === mes) : itens;
  const entradas = filtra(estado.obter('entradas'));
  const saidas = filtra(estado.obter('saidas'));

  const abaEntrada = [
    ['Data', 'Nome', 'CPF', 'Serviços', 'Tipo', 'Forma de pagamento', 'Lucro Bruto', 'V/Desconto (R$)', 'Parcelas', 'Lucro Obtido', 'Registrado por', 'Em'],
    ...entradas.map(e => [formatarDataBR(e.data), e.nome, e.cpf, e.servico, e.tipo, e.forma, e.bruto, e.desconto, e.parcela, e.obtido, e.usuario, e.timestamp])
  ];
  const abaSaida = [
    ['Data', 'Categoria', 'SubCategoria', 'Tipo', 'Valor (R$)', 'Observações', 'Registrado por', 'Em'],
    ...saidas.map(s => [formatarDataBR(s.data), s.categoria, s.subcategoria, s.tipo, s.valor, s.observacoes, s.usuario, s.timestamp])
  ];

  const wb = XLSX.utils.book_new();
  const wsE = XLSX.utils.aoa_to_sheet(abaEntrada);
  const wsS = XLSX.utils.aoa_to_sheet(abaSaida);
  wsE['!cols'] = [{ wch: 11 }, { wch: 24 }, { wch: 16 }, { wch: 18 }, { wch: 13 }, { wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 13 }, { wch: 13 }, { wch: 18 }];
  wsS['!cols'] = [{ wch: 11 }, { wch: 12 }, { wch: 22 }, { wch: 11 }, { wch: 12 }, { wch: 26 }, { wch: 13 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsE, 'Entrada');
  XLSX.utils.book_append_sheet(wb, wsS, 'Saída');
  XLSX.writeFile(wb, `Controle_Estetica${mes ? '_' + mes : '_completo'}.xlsx`);
  exibirToast('Planilha exportada ✓', 'ok');
}

/* ===================== EVENTOS ===================== */
function registrarEventos() {
  $('login-form').addEventListener('submit', aoEnviarLogin);
  $('botao-sair').addEventListener('click', encerrarSessao);

  document.querySelectorAll('.nav-item').forEach(n => n.addEventListener('click', () => navegar(n.dataset.tela)));

  $('fab').addEventListener('click', () => abrirDialogo('dialogo-escolha'));
  $('escolha-entrada').addEventListener('click', () => { fecharDialogo('dialogo-escolha'); abrirNovaEntrada(); });
  $('escolha-saida').addEventListener('click', () => { fecharDialogo('dialogo-escolha'); abrirNovaSaida(); });

  document.querySelectorAll('[data-fechar]').forEach(b => b.addEventListener('click', () => fecharDialogo(b.dataset.fechar)));

  document.querySelectorAll('#e-forma .seg-btn').forEach(b => b.addEventListener('click', () => selecionarForma(b.dataset.pagamento)));
  ['e-bruto', 'e-desconto', 'e-parcela'].forEach(id => $(id).addEventListener('input', atualizarPreviaCalculo));
  $('e-cpf').addEventListener('input', evento => { evento.target.value = aplicarMascaraCpf(evento.target.value); });

  $('form-entrada').addEventListener('submit', aoSalvarEntrada);
  $('form-saida').addEventListener('submit', aoSalvarSaida);

  $('mes-anterior').addEventListener('click', () => passoMes(-1));
  $('mes-proximo').addEventListener('click', () => passoMes(1));
  $('rotulo-mes').addEventListener('click', () => { estado.definir({ mesSelecionado: null }); renderizarPainel(estado.obter()); });

  $('entradas-botao-filtro').addEventListener('click', () => $('entradas-filtros').hidden = !$('entradas-filtros').hidden);
  $('saidas-botao-filtro').addEventListener('click', () => $('saidas-filtros').hidden = !$('saidas-filtros').hidden);
  ['entradas-busca', 'entradas-de', 'entradas-ate', 'entradas-fservico', 'entradas-fpagamento']
    .forEach(id => $(id).addEventListener('input', aplicarFiltrosEntradas));
  ['saidas-busca', 'saidas-de', 'saidas-ate', 'saidas-fcategoria', 'saidas-ftipo']
    .forEach(id => $(id).addEventListener('input', aplicarFiltrosSaidas));
  $('entradas-limpar').addEventListener('click', () => { limparFiltros('entradas'); aplicarFiltrosEntradas(); });
  $('saidas-limpar').addEventListener('click', () => { limparFiltros('saidas'); aplicarFiltrosSaidas(); });
}
