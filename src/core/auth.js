/**
 * Gerenciador de sessão e autenticação.
 *
 * Modelo de segurança:
 *   - A senha digitada nunca trafega em texto puro: enviamos o hash SHA-256.
 *   - A validação é feita NO BACKEND (Apps Script), que é a fronteira de
 *     confiança real. O cliente não guarda o hash esperado de ninguém.
 *   - Após o login, as credenciais (usuário + hash) ficam na camada de API
 *     e acompanham cada requisição, inclusive a leitura de dados.
 *   - A sessão é mantida no sessionStorage (volátil, limpa ao fechar a aba)
 *     para sobreviver a recarregamentos da página. Nunca em localStorage.
 */

import { gerarHashSHA256, gerarTokenSessao, sanitizarEntradaDeDados } from '../utils/security.js';
import { api } from '../services/api.js';

const CHAVE_SESSAO = 'ei_sessao';

class GerenciadorSessao {
  /** Autentica no backend. Retorna { nome } em sucesso ou null em falha. */
  async autenticar(usuarioBruto, senhaBruta) {
    const usuario = sanitizarEntradaDeDados(usuarioBruto, 40).toLowerCase();
    const hashSenha = await gerarHashSHA256(String(senhaBruta || ''));

    const resposta = await api.autenticar(usuario, hashSenha);
    if (resposta && resposta.ok && resposta.nome) {
      api.definirCredenciais(usuario, hashSenha);
      this.#persistir({ nome: resposta.nome, usuario, hashSenha });
      return { nome: resposta.nome };
    }
    return null;
  }

  #persistir(sessaoAtiva) {
    const dados = { ...sessaoAtiva, token: gerarTokenSessao(), inicio: Date.now() };
    try { sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify(dados)); }
    catch { /* indisponível: sessão apenas em memória */ }
  }

  /** Restaura a sessão da aba atual e reativa as credenciais na API. */
  restaurar() {
    try {
      const cru = sessionStorage.getItem(CHAVE_SESSAO);
      if (!cru) return null;
      const s = JSON.parse(cru);
      if (s && s.nome && s.usuario && s.hashSenha) {
        api.definirCredenciais(s.usuario, s.hashSenha);
        return { nome: s.nome };
      }
      return null;
    } catch {
      return null;
    }
  }

  encerrar() {
    api.limparCredenciais();
    try { sessionStorage.removeItem(CHAVE_SESSAO); } catch { /* noop */ }
  }
}

export const sessao = new GerenciadorSessao();
