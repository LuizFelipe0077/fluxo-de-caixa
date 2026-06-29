/****************************************************************
 * ESTÉTICA INTEGRATIVA · API de Controle Financeiro (v2.1)
 * Backend Google Apps Script — Google Sheets como banco de dados.
 *
 * Segurança:
 *   - TODAS as operações (inclusive a LEITURA dos dados) passam por
 *     doPost e exigem usuário + hash de senha válidos. doGet não
 *     expõe mais nenhum dado.
 *   - Validação rigorosa de tipos e whitelists (rejeita lixo/injeção).
 *   - Exceções tratadas sem vazar stack trace ao cliente.
 *   - LockService serializa escritas (evita corrida).
 *   - Log de auditoria append-only por operação.
 *
 * CONFIGURAÇÃO:
 *   1. Crie uma planilha no Google Sheets.
 *   2. Extensões > Apps Script, cole este código.
 *   3. Rode `configurar` uma vez (cria abas e cabeçalhos).
 *   4. Implantar > Nova implantação > App da Web
 *        Executar como: Eu | Acesso: Qualquer pessoa
 *   5. Cole a URL (/exec) em src/config.js.
 ****************************************************************/

const ABA_ENTRADA = 'Entrada';
const ABA_SAIDA   = 'Saída';
const ABA_LOG     = 'Log';

const CAB_ENTRADA = ['id', 'data', 'nome', 'cpf', 'servico', 'tipo', 'forma', 'bruto', 'desconto', 'parcela', 'obtido', 'usuario', 'timestamp'];
const CAB_SAIDA   = ['id', 'data', 'categoria', 'subcategoria', 'tipo', 'valor', 'observacoes', 'usuario', 'timestamp'];
const CAB_LOG     = ['timestamp', 'usuario', 'acao', 'resumo', 'origem'];

// Whitelists — espelham o domínio do frontend (financeiro.js).
const FORMAS_VALIDAS   = ['Pix', 'Dinheiro', 'Débito', 'Crédito'];
const SERVICOS_VALIDOS = ['Tratamento estrias', 'Saúde integrativa', 'Melasma', 'Outros'];
const TIPOS_ENT_VALIDOS = ['', 'Procedimento', 'Sinal', 'Avaliação', 'Homecare', 'Diferença'];
const CAT_SAIDA_VALIDAS = ['Despesa', 'Retirada'];
const TIPO_SAIDA_VALIDOS = ['Variável', 'Fixo'];

// Credenciais (hash SHA-256 de "220916"). Troque os hashes para mudar a senha.
const USUARIOS = {
  nicole: { hash: 'a95b69434f868fcfb1246ab567108fe09efe4a1eff6c4eb49f705a20da169392', nome: 'Nicole' },
  felipe: { hash: 'a95b69434f868fcfb1246ab567108fe09efe4a1eff6c4eb49f705a20da169392', nome: 'Felipe' }
};

/* ===================== SETUP ===================== */
function configurar() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  criarAba(ss, ABA_ENTRADA, CAB_ENTRADA);
  criarAba(ss, ABA_SAIDA, CAB_SAIDA);
  criarAba(ss, ABA_LOG, CAB_LOG);
}

function criarAba(ss, nome, cabecalho) {
  let aba = ss.getSheetByName(nome);
  if (!aba) aba = ss.insertSheet(nome);
  if (aba.getLastRow() === 0) {
    aba.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]).setFontWeight('bold');
    aba.setFrozenRows(1);
  }
}

/* ===================== GET (sem dados) ===================== */
function doGet() {
  // A leitura de dados foi movida para doPost autenticado.
  return responder({ ok: true, servico: 'Estética Integrativa API', mensagem: 'API ativa. As operações exigem autenticação via POST.' });
}

