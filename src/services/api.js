/**
 * Camada de serviço: única ponte entre o frontend e o backend (Apps Script).
 * Em modo demonstração, opera sobre os dados históricos em memória.
 *
 * Nenhuma outra parte do sistema deve usar fetch() diretamente.
 */

import { CONFIG } from '../config.js';
import { ENTRADAS_HISTORICAS, SAIDAS_HISTORICAS } from '../data/seed.js';

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

const esperar = ms => new Promise(resolve => setTimeout(resolve, ms));

class ServicoApi {
  #memoria = { entradas: [], saidas: [] };
  #carregouMemoria = false;

  get online() {
    return CONFIG.USAR_API;
  }

  /** Requisição POST ao Apps Script. text/plain evita preflight CORS. */
  async #enviar(corpo) {
    const resposta = await fetch(CONFIG.URL_WEB_APP, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(corpo),
      redirect: 'follow'
    });
    if (!resposta.ok) throw new Error('Falha na comunicação com o servidor.');
    return resposta.json();
  }

  async #buscar(parametros) {
    const url = `${CONFIG.URL_WEB_APP}?${new URLSearchParams(parametros)}`;
    const resposta = await fetch(url, { redirect: 'follow' });
    if (!resposta.ok) throw new Error('Falha na comunicação com o servidor.');
    return resposta.json();
  }

  /** Carrega todos os lançamentos. */
  async carregarLancamentos() {
    if (!this.online) {
      await esperar(CONFIG.ATRASO_SIMULADO_MS);   // mostra skeletons no demo
      if (!this.#carregouMemoria) {
        this.#memoria.entradas = ENTRADAS_HISTORICAS.map(normalizarEntrada);
        this.#memoria.saidas = SAIDAS_HISTORICAS.map(normalizarSaida);
        this.#carregouMemoria = true;
      }
      return {
        entradas: this.#memoria.entradas.map(normalizarEntrada),
        saidas: this.#memoria.saidas.map(normalizarSaida)
      };
    }
    const dados = await this.#buscar({ action: 'getData' });
    return {
      entradas: (dados.entradas || []).map(normalizarEntrada),
      saidas: (dados.saidas || []).map(normalizarSaida)
    };
  }

  /** Valida credenciais. Online: backend decide. Demo: resolvido no auth.js. */
  async autenticar(usuario, hashSenha) {
    if (!this.online) return null;   // tratado localmente em modo demo
    return this.#enviar({ action: 'login', payload: { usuario, hashSenha } });
  }

  async adicionarEntrada(registro) {
    if (!this.online) {
      await esperar(300);
      this.#memoria.entradas.push(normalizarEntrada(registro, this.#memoria.entradas.length));
      return { ok: true };
    }
    return this.#enviar({ action: 'addEntrada', payload: registro });
  }

  async adicionarSaida(registro) {
    if (!this.online) {
      await esperar(300);
      this.#memoria.saidas.push(normalizarSaida(registro, this.#memoria.saidas.length));
      return { ok: true };
    }
    return this.#enviar({ action: 'addSaida', payload: registro });
  }
}

export const api = new ServicoApi();
