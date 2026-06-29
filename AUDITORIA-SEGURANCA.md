# Relatório de Auditoria de Segurança — Estética Integrativa v2
### Threat Model e Análise Técnica

**Sistema:** SPA de controle financeiro (Vanilla JS / ES Modules + Google Apps Script)
**Escopo:** clínica de pequeno porte, 2 operadores de confiança (Nicole, Felipe), dados financeiros internos.
**Postura deste relatório:** honesta. Distingo explicitamente os controles que oferecem **proteção real** dos que são apenas **redução de risco cosmética**. Vender ofuscação como segurança forte seria um desserviço de engenharia.

---

## 1. Modelo de ameaça (quem ataca o quê)

Antes de listar mitigações, é preciso definir contra quem estamos nos defendendo. O perfil de risco aqui **não** é o de um banco — é o de uma planilha compartilhada que virou web app. Os agentes de ameaça plausíveis são:

| Agente | Capacidade | Plausibilidade |
|---|---|---|
| **Curioso / acidental** | Abre a URL, mexe sem querer, cola texto estranho num campo | Alta |
| **Operador legítimo mal-intencionado** | Já tem login; pode inserir dado falso | Baixa (2 pessoas de confiança) |
| **Atacante remoto sem credencial** | Acha a URL, tenta forçar entrada ou injetar dados | Média |
| **Atacante com leitura do código-fonte** | Lê o JS público e extrai lógica/credenciais | **Garantido** (todo front é público) |

O último ponto é o mais importante e governa todo o resto: **em uma SPA, 100% do código de frontend é visível para qualquer pessoa.** Nenhum segredo no cliente é realmente secreto. Por isso a fronteira de confiança real é o **backend (Apps Script)**, não o navegador.

---

## 2. Vetores de ataque MITIGADOS (proteção real)

### 2.1. Cross-Site Scripting (XSS) — OWASP A03:2021 ✅ Mitigação forte

Este é o vetor mais relevante para a aplicação, porque dados inseridos por um operador (nome de cliente, observação) são depois renderizados na tela. Um campo como `nome = <img src=x onerror=alert(1)>` poderia executar script se renderizado de forma ingênua.

**Como foi mitigado, de fato:**
- A renderização **nunca** usa `innerHTML` com dado de usuário. Toda saída passa por `criarElemento()` (em `utils/security.js`), que injeta conteúdo via `textContent` e atributos via `setAttribute` — o navegador trata o conteúdo como texto, não como marcação.
- `encodeHTML()` está disponível para os casos em que escape explícito seja necessário.
- `sanitizarEntradaDeDados()` remove caracteres de controle e limita o tamanho na entrada.

**Validação prática:** inserimos `<img src=x onerror=alert(1)>` no nome do cliente. O sistema gravou e exibiu a string como **texto literal** no cartão; o `onerror` não disparou. O nó `<img>` não foi criado no DOM. (Verificável: o cartão exibe os caracteres `<`, `>` como texto.)

Este é um controle **real e eficaz** — é a proteção mais importante do sistema e está implementada por construção, não por filtro frágil.

### 2.2. Content Security Policy (CSP) ✅ Mitigação real (defesa em profundidade)

O `index.html` declara uma CSP restritiva via `<meta http-equiv>`:
- `default-src 'self'` — bloqueia origens não declaradas.
- `script-src 'self' https://cdn.jsdelivr.net` — só executa nossos módulos e as bibliotecas Chart.js/SheetJS. **Scripts inline são bloqueados**, o que neutraliza a maior parte dos payloads de XSS refletido mesmo que algum escape falhasse.
- `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` — fecham vetores clássicos de injeção e sequestro de formulário.
- `connect-src` restrito aos domínios do Apps Script.

É uma segunda camada: mesmo que a defesa 2.1 falhasse em algum ponto, a CSP barraria a execução de script inline. Honestidade técnica: `style-src` inclui `'unsafe-inline'` porque o Chart.js injeta estilos inline no canvas. Isso enfraquece a política **para estilos** (não para scripts) — um trade-off conhecido e de baixo impacto, já que injeção via CSS é muito menos perigosa que via script.