/* ===================== POST (porta única, autenticada) ===================== */
function doPost(e) {
  const trava = LockService.getScriptLock();
  try {
    trava.waitLock(8000);   // evita escrita concorrente (corrida)
    const requisicao = JSON.parse(e.postData.contents);
    const acao = String(requisicao.action || '');
    const usuario = String(requisicao.usuario || '').toLowerCase().trim();
    const hash = String(requisicao.hashSenha || '');
    const conta = USUARIOS[usuario];
    const autorizado = conta && comparacaoConstante(conta.hash, hash);

    // Login: o próprio ato de validar credenciais.
    if (acao === 'login') {
      if (autorizado) {
        registrarLog(conta.nome, 'Login', 'Acesso autorizado');
        return responder({ ok: true, nome: conta.nome });
      }
      registrarLog(usuario || '?', 'Login', 'Tentativa rejeitada');
      return responder({ ok: false, erro: 'Credenciais inválidas.' });
    }

    // Todas as demais ações exigem sessão válida.
    if (!autorizado) {
      registrarLog(usuario || '?', acao || '?', 'Acesso negado');
      return responder({ ok: false, erro: 'Não autorizado.' });
    }

    const autor = conta.nome;
    const dados = requisicao.payload || {};
    switch (acao) {
      case 'getData':       return responder({ ok: true, entradas: lerAba(ABA_ENTRADA, CAB_ENTRADA), saidas: lerAba(ABA_SAIDA, CAB_SAIDA) });
      case 'addEntrada':    return tratarAddEntrada(dados, autor);
      case 'addSaida':      return tratarAddSaida(dados, autor);
      case 'editEntrada':   return tratarEditEntrada(dados, autor);
      case 'editSaida':     return tratarEditSaida(dados, autor);
      case 'deleteEntrada': return tratarDelete(ABA_ENTRADA, dados, autor, 'Excluir entrada');
      case 'deleteSaida':   return tratarDelete(ABA_SAIDA, dados, autor, 'Excluir saída');
      default:              return responder({ ok: false, erro: 'Ação inválida.' });
    }
  } catch (err) {
    return falhaSegura(err);
  } finally {
    if (trava.hasLock()) trava.releaseLock();
  }
}

/* ===================== HANDLERS: CRIAR ===================== */
function tratarAddEntrada(dados, autor) {
  const limpo = montarEntrada(dados, autor, 'e_' + Date.now());
  appendObjeto(ABA_ENTRADA, CAB_ENTRADA, limpo);
  registrarLog(autor, 'Entrada', limpo.nome + ' · R$ ' + limpo.obtido);
  return responder({ ok: true, id: limpo.id });
}

function tratarAddSaida(dados, autor) {
  const limpo = montarSaida(dados, autor, 's_' + Date.now());
  appendObjeto(ABA_SAIDA, CAB_SAIDA, limpo);
  registrarLog(autor, 'Saída', (limpo.subcategoria || limpo.categoria) + ' · R$ ' + limpo.valor);
  return responder({ ok: true, id: limpo.id });
}

/* ===================== HANDLERS: EDITAR ===================== */
function tratarEditEntrada(dados, autor) {
  const id = texto(dados.id, 40);
  const linha = acharLinhaPorId(ABA_ENTRADA, id);
  if (linha < 0) throw new ErroValidacao('Registro não encontrado.');
  const limpo = montarEntrada(dados, autor, id);
  sobrescreverLinha(ABA_ENTRADA, CAB_ENTRADA, linha, limpo);
  registrarLog(autor, 'Editar entrada', limpo.nome + ' · R$ ' + limpo.obtido);
  return responder({ ok: true, id: id });
}

function tratarEditSaida(dados, autor) {
  const id = texto(dados.id, 40);
  const linha = acharLinhaPorId(ABA_SAIDA, id);
  if (linha < 0) throw new ErroValidacao('Registro não encontrado.');
  const limpo = montarSaida(dados, autor, id);
  sobrescreverLinha(ABA_SAIDA, CAB_SAIDA, linha, limpo);
  registrarLog(autor, 'Editar saída', (limpo.subcategoria || limpo.categoria) + ' · R$ ' + limpo.valor);
  return responder({ ok: true, id: id });
}

/* ===================== HANDLER: EXCLUIR ===================== */
function tratarDelete(nomeAba, dados, autor, rotuloLog) {
  const id = texto(dados.id, 40);
  const linha = acharLinhaPorId(nomeAba, id);
  if (linha < 0) throw new ErroValidacao('Registro não encontrado.');
  aba(nomeAba).deleteRow(linha);   // remove a linha sem quebrar a estrutura
  registrarLog(autor, rotuloLog, id);
  return responder({ ok: true });
}

