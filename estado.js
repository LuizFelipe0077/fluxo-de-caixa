/**
 * Estado central da aplicação (store mínimo com publicação/assinatura).
 * Componentes assinam mudanças e re-renderizam quando o estado muda.
 */
class Estado {
  #dados = {
    usuario: null,
    entradas: [],
    saidas: [],
    telaAtual: 'painel',
    mesSelecionado: null,   // 'YYYY-MM' ou null = todos
    carregando: false
  };
  #ouvintes = new Set();

  obter(chave) {
    return chave ? this.#dados[chave] : { ...this.#dados };
  }

  definir(parciais) {
    Object.assign(this.#dados, parciais);
    this.#notificar();
  }

  assinar(ouvinte) {
    this.#ouvintes.add(ouvinte);
    return () => this.#ouvintes.delete(ouvinte);
  }

  #notificar() {
    for (const ouvinte of this.#ouvintes) ouvinte(this.#dados);
  }
}

export const estado = new Estado();