### 2.3. Validação e integridade de dados no backend — OWASP A04/A08 ✅ Mitigação real

Esta é a defesa que garante que **ninguém forje dados financeiros**, nem mesmo enviando requisições diretas ao endpoint (fora da interface). O `Code.gs`:
- **Tipagem forte:** `numero()` exige `isFinite`, rejeita negativos onde proibido, arredonda a 2 casas e impõe teto. Uma string como `"500; DROP"` em campo de valor é rejeitada, não coagida silenciosamente.
- **Whitelists:** `forma`, `servico`, `categoria`, `tipo` só aceitam valores de listas fechadas (`naWhitelist`). Valor fora do conjunto → rejeição.
- **Datas:** validadas por regex ISO + checagem de data real.
- **Não confia no cliente:** mesmo que o frontend fosse contornado, o backend revalida tudo. **A validação do cliente é UX; a do servidor é segurança.** Ambas existem aqui.

### 2.4. Condição de corrida na escrita ✅ Mitigação real

`doPost` usa `LockService.getScriptLock()` com timeout. Se Nicole e Felipe salvarem ao mesmo tempo, as escritas são serializadas — sem sobrescrita ou linha corrompida na planilha.

### 2.5. Vazamento de informação em erros — OWASP A05 ✅ Mitigação real

`falhaSegura()` nunca devolve stack trace ao cliente. Erros de validação viram mensagens limpas (`"Valor de serviço não permitido."`); erros inesperados viram um genérico `"Erro interno..."`, com o detalhe registrado apenas no log do servidor. Isso evita que um atacante mapeie a estrutura interna pelos erros.

### 2.6. Trilha de auditoria ✅ Mitigação real (responsabilização)

Todo registro grava `usuario` + `timestamp`, e o backend mantém uma aba `Log` append-only (login, entradas, saídas, tentativas rejeitadas). Não previne um insostat malicioso, mas garante **rastreabilidade** — quem fez o quê e quando.

---

## 3. Controles presentes, mas que são OFUSCAÇÃO — não segurança forte

Aqui está a parte que um relatório honesto precisa deixar explícita. O prompt pediu hash de senha no cliente e sessão "assinada"; implementei ambos **como solicitado**, mas você precisa entender exatamente o que eles valem.

### 3.1. Hash SHA-256 de senha no client-side ⚠️ Ofuscação, não autenticação

Implementado em `utils/security.js` (`gerarHashSHA256`) e usado em `core/auth.js`. O que ele **realmente** entrega:
- ✅ A senha em texto puro `"220916"` não aparece escrita no código.
- ✅ A senha não é comparada nem guardada em texto puro.
- ❌ **Não é autenticação forte.** No modo demo, o hash esperado está no próprio JS público. Qualquer pessoa que abra o DevTools vê o hash e a lógica de comparação, e pode reproduzir o "login" trivialmente. Hash no cliente, com a referência também no cliente, é uma fechadura com a chave pendurada ao lado.

**Onde isso vira segurança de verdade:** quando `USAR_API = true`, o `core/auth.js` envia o hash ao backend e é o **`Code.gs` que decide** (os hashes ficam no servidor, em `USUARIOS`). Aí sim a validação acontece fora do alcance do atacante. Recomendo fortemente operar nesse modo assim que o backend estiver publicado.

### 3.2. Sessão em `sessionStorage` ⚠️ Volátil e não assinada de forma significativa

- ✅ A senha **nunca** é salva (nem em `localStorage`, nem em `sessionStorage`). Guardamos só um marcador de sessão volátil, apagado ao fechar a aba.
- ❌ O termo "sessão assinada" do cliente é, na prática, impossível de cumprir de forma criptograficamente real: qualquer chave de assinatura embutida no JS é pública, então a "assinatura" não prova nada contra alguém que leia o código. O token que geramos (`gerarTokenSessao`) é um marcador anti-previsão, não uma credencial verificável.