/* ===================== MONTAGEM + VALIDAÇÃO ===================== */
function montarEntrada(dados, autor, id) {
  return {
    id: id,
    data: validarData(dados.data),
    nome: texto(dados.nome, 80),
    cpf: texto(dados.cpf, 14),
    servico: naWhitelist(dados.servico, SERVICOS_VALIDOS, 'serviço'),
    tipo: naWhitelist(dados.tipo, TIPOS_ENT_VALIDOS, 'tipo'),
    forma: naWhitelist(dados.forma, FORMAS_VALIDAS, 'forma'),
    bruto: numero(dados.bruto, { positivo: true }),
    desconto: numero(dados.desconto, { min: 0 }),
    parcela: texto(dados.parcela, 20),
    obtido: numero(dados.obtido, { min: 0 }),
    usuario: autor,
    timestamp: agora()
  };
}

function montarSaida(dados, autor, id) {
  return {
    id: id,
    data: validarData(dados.data),
    categoria: naWhitelist(dados.categoria, CAT_SAIDA_VALIDAS, 'categoria'),
    subcategoria: texto(dados.subcategoria, 60),
    tipo: naWhitelist(dados.tipo, TIPO_SAIDA_VALIDOS, 'tipo'),
    valor: numero(dados.valor, { positivo: true }),
    observacoes: texto(dados.observacoes, 120),
    usuario: autor,
    timestamp: agora()
  };
}

/* ===================== VALIDADORES ===================== */
function numero(valor, opcoes) {
  opcoes = opcoes || {};
  const positivo = opcoes.positivo || false;
  const min = (opcoes.min === undefined) ? -Infinity : opcoes.min;
  const n = typeof valor === 'number' ? valor : Number(valor);
  if (!isFinite(n)) throw new ErroValidacao('Valor numérico inválido.');
  if (positivo && n <= 0) throw new ErroValidacao('Valor deve ser positivo.');
  if (n < min) throw new ErroValidacao('Valor abaixo do permitido.');
  if (n > 9999999) throw new ErroValidacao('Valor acima do limite.');
  return Math.round(n * 100) / 100;
}

function texto(valor, limite) {
  return String(valor == null ? '' : valor)
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, limite);
}

function naWhitelist(valor, permitidos, rotulo) {
  const v = String(valor == null ? '' : valor);
  if (permitidos.indexOf(v) === -1) throw new ErroValidacao('Valor de ' + rotulo + ' não permitido.');
  return v;
}

function validarData(valor) {
  const v = String(valor || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ErroValidacao('Data inválida.');
  const d = new Date(v + 'T00:00:00');
  if (isNaN(d.getTime())) throw new ErroValidacao('Data inexistente.');
  return v;
}

/* ===================== ACESSO À PLANILHA ===================== */
function aba(nome) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nome); }

function lerAba(nome, cab) {
  const sh = aba(nome);
  if (!sh || sh.getLastRow() < 2) return [];
  const valores = sh.getRange(2, 1, sh.getLastRow() - 1, cab.length).getValues();
  return valores.map(function (linha) {
    const o = {};
    cab.forEach(function (c, i) { o[c] = formatarCelula(linha[i]); });
    return o;
  });
}

function appendObjeto(nome, cab, obj) {
  aba(nome).appendRow(cab.map(function (c) { return obj[c] !== undefined ? obj[c] : ''; }));
}

function sobrescreverLinha(nome, cab, linha, obj) {
  const valores = cab.map(function (c) { return obj[c] !== undefined ? obj[c] : ''; });
  aba(nome).getRange(linha, 1, 1, cab.length).setValues([valores]);
}

/** Retorna o número da linha (base 1) cujo id bate, ou -1. */
function acharLinhaPorId(nome, id) {
  const sh = aba(nome);
  if (!sh || sh.getLastRow() < 2) return -1;
  const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;   // +2: cabeçalho + base 1
  }
  return -1;
}

function registrarLog(usuario, acao, resumo) {
  const sh = aba(ABA_LOG);
  if (sh) sh.appendRow([agora(), usuario || '—', acao, resumo, 'webapp']);
}

function formatarCelula(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return v;
}

function agora() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss');
}

function comparacaoConstante(a, b) {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

/* ===================== RESPOSTA / ERROS ===================== */
function responder(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Nunca expõe stack trace: validação vira mensagem amigável; o resto é genérico. */
function falhaSegura(err) {
  const ehValidacao = err && err.name === 'ErroValidacao';
  if (!ehValidacao) console.error(err);
  return responder({ ok: false, erro: ehValidacao ? err.message : 'Erro interno ao processar a requisição.' });
}

function ErroValidacao(mensagem) { this.name = 'ErroValidacao'; this.message = mensagem; }
ErroValidacao.prototype = Object.create(Error.prototype);
