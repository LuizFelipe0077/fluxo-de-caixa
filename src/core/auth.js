/**
 * Gerenciador de sessão e autenticação.
 *
 * Modelo de segurança (honesto):
 *   - A senha digitada nunca é comparada em texto puro: calculamos o
 *     hash SHA-256 e comparamos com os hashes conhecidos.
 *   - Em modo ONLINE, a validação real ocorre no backend (Apps Script),
 *     que é a fronteira de confiança. O cliente só envia o hash.
 *   - A sessão vive em memória; sessionStorage guarda apenas um marcador
 *     volátil (limpo ao fechar a aba), nunca a senha.
 *
 *   Limitação reconhecida: com credenciais fixas no cliente, o hash é
 *   ofuscação — não autenticação forte —, pois a lógica é pública. A
 *   mitigação real é validar no servidor (já suportado). Ver auditoria.
 */

import { gerarHashSHA256, gerarTokenSessao, sanitizarEntradaDeDados } from '../utils/security.js';
import { api } from '../services/api.js';

const CHAVE_SESSAO = 'ei_sessao';

/** Hashes SHA-256 das credenciais (modo demo). Senha padrão: "220916". */
const HASHES_CONHECIDOS = Object.freeze({
  nicole: 'a95b69434f868fcfb1246ab567108fe09efe4a1eff6c4eb49f705a20da169392',
  felipe: 'a95b69434f868fcfb1246ab567108fe09efe4a1eff6c4eb49f705a20da169392'
});
const NOMES_EXIBICAO = Object.freeze({ nicole: 'Nicole', felipe: 'Felipe' });

class GerenciadorSessao {
  /** Autentica. Retorna { nome } em sucesso ou null em falha. */
  async autenticar(usuarioBruto, senhaBruta) {
    const usuario = sanitizarEntradaDeDados(usuarioBruto, 40).toLowerCase();
    const hashSenha = await gerarHashSHA256(String(senhaBruta || ''));

    if (api.online) {
      const resposta = await api.autenticar(usuario, hashSenha);
      if (resposta && resposta.ok && resposta.nome) {
        this.#iniciar(resposta.nome);
        return { nome: resposta.nome };
      }
      return null;
    }

    // Modo demo: compara o hash localmente (tempo constante simples).
    const hashEsperado = HASHES_CONHECIDOS[usuario];
    if (hashEsperado && comparacaoSegura(hashSenha, hashEsperado)) {
      const nome = NOMES_EXIBICAO[usuario];
      this.#iniciar(nome);
      return { nome };
    }
    return null;
  }

  #iniciar(nome) {
    const sessaoAtiva = { nome, token: gerarTokenSessao(), inicio: Date.now() };
    try { sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify(sessaoAtiva)); }
    catch { /* indisponível: sessão apenas em memória */ }
  }

  restaurar() {
    try {
      const cru = sessionStorage.getItem(CHAVE_SESSAO);
      if (!cru) return null;
      const dados = JSON.parse(cru);
      return dados && dados.nome ? { nome: dados.nome } : null;
    } catch { return null; }
  }

  encerrar() {
    try { sessionStorage.removeItem(CHAVE_SESSAO); } catch { /* noop */ }
  }
}

/** Comparação de strings em tempo aproximadamente constante. */
function comparacaoSegura(a, b) {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferenca === 0;
}

export const sessao = new GerenciadorSessao();
