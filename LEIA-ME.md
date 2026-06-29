# Estética Integrativa — Controle Financeiro v2

Refatoração completa: arquitetura modular (ES Modules), segurança OWASP, design glassmorphism.

---

## ⚠️ IMPORTANTE — não abra com duplo-clique

Esta versão usa **ES Modules** (`import`/`export`). Por isso, **NÃO funciona** abrindo o `index.html` direto pelo navegador (protocolo `file://`) — você verá tela em branco. Os módulos exigem um servidor HTTP. Há três formas fáceis:

- **GitHub Pages** (recomendado, é online e grátis) — funciona de imediato.
- **VS Code + extensão "Live Server"** — botão direito no `index.html` → "Open with Live Server".
- **Terminal:** dentro da pasta, rode `python -m http.server` e acesse `http://localhost:8000`.

O `Code.gs` **não** vai para o GitHub — ele é colado no Google Apps Script (ver abaixo).

---

## Estrutura de arquivos

```
estetica-integrativa-v2/
├── index.html              # HTML semântico + CSP + ARIA
├── style.css               # Glassmorphism, skeletons, clamp()
├── Code.gs                 # Backend Apps Script (vai no Google, não no GitHub)
├── AUDITORIA-SEGURANCA.md  # Relatório de threat model (leitura recomendada)
└── src/
    ├── main.js             # Ponto de entrada (orquestração)
    ├── config.js           # Liga/desliga modo backend
    ├── core/
    │   ├── auth.js         # Sessão e autenticação (hash SHA-256)
    │   └── estado.js       # Store central (pub/sub)
    ├── services/
    │   └── api.js          # Única ponte com o Apps Script
    ├── domain/
    │   └── financeiro.js   # Regras de negócio (taxas, lucros)
    ├── ui/
    │   └── components.js    # Renderização segura (DOM, gráficos, skeletons)
    ├── utils/
    │   ├── security.js     # encodeHTML, validações, hash
    │   └── formatters.js   # Moeda, datas, máscaras
    └── data/
        └── seed.js         # Dados históricos da planilha (modo demo)
```

---

## Como funciona

O sistema roda em dois modos, controlados por `src/config.js`:

- **Modo Demo (`USAR_API = false`, padrão):** carrega os dados históricos da planilha em memória. Tudo funciona — login, cálculos, gráficos, exportação — mas o que você cadastrar some ao recarregar a página. Ótimo para testar e demonstrar.
- **Modo Online (`USAR_API = true`):** lê e grava de verdade no Google Sheets, em tempo real, para os dois operadores.

**Login (ambos os modos demo):** usuário `nicole` ou `felipe`, senha `220916`.

---

## Ativar o modo Online (Google Sheets)

1. Crie uma planilha nova no Google Sheets.
2. **Extensões → Apps Script.** Apague o conteúdo e cole o `Code.gs`.
3. No editor do Apps Script, selecione a função **`configurar`** e clique em ▶ Executar (autorize o acesso). Isso cria as abas `Entrada`, `Saída` e `Log` com os cabeçalhos.
4. **Implantar → Nova implantação → Tipo: App da Web.**
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
   - Copie a **URL do app da Web** (termina em `/exec`).
5. Em `src/config.js`, cole a URL em `URL_WEB_APP` e troque `USAR_API` para `true`.
6. Publique no GitHub Pages e pronto — os dois operadores usam o mesmo sistema, dados sincronizados.

> A senha fica no `Code.gs` (objeto `USUARIOS`), como hash. Para trocá-la, gere o SHA-256 da nova senha e substitua o hash.

---

## Segurança

Leia o **`AUDITORIA-SEGURANCA.md`**. Em resumo honesto:

- **Forte:** proteção anti-XSS (renderização por nós DOM), validação rigorosa no backend (impede dado financeiro forjado), CSP, trava anti-corrida, erros sem vazar stack trace, trilha de auditoria.
- **Fraco por natureza (modo demo):** o login. Hash de senha no cliente é ofuscação — a referência é pública. A correção já está no código: ative o modo Online, onde o backend valida o login fora do navegador.

A integridade dos seus *dados* está bem protegida. A *autenticação* só vira robusta no modo Online.

---

## Design

Paleta terracota evoluída para glassmorphism: superfícies de vidro fosco na barra superior, navegação e modais; sombras difusas em camadas; tipografia fluida com `clamp()`; skeleton loaders durante o carregamento; transições de 60fps. Mobile-first com sensação de app nativo (bottom-nav, FAB, modais que sobem de baixo), e layout que se reorganiza para desktop (navegação lateral).
