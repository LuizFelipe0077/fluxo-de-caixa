/**
 * Ponto de entrada. Orquestra autenticação, navegação, formulários,
 * filtros, CRUD (criar/editar/excluir) e exportação, delegando regras
 * ao domínio e a renderização à UI.
 */

import { estado } from './core/estado.js';
import { sessao } from './core/auth.js';
import { api } from './services/api.js';
import {
  calcularLucroObtido, descreverParcela, TAXAS_CREDITO,
  FORMAS_PAGAMENTO, SERVICOS, TIPOS_ENTRADA, CATEGORIAS_SAIDA, TIPOS_SAIDA,
  listarMesesDisponiveis
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
let idEntradaEmEdicao = null;   // null = nova entrada
let idSaidaEmEdicao = null;     // null = nova saída

/* ===================== INICIALIZAÇÃO ===================== */
window.addEventListener('DOMContentLoaded', () => {
  configurarSelects();
  registrarEventos();
  $('badge-sync').className = 'badge-sync online';
  $('badge-sync').textContent = '● Online';

  const sessaoAtiva = sessao.restaurar();
  if (sessaoAtiva) abrirAplicacao(sessaoAtiva.nome);
});

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
    erro.textContent = 'Não foi possível validar o acesso. Verifique a conexão.';
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
    ocultarSkeletonsPainel();
    exibirToast('Falha ao carregar os dados. Verifique a conexão.', 'erro');
  }
}

async function recarregarLocal() {
  const { entradas, saidas } = await api.carregarLancamentos();
  estado.definir({ entradas, saidas });
  renderizarTudo();
}

function renderizarTudo() {
  renderizarPainel(estado.obter());
  aplicarFiltrosEntradas();
  aplicarFiltrosSaidas();
}

