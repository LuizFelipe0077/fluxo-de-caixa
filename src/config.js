/**
 * Configuração central da aplicação.
 *
 * Para ativar o modo ONLINE (Google Sheets em tempo real, multiusuário):
 *   1. Publique Code.gs como App da Web e copie a URL (/exec).
 *   2. Cole em URL_WEB_APP e troque USAR_API para true.
 *
 * Enquanto USAR_API = false, o sistema roda em modo demonstração,
 * com os dados históricos da planilha carregados em memória.
 */
export const CONFIG = Object.freeze({
  USAR_API: false,
  URL_WEB_APP: 'https://script.google.com/macros/s/AKfycbx-OQVbU53N1zh8BwShnMC2BJ5jPkGdRobwdzjFjnReusMrMiqbl24GoYIJSorgNA-Q/exec',
  ATRASO_SIMULADO_MS: 550   // simula latência de rede no modo demo (mostra skeletons)
});
