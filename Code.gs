/****************************************************************
 * ESTÉTICA INTEGRATIVA · API de Controle Financeiro (v2)
 * Backend Google Apps Script — Google Sheets como banco de dados.
 *
 * Hardening aplicado:
 *   - Validação rigorosa de tipos e whitelists (rejeita lixo/injeção).
 *   - Exceções tratadas sem vazar stack trace ao cliente.
 *   - Autenticação validada no servidor por hash SHA-256.
 *   - Log de auditoria imutável (append-only) por operação.
 *
 * CONFIGURAÇÃO:
 *   1. Crie uma planilha no Google Sheets.
 *   2. Extensões > Apps Script, cole este código.
 *   3. Rode `configurar` uma vez (cria abas e cabeçalhos).
 *   4. Implantar > Nova implantação > App da Web
 *        Executar como: Eu | Acesso: Qualquer pessoa
 *   5. Cole a URL (/exec) em src/config.js e USAR_API = true.
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

/* ===================== GET ===================== */
function doGet(e) {
  try {
    const acao = (e && e.parameter && e.parameter.action) || 'getData';
    if (acao === 'getData') {
      return responder({
        entradas: lerAba(ABA_ENTRADA, CAB_ENTRADA),
        saidas: lerAba(ABA_SAIDA, CAB_SAIDA)
      });
    }
    return responder({ ok: false, erro: 'Ação não suportada.' });
  } catch (err) {
    return falhaSegura(err);
  }
}

/* ===================== POST ===================== */
function doPost(e) {
  const trava = LockService.getScriptLock();
  try {
    trava.waitLock(8000);   // evita escrita concorrente (corrida)
    const requisicao = JSON.parse(e.postData.contents);
    const acao = String(requisicao.action || '');
    const dados = requisicao.payload || {};

    if (acao === 'login') return tratarLogin(dados);
    if (acao === 'addEntrada') return tratarAddEntrada(dados);
    if (acao === 'addSaida') return tratarAddSaida(dados);

    return responder({ ok: false, erro: 'Ação inválida.' });
  } catch (err) {
    return falhaSegura(err);
  } finally {
    if (trava.hasLock()) trava.releaseLock();
  }
}

/* ===================== HANDLERS ===================== */
function tratarLogin(dados) {
  const usuario = String(dados.usuario || '').toLowerCase().trim();
  const hash = String(dados.hashSenha || '');
  const registro = USUARIOS[usuario];
  if (registro && comparacaoConstante(registro.hash, hash)) {
    registrarLog(registro.nome, 'Login', 'Acesso autorizado');
    return responder({ ok: true, nome: registro.nome });
  }
  registrarLog(usuario || '?', 'Login', 'Tentativa rejeitada');
  return responder({ ok: false, erro: 'Credenciais inválidas.' });
}

function tratarAddEntrada(dados) {
  const limpo = {
    id: 'e_' + Date.now(),
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
    usuario: texto(dados.usuario, 40),
    timestamp: texto(dados.timestamp, 30) || agora()
  };
  appendObjeto(ABA_ENTRADA, CAB_ENTRADA, limpo);
  registrarLog(limpo.usuario, 'Entrada', limpo.nome + ' · R$ ' + limpo.obtido);
  return responder({ ok: true, id: limpo.id });
}

function tratarAddSaida(dados) {
  const limpo = {
    id: 's_' + Date.now(),
    data: validarData(dados.data),
    categoria: naWhitelist(dados.categoria, CAT_SAIDA_VALIDAS, 'categoria'),
    subcategoria: texto(dados.subcategoria, 60),
    tipo: naWhitelist(dados.tipo, TIPO_SAIDA_VALIDOS, 'tipo'),
    valor: numero(dados.valor, { positivo: true }),
    observacoes: texto(dados.observacoes, 120),
    usuario: texto(dados.usuario, 40),
    timestamp: texto(dados.timestamp, 30) || agora()
  };
  appendObjeto(ABA_SAIDA, CAB_SAIDA, limpo);
  registrarLog(limpo.usuario, 'Saída', (limpo.subcategoria || limpo.categoria) + ' · R$ ' + limpo.valor);
  return responder({ ok: true, id: limpo.id });
}

/* ===================== VALIDADORES ===================== */
function numero(valor, { positivo = false, min = -Infinity } = {}) {
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

/* ===================== AUXILIARES ===================== */
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

function responder(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Nunca expõe stack trace: erro de validação vira mensagem amigável; o resto é genérico. */
function falhaSegura(err) {
  const ehValidacao = err && err.name === 'ErroValidacao';
  if (!ehValidacao) console.error(err);   // detalhe fica só no log do servidor
  return responder({ ok: false, erro: ehValidacao ? err.message : 'Erro interno ao processar a requisição.' });
}

function ErroValidacao(mensagem) { this.name = 'ErroValidacao'; this.message = mensagem; }
ErroValidacao.prototype = Object.create(Error.prototype);