**Mitigação real:** sessões verdadeiramente assinadas exigem que o **servidor** emita e valide o token (ex.: JWT assinado com segredo no Apps Script, ou cookie de sessão). Isso é o caminho natural quando migrar para autenticação server-side (seção 5).

### 3.3. Credenciais compartilhadas e fixas ⚠️ Risco operacional

Duas pessoas, mesma senha, sem expiração nem rotação. Aceitável para 2 operadores de confiança hoje; vira passivo conforme a clínica cresce. Ver recomendações.

---

## 4. Resumo executivo (real × cosmético)

| Controle | Classificação | Por quê |
|---|---|---|
| Anti-XSS via DOM seguro | **Real — forte** | Proteção por construção, validada |
| CSP restritiva | **Real** | Defesa em profundidade contra script inline |
| Validação/whitelist no backend | **Real — forte** | Garante integridade dos dados financeiros |
| LockService (anti-corrida) | **Real** | Serializa escritas concorrentes |
| Erros sem stack trace | **Real** | Evita reconhecimento pelo atacante |
| Trilha de auditoria | **Real** | Responsabilização |
| Login server-side (modo API) | **Real** | Validação fora do cliente |
| Hash de senha no cliente (modo demo) | **Cosmético** | Hash e referência ambos públicos |
| Sessão "assinada" no cliente | **Cosmético** | Sem segredo real no navegador |
| Senha compartilhada fixa | **Passivo** | Sem rotação/expiração |

**Leitura honesta:** a integridade dos *dados* está bem protegida (o que mais importa num controle financeiro). A *autenticação*, no modo demo, é fraca por natureza — e a correção já está no código, bastando ativar o modo backend.

---

## 5. Recomendações futuras (quando a clínica crescer)

Em ordem de retorno sobre esforço:

1. **Operar em modo backend (`USAR_API = true`) o quanto antes.** Move a validação de credenciais para fora do navegador. Esforço baixo, ganho alto — é o passo que transforma o login de cosmético em real.
2. **Rotação de credenciais e senhas individuais.** Uma senha por operador, troca periódica. Como os hashes ficam no `Code.gs`, é só atualizar o objeto `USUARIOS`.
3. **Rate limiting no login.** Hoje o backend registra tentativas, mas não as limita. Adicionar contagem por janela de tempo (via `PropertiesService`/`CacheService`) freia força bruta.
4. **Migração para identidade gerenciada — OAuth2 / Firebase Auth / Google Sign-In.** O caminho definitivo: elimina senhas compartilhadas, dá login pela conta Google da clínica, tokens com expiração e revogação. Como os dados já vivem no ecossistema Google, o Google Sign-In é o encaixe mais natural e barato.
5. **Sessões com token assinado pelo servidor (JWT).** Quando houver auth real, emitir tokens assinados com segredo no backend, com expiração — substituindo o marcador volátil atual por algo verificável.
6. **HTTPS ponta a ponta (já garantido).** GitHub Pages e Apps Script servem por HTTPS; manter assim e nunca expor o endpoint em página HTTP.

---

## 6. Conclusão

A v2 está sólida onde mais importa para um sistema financeiro de clínica: **os dados não podem ser corrompidos nem injetados**, graças à validação rigorosa no backend e à renderização anti-XSS. A camada de **autenticação**, no modo demonstração, é deliberadamente leve e eu não a apresento como mais do que é — mas o sistema já traz, pronto, o caminho para torná-la robusta (validação server-side), bastando ativá-lo.

Recomendação final: usar o modo demo para validar o fluxo com tranquilidade e, ao colocar em produção com dados reais e recorrentes, ativar o backend e seguir as recomendações 1–4. Assim o sistema passa de "uma planilha compartilhada modernizada" para "uma aplicação financeira com fronteira de confiança no lugar certo".

*Auditoria conduzida sobre o código entregue nesta versão. Nenhum controle descrito como "real" depende de configuração futura, exceto o login server-side, que requer a publicação do `Code.gs` e `USAR_API = true`.*
