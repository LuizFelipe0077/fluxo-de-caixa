/**
 * Camada de serviço: única ponte entre o frontend e o backend (Apps Script).
 * O sistema é 100% online. Toda operação (inclusive a leitura dos dados)
 * exige autenticação: as credenciais do usuário logado acompanham cada
 * requisição e são revalidadas no servidor.
 *
 * Nenhuma outra parte do sistema deve usar fetch() diretamente.
 */

import { CONFIG } from '../config.js';

function normalizarEntrada(registro, indice) {
  return {
    id: registro.id || `e${indice}`,
    data: registro.data,
    nome: registro.nome || '',
    cpf: registro.cpf || '',
    servico: registro.servico || 'Outros',
    tipo: registro.tipo || '',
    forma: registro.forma || '',
    bruto: Number(registro.bruto) || 0,
    desconto: Number(registro.desconto) || 0,
    parcela: registro.parcela || '',
    obtido: Number(registro.obtido) || 0,
    usuario: registro.usuario || '—',
    timestamp: registro.timestamp || ''
  };
}

function normalizarSaida(registro, indice) {
  return {
    id: registro.id || `s${indice}`,
    data: registro.data,
    categoria: registro.categoria || 'Despesa',
    subcategoria: registro.subcategoria || '',
    tipo: registro.tipo || 'Variável',
    valor: Number(registro.valor) || 0,
    observacoes: registro.observacoes || '',
    usuario: registro.usuario || '—',
    timestamp: registro.timestamp || ''
  };
}

class ServicoApi {
  #credenciais = null;

  definirCredenciais(usuario, hashSenha) {
    this.#credenciais = { usuario, hashSenha };
  }

  limparCredenciais() {
    this.#credenciais = null;
  }

  /**
   * POST ao Apps Script. text/plain evita preflight CORS.
   * As credenciais (usuario + hashSenha) seguem em todas as requisições.
   */
  async #postar(action, payload = {}, credenciais = this.#credenciais) {
    const corpo = {
      action,
      usuario: credenciais ? credenciais.usuario : '',
      hashSenha: credenciais ? credenciais.hashSenha : '',
      payload
    };
    let resposta;
    try {
      resposta = await fetch(CONFIG.URL_WEB_APP, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(corpo),
        redirect: 'follow'   // segue o 302 do Apps Script até o googleusercontent
      });
    } catch {
      throw new Error('Sem conexão com o servidor.');
    }

    // Lê como texto e converte manualmente. Blinda contra Content-Type inesperado,
    // BOM ou espaços que fariam resposta.json() lançar SyntaxError logo após o
    // redirect do Apps Script — origem comum de "salvou, mas a tela acusou erro".
    const texto = (await resposta.text()).trim();
    try {
      return JSON.parse(texto);
    } catch {
      throw new Error('Resposta inesperada do servidor.');
    }
  }

  /** Valida credenciais no backend. Retorna { ok, nome } ou { ok:false }. */
  async autenticar(usuario, hashSenha) {
    return this.#postar('login', {}, { usuario, hashSenha });
  }

  /** Leitura protegida: exige sessão autenticada. */
  async carregarLancamentos() {
    const dados = await this.#postar('getData');
    if (dados && dados.ok === false) throw new Error(dados.erro || 'Não autorizado.');
    return {
      entradas: (dados.entradas || []).map(normalizarEntrada),
      saidas: (dados.saidas || []).map(normalizarSaida)
    };
  }

  adicionarEntrada(registro) { return this.#postar('addEntrada', registro); }
  adicionarSaida(registro) { return this.#postar('addSaida', registro); }
  editarEntrada(registro) { return this.#postar('editEntrada', registro); }
  editarSaida(registro) { return this.#postar('editSaida', registro); }
  excluirEntrada(id) { return this.#postar('deleteEntrada', { id }); }
  excluirSaida(id) { return this.#postar('deleteSaida', { id }); }
}

export const api = new ServicoApi();