/* ===================== NAVEGAÇÃO ===================== */
const SUBTITULOS = { painel: 'Painel', entradas: 'Entradas', saidas: 'Saídas' };
function navegar(tela) {
  if (tela === 'exportar') { fluxoExportar(); return; }
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

/* ===================== DIÁLOGO DE CONFIRMAÇÃO ===================== */
function abrirDialogo(id) { const d = $(id); if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', ''); }
function fecharDialogo(id) { const d = $(id); if (typeof d.close === 'function') d.close(); else d.removeAttribute('open'); }

/** Confirmação estilizada. Resolve true (confirmou) ou false (cancelou). */
function confirmar({ titulo, mensagem, rotuloOk = 'Confirmar', variante = 'normal', icone = '?' }) {
  return new Promise(resolve => {
    $('confirmar-titulo').textContent = titulo;
    $('confirmar-mensagem').textContent = mensagem;
    const elIcone = $('confirmar-icone');
    elIcone.textContent = icone;
    elIcone.className = `confirmar-icone ${variante === 'perigo' ? 'perigo' : 'sair'}`;
    const ok = $('confirmar-ok');
    ok.textContent = rotuloOk;
    ok.className = `btn btn-bloco ${variante === 'perigo' ? 'btn-perigo' : 'btn-primario'}`;
    const dlg = $('dialogo-confirmar');
    const cancelar = $('confirmar-cancelar');

    const finalizar = (resultado) => {
      ok.removeEventListener('click', aoOk);
      cancelar.removeEventListener('click', aoCancelar);
      dlg.removeEventListener('cancel', aoCancelar);
      fecharDialogo('dialogo-confirmar');
      resolve(resultado);
    };
    const aoOk = () => finalizar(true);
    const aoCancelar = (ev) => { if (ev) ev.preventDefault(); finalizar(false); };

    ok.addEventListener('click', aoOk);
    cancelar.addEventListener('click', aoCancelar);
    dlg.addEventListener('cancel', aoCancelar);   // tecla ESC
    abrirDialogo('dialogo-confirmar');
  });
}

async function confirmarSaida() {
  const sair = await confirmar({
    titulo: 'Sair da conta', mensagem: 'Deseja realmente encerrar a sessão?',
    rotuloOk: 'Sair', icone: '⎋'
  });
  if (sair) encerrarSessao();
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

/* ===================== ABRIR MODAIS (novo / editar) ===================== */
function abrirNovaEntrada() {
  idEntradaEmEdicao = null;
  $('titulo-dialogo-entrada').textContent = 'Nova entrada';
  $('btn-salvar-entrada').textContent = 'Salvar entrada';
  $('form-entrada').reset();
  $('e-data').value = dataDeHojeISO();
  selecionarForma('Pix');
  abrirDialogo('dialogo-entrada');
}

function abrirNovaSaida() {
  idSaidaEmEdicao = null;
  $('titulo-dialogo-saida').textContent = 'Nova saída';
  $('btn-salvar-saida').textContent = 'Salvar saída';
  $('form-saida').reset();
  $('s-data').value = dataDeHojeISO();
  abrirDialogo('dialogo-saida');
}

function abrirEditarEntrada(id) {
  const e = estado.obter('entradas').find(item => String(item.id) === String(id));
  if (!e) { exibirToast('Registro não encontrado.', 'erro'); return; }
  idEntradaEmEdicao = id;
  $('titulo-dialogo-entrada').textContent = 'Editar entrada';
  $('btn-salvar-entrada').textContent = 'Salvar alterações';
  $('e-data').value = obterAnoMesDia(e.data);
  $('e-nome').value = e.nome || '';
  $('e-cpf').value = e.cpf || '';
  $('e-servico').value = e.servico || SERVICOS[0];
  $('e-tipo').value = e.tipo || '';
  selecionarForma(e.forma || 'Pix');
  $('e-bruto').value = e.bruto || '';
  $('e-desconto').value = e.desconto || '';
  if (e.forma === 'Crédito') {
    const n = parseInt(e.parcela, 10);
    $('e-parcela').value = String((Number.isFinite(n) ? n : 1) - 1);
  }
  atualizarPreviaCalculo();
  abrirDialogo('dialogo-entrada');
}

function abrirEditarSaida(id) {
  const s = estado.obter('saidas').find(item => String(item.id) === String(id));
  if (!s) { exibirToast('Registro não encontrado.', 'erro'); return; }
  idSaidaEmEdicao = id;
  $('titulo-dialogo-saida').textContent = 'Editar saída';
  $('btn-salvar-saida').textContent = 'Salvar alterações';
  $('s-data').value = obterAnoMesDia(s.data);
  $('s-categoria').value = s.categoria || CATEGORIAS_SAIDA[0];
  $('s-subcategoria').value = s.subcategoria || '';
  $('s-tipo').value = s.tipo || TIPOS_SAIDA[0];
  $('s-valor').value = s.valor || '';
  $('s-obs').value = s.observacoes || '';
  abrirDialogo('dialogo-saida');
}

/* ===================== MONTAGEM + VALIDAÇÃO ===================== */
function montarRegistroEntrada() {
  const forma = validarOpcao(formaSelecionada, FORMAS_PAGAMENTO, 'pagamento');
  const indiceParcela = forma === 'Crédito' ? (Number($('e-parcela').value) || 0) : -1;
  const bruto = validarValorMonetario($('e-bruto').value, { permitirZero: false });
  const desconto = validarValorMonetario($('e-desconto').value || 0);
  if (desconto > bruto) throw new ErroDeValidacao('Desconto maior que o valor bruto.');

  const { obtido } = calcularLucroObtido({ bruto, desconto, forma, indiceParcela });
  const nome = sanitizarEntradaDeDados($('e-nome').value, 80);
  if (!nome) throw new ErroDeValidacao('Informe o nome do cliente.');

  return {
    data: validarDataISO($('e-data').value),
    nome,
    cpf: sanitizarEntradaDeDados($('e-cpf').value, 14),
    servico: validarOpcao($('e-servico').value, SERVICOS, 'serviço'),
    tipo: $('e-tipo').value ? validarOpcao($('e-tipo').value, TIPOS_ENTRADA, 'tipo') : '',
    forma,
    bruto, desconto,
    parcela: forma === 'Crédito' ? descreverParcela(indiceParcela) : '',
    obtido,
    usuario: estado.obter('usuario'),
    timestamp: carimboDeTempoAgora()
  };
}

function montarRegistroSaida() {
  return {
    data: validarDataISO($('s-data').value),
    categoria: validarOpcao($('s-categoria').value, CATEGORIAS_SAIDA, 'categoria'),
    subcategoria: sanitizarEntradaDeDados($('s-subcategoria').value, 60),
    tipo: validarOpcao($('s-tipo').value, TIPOS_SAIDA, 'tipo'),
    valor: validarValorMonetario($('s-valor').value, { permitirZero: false }),
    observacoes: sanitizarEntradaDeDados($('s-obs').value, 120),
    usuario: estado.obter('usuario'),
    timestamp: carimboDeTempoAgora()
  };
}

/* ===================== SALVAR (anti-duplo-clique) ===================== */
async function aoSalvarEntrada(evento) {
  evento.preventDefault();
  let registro;
  try {
    registro = montarRegistroEntrada();
  } catch (erro) {
    exibirToast(erro instanceof ErroDeValidacao ? erro.message : 'Erro ao salvar.', 'erro');
    return;
  }

  const botao = $('btn-salvar-entrada');
  const textoOriginal = botao.textContent;
  botao.disabled = true;
  botao.textContent = 'Salvando…';
  try {
    if (idEntradaEmEdicao) {
      registro.id = idEntradaEmEdicao;
      await persistir(api.editarEntrada(registro), 'Entrada atualizada');
    } else {
      await persistir(api.adicionarEntrada(registro), 'Entrada registrada');
    }
    fecharDialogo('dialogo-entrada');
    await recarregarLocal();
  } catch (erro) {
    exibirToast(erro instanceof ErroDeValidacao ? erro.message : 'Erro ao salvar.', 'erro');
  } finally {
    botao.disabled = false;
    botao.textContent = textoOriginal;
  }
}

async function aoSalvarSaida(evento) {
  evento.preventDefault();
  let registro;
  try {
    registro = montarRegistroSaida();
  } catch (erro) {
    exibirToast(erro instanceof ErroDeValidacao ? erro.message : 'Erro ao salvar.', 'erro');
    return;
  }

  const botao = $('btn-salvar-saida');
  const textoOriginal = botao.textContent;
  botao.disabled = true;
  botao.textContent = 'Salvando…';
  try {
    if (idSaidaEmEdicao) {
      registro.id = idSaidaEmEdicao;
      await persistir(api.editarSaida(registro), 'Saída atualizada');
    } else {
      await persistir(api.adicionarSaida(registro), 'Saída registrada');
    }
    fecharDialogo('dialogo-saida');
    await recarregarLocal();
  } catch (erro) {
    exibirToast(erro instanceof ErroDeValidacao ? erro.message : 'Erro ao salvar.', 'erro');
  } finally {
    botao.disabled = false;
    botao.textContent = textoOriginal;
  }
}

async function persistir(promessa, mensagemOk) {
  const resposta = await promessa;
  if (resposta && resposta.ok === false) throw new ErroDeValidacao(resposta.erro || 'O servidor recusou a operação.');
  exibirToast(mensagemOk + ' ✓', 'ok');
}

/* ===================== EXCLUIR ===================== */
async function confirmarExcluir(registro, id) {
  const ok = await confirmar({
    titulo: 'Excluir registro',
    mensagem: 'Tem certeza que deseja excluir este registro? Esta ação é irreversível.',
    rotuloOk: 'Excluir', variante: 'perigo', icone: '🗑'
  });
  if (!ok) return;
  try {
    await persistir(
      registro === 'entrada' ? api.excluirEntrada(id) : api.excluirSaida(id),
      'Registro excluído'
    );
    await recarregarLocal();
  } catch (erro) {
    exibirToast(erro instanceof ErroDeValidacao ? erro.message : 'Erro ao excluir.', 'erro');
  }
}

/** Cliques nos botões editar/excluir dos cards (delegação de eventos). */
function aoClicarNaLista(evento) {
  const botao = evento.target.closest('[data-acao]');
  if (!botao) return;
  const { acao, registro, id } = botao.dataset;
  if (acao === 'editar') {
    registro === 'entrada' ? abrirEditarEntrada(id) : abrirEditarSaida(id);
  } else if (acao === 'excluir') {
    confirmarExcluir(registro, id);
  }
}

/* ===================== EXPORTAÇÃO (modal + Web Share) ===================== */
async function fluxoExportar() {
  const mes = estado.obter('mesSelecionado');
  const ok = await confirmar({
    titulo: 'Exportar planilha',
    mensagem: mes
      ? `Gerar a planilha Excel com os lançamentos de ${rotularMes(mes)}?`
      : 'Gerar a planilha Excel com todos os lançamentos?',
    rotuloOk: 'Exportar', icone: '↧'
  });
  if (ok) await exportarParaExcel();
}

async function exportarParaExcel() {
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

  const nomeArquivo = `Controle_Estetica${mes ? '_' + mes : '_completo'}.xlsx`;
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  // Mobile: tenta o compartilhamento nativo (WhatsApp, e-mail, etc.).
  const arquivo = new File([blob], nomeArquivo, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [arquivo] })) {
    try {
      await navigator.share({ files: [arquivo], title: 'Controle Estética Integrativa', text: 'Planilha de controle financeiro.' });
      exibirToast('Planilha compartilhada ✓', 'ok');
      return;
    } catch (erro) {
      if (erro && erro.name === 'AbortError') return;   // usuário cancelou a partilha
      // qualquer outra falha: cai para o download tradicional
    }
  }

  // Desktop / navegadores sem Web Share: download direto.
  baixarBlob(blob, nomeArquivo);
  exibirToast('Planilha exportada ✓', 'ok');
}

function baixarBlob(blob, nome) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/* ===================== EVENTOS ===================== */
function registrarEventos() {
  $('login-form').addEventListener('submit', aoEnviarLogin);
  $('botao-sair').addEventListener('click', confirmarSaida);

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

  $('lista-entradas').addEventListener('click', aoClicarNaLista);
  $('lista-saidas').addEventListener('click', aoClicarNaLista);

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
