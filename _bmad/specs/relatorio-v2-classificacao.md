# SDD Spec — Relatorio v2: classificacao por procedencia + pertinencia, log bruto linkado

- **Status:** draft-r2 (revisada em party mode pre-lock 2026-07-08 — Winston/Amelia/Mary; bloqueadores incorporados abaixo)
- **Owner:** processos@grupodpg.com.br (Lidy)
- **Branch sugerida:** `feat/relatorio-v2-classificacao`
- **Data:** 2026-07-08
- **Origem:** retrospectiva do v1 ([[sanitize-mensagens-relatorio]], secao 11) — o v1 nao reduziu o PDF. Party mode (Winston, Amelia, Mary, John) + PDF real do cliente "fenix" como evidencia.
- **Depende de:** PR #8 (fix timeout Puppeteer + nome do Drive) deployado antes.

## 1. Problema

O v1 (`dropTestOnly` + `dedupExact` no nivel da MENSAGEM) foi deployado mas nao reduziu o PDF:
saiu com **117 paginas** (meta 5-10), das quais ~105 sao o `[RELATORIO BRUTO COMPLETO]`.
Log da sanitizacao no fenix: `input:156, droppedTestOnly:0, droppedDuplicate:11, output:145`.

Causa: o ruido e **intra-mensagem**. Cada notificacao automatica e cada despejo "Seguem
protocolos em atraso..." e UMA mensagem do Chat com centenas de linhas dentro. Regras no
nivel da mensagem nao tocam nisso.

Evidencia nos dados reais:
- **Sinal** (conversa humana): ~15-20 msgs (Jacqueline, Nestor, Bruno, Lidiane).
- **Ruido** (~130 msgs): remetentes terminando em "- Automatica" (Novos Clientes BuscaPost,
  Atrasados Time Caio, Log de Publicacoes Busca Post, Atrasados time Amanda) + despejos
  manuais de "Seguem protocolos em atraso".
- **Falso-positivo real confirmado:** a linha `Cod.: RAZ658RJ | projeto fenix - revitalizacao
  de site: RAZAO ORGANIZACAO CONTAB` menciona "fenix" mas o cliente e a RAZAO — busca cega por
  palavra-chave puxa errado.

## 2. Objetivo

Reduzir o PDF do fenix de 117 para ~5-10 paginas **sem perder sinal**, atacando o ruido na
unidade certa (linha, nao mensagem), de forma **deterministica e auditavel**, e movendo o log
bruto completo para fora do PDF (como prova linkada).

## 3. Restricoes explicitas

1. **Filtro deterministico, nunca no prompt.** Refino da regra do CLAUDE.md (Winston): *"nunca
   coloque no prompt um filtro que possa ser expresso como predicado reproduzivel."* Discernir
   contexto genuino (sem ancora) pode ir a IA — mas **cercado e com evidencia obrigatoria**.
2. **Conservador.** Classificar como ruido != deletar. Falso-positivo (conversa humana some) e
   inaceitavel; falso-negativo (ruido passa) e toleravel. Tudo classificado como ruido continua
   vivo no arquivo bruto linkado.
3. **Rastreabilidade.** Toda afirmacao da IA ancorada em evidencia (linha-fonte no `.txt`).
4. **Single-client rigoroso.** A IA so recebe dados de UM cliente. Nao comparar carteira.
5. pt-BR no exibido; TDD-lite; `AppError` para erros previsiveis; sem `any` novo; migration
   versionada para mudanca de schema.

## 4. Escopo — o que muda

> **Revisao pre-lock (Winston/Mary):** a classificacao e por **MENSAGEM**, nao por linha. A
> linha e usada como *evidencia*, mas a unidade de decisao e a mensagem inteira — senao uma
> mensagem multi-linha (CNPJ do cliente na linha 1, gargalo na linha 5) e rasgada e o sinal se
> separa da propria ancora.

### 4.1 Camada 0 — Particao por procedencia (remetente), em codigo — TRES classes
**Decisao (owner, 2026-07-08):** os "bots" sao **webhooks** e NAO vem com marca de app/bot
confiavel, entao **nao usar `sender.type === BOT`**. Deteccao e **por NOME do remetente**:
`isAutomatedSender(message)` = `normalizeText(sender.displayName)` casa sufixo
`/(?:^|\s[-–]\s*)automatica$/`. Confirmado nos dados: TODOS os robos seguem a convencao
"... - Automatica" (Novos Clientes BuscaPost, Atrasados Time Caio, Log de Publicacoes Busca Post,
Atrasados time Amanda). **Fragilidade aceita:** depende de quem cria webhook manter o sufixo.
Mitigacao: manter tambem uma **allowlist** dos nomes-base conhecidos e um teste que falha se um
remetente conhecido deixar de casar. `classifyBySender` retorna `'human' | 'bot'`.
**Nao e binario signal/noise** — ver 4.2. O split final em 3 classes (humano / automatico-do-cliente
/ automatico-de-terceiro) so fecha depois do cruzamento por ancora, senao o "Log de Publicacoes"
(remetente bot) seria jogado em `noise` e o balde estruturado nunca seria alimentado (contradicao
Camada 0<->2 apontada pelo Winston).

### 4.2 Camada 1 — Pertinencia por ancora, no nivel da MENSAGEM
Para cada mensagem, coleta as ancoras presentes (CNPJ/nome/aliases do cliente atual **e** de
outros) varrendo suas linhas. Reusa a logica de `buildFieldMatchers`, mas a assinatura-alvo e
`(text: string) => boolean` (ver pendencia 11.2). Regra de precedencia (Mary — BLOQUEADOR
resolvido):

- **`MATCHED`** — a mensagem contem ancora do cliente atual (nome/CNPJ/email/telefone — os campos
  ja pesquisados). **Precede tudo:** vale mesmo que contenha ancoras de outros clientes (preserva
  a frase comparativa "diferente do cliente X, no fenix..."). **Sem catalogo de aliases**
  (owner confirmou 2026-07-08: clientes sao sempre referenciados por nome/CNPJ, nao por apelido);
  `normalizeText` ja resolve acento ("fenix" == "fenix").
- **`IRRELEVANT`** — contem ancora de OUTRO cliente **E ausencia** de ancora do cliente atual ->
  descarta do relatorio (resolve `projeto fenix ... RAZAO`).
- **`AMBIGUOUS`** — menciona o termo do cliente **sem ancora** confirmavel -> quarentena
  (ver 4.3, contrato). Mensagens com anexo/link referenciando o cliente caem aqui, nunca direto
  em descarte.
- **default (`MATCHED`)** — mensagem HUMANA sem ancora nenhuma e sem termo (ex.: "ok, obrigado",
  "vou verificar amanha") -> **mantem como sinal conversacional**. Taxonomia MECE (Winston):
  nenhuma mensagem humana cai no vao. So mensagem BOT sem cruzamento com o cliente vira `noise`.

### 4.3 Camada 2 — Tres destinos + contrato do AMBIGUOUS
- **`noise` agregavel** (BOT de terceiro, sem cruzar o cliente) -> **metrica multidimensional**
  (Mary): nao so o total, mas **por tipo de bot + janela temporal + pico** ("142 alertas de
  atraso, concentrados em [3 semanas]"). O balde estruturado (abaixo) NUNCA entra nessa metrica.
- **`signal` conversacional** (humano, `MATCHED`/default) -> **resumo da IA**.
- **`signal` estruturado** (BOT que CRUZA o cliente — ex.: Log de Publicacoes do fenix) ->
  **lista cronologica montada por CODIGO**, sem IA. `extractPublicationLog(messages): { data,
  evento, link }[]` — formato estavel (CLIENTE + CNPJ + Link).
- **Contrato do `AMBIGUOUS`** (Winston): so o balde AMBIGUOUS vai a IA, com cap de volume (ex.:
  N linhas). A IA **deve** devolver a linha-evidencia. **Se nao devolver evidencia (ou alucinar):
  o codigo DESCARTA a linha** (conservador para o *conteudo exibido*), MAS ela continua no `.txt`
  bruto (nada se perde de fato). Todas as decisoes de quarentena viram um **contador exposto no
  relatorio** (Mary): "X ambiguas | Y viraram sinal | Z descartadas" — para a Lidy pescar
  falso-descarte.

### 4.4 Log bruto completo -> arquivo `.txt` no Drive + link no PDF
O `[RELATORIO BRUTO COMPLETO]` sai do corpo do PDF. Vira um arquivo `.txt` (prova completa,
ANTES da particao — inclui tudo) na **mesma pasta do cliente**, pareado por nome
(`Relatorio-{cliente}-{data}.pdf` e `...-log-bruto.txt`). Cabecalho de 2 linhas no `.txt`:
"X msgs totais, Y classificadas como ruido automatico". PDF traz so um **rodape**:
"Log bruto completo (prova): {link}". Uso interno DPG (usuaria confirmou), entao o link no PDF e
seguro e herda a permissao da pasta do cliente.

**Reordenacao do pipeline (`reportRoutes.ts`)** — resolve o chicken-egg (PDF precisa do link).
Ordem anti-orfao (Winston): so sobe o `.txt` **depois** que a IA (`buildReportModel`) ja
concluiu — assim uma falha do Gemini (que esta acontecendo agora, chave em rotacao) nao planta
`.txt` orfao na pasta do cliente:
1. `messages = findMatchingMessagesByField(...)`
2. classifica (4.1-4.3) -> `{ conversational, structured, noiseMetrics, quarantine }`
3. identidades sobre o sinal
4. `model = buildReportModel(...)` (dados + IA, puro, sem Puppeteer) — **se a IA falhar, aborta aqui, sem nada no Drive**
5. `folderId = ensureClientFolder(...)` (chamado UMA vez, id reusado)
6. `rawLog = buildRawLog(messages, identities)` (TODAS as msgs, antes da particao)
7. `rawLink` = try `uploadFileToDrive({ folderId, buffer, name:'...-log-bruto.txt', mimeType:'text/plain' })`
   **catch escopado -> `rawLink = null`** (degrada: rodape "log bruto indisponivel"; NAO derruba o relatorio)
8. `pdf = renderReportPdf(model, { rawLogLink: rawLink })`
9. `pdfLink = uploadFileToDrive({ folderId, buffer: pdf, mimeType:'application/pdf' })`
10. persiste `Report{ driveLink: pdfLink, rawLogLink: rawLink, summary }`

`generateReport` parte em `buildReportModel` (dados + IA, puro) e `renderReportPdf(model, opts)`.
`driveService.uploadReportToDrive` vira `uploadFileToDrive` generico
(`{ folderId, buffer, name, mimeType }) -> { fileId, webViewLink }`).

### 4.5 Secoes vazias — distinguir "sem atividade" de "busca vazia"
A usuaria confirmou: hoje busca-vazia e cliente-sem-movimento produzem o mesmo relatorio vazio.
Regra v2:
- Secoes **descritivas** (Dados de Acesso, Dados Criticos) -> omitir se vazias.
- Secoes **de risco** (Pendencias, Gargalos, Cronograma) -> SEMPRE aparecem: "Nenhum X no
  periodo (verificado)".
- **Busca sem nenhuma mensagem** -> mensagem explicita no topo: "Nenhuma mensagem encontrada
  para este cliente — verificar a busca." (nao mascarar falha de coleta como "cliente tranquilo").

### 4.6 Prompt da IA (`aiService.ts` SYSTEM_INSTRUCTION)
- Mantem: foco single-client + desambiguacao de referencia (linha "fenix" que e de outro cliente).
- Remove a filtragem de lista (movida para a Camada 1).
- **Corrige ASCII-only:** troca "apenas ASCII" por "portugues com acentuacao; sem emojis nem
  simbolos decorativos". O medo era encoding no PDF — resolver no `buildHtml` com
  `<meta charset="utf-8">`, nao no prompt. Sem tabela Markdown (decisao da usuaria: listas simples).
- Omissao de secoes vazias conforme 4.5.

### 4.7 Sanitizacao das variaveis do prompt (injecao)
Nome/CNPJ/email/telefone sao interpolados no prompt. `sanitizePromptVar(raw): string` (util puro,
TDD) — regra pinada (Amelia): (1) remove `[`, `]`, backtick, `<`, `>` (os `<>` fecham/abrem o
bloco delimitador — critico); (2) remove os literais dos tokens de secao (`RESUMO EXECUTIVO`,
`DADOS DE ACESSO`, etc.); (3) colapsa `\r?\n` e whitespace multiplo em um espaco; (4) `.trim()` +
cap de tamanho (nome 120, cnpj 20, email 254, phone 20). Interpolar em bloco delimitado
(`<DADOS_CLIENTE>...</DADOS_CLIENTE>`), nunca inline. Entrada ja passa por Zod (email com
`.email()`, ver `reportRoutes.ts`); sanitizacao e defesa-em-profundidade.

### 4.8 Parser tolerante (`reportService.ts`)
`parseMarkdownSections(md): Map<SectionKey, string>` — so chaves presentes, sem throw em secao
ausente. `buildHtml` itera um **registry ordenado** de renderers (ordem do codigo, nao da IA);
secao desconhecida -> descarta com warn. Antes de parsear, valida shape da resposta do Gemini
com Zod (ao menos `RESUMO_EXECUTIVO` presente e string) -> senao `AppError(502, 'IA retornou
formato invalido')`.

## 5. Contrato de API

- `POST /reports` request/response inalterados.
- `Report` no Prisma ganha `rawLogLink String?` -> **migration versionada** (regra 9). Metricas de
  ruido vao em `summary` Json, sem coluna nova.

## 6. Nao-objetivos

- **Painel de carteira** (comparar varios clientes — pergunta do Bruno) — foi episodio unico,
  fica no backlog. O relatorio v2 continua single-client. O painel, se virar rotina, e epico proprio.
- **Tabelas Markdown** no PDF — decisao da usuaria: listas simples.
- **Tabela de desambiguacao projeto->cliente** — so se o balde `AMBIGUOUS` provar volume; comecar
  sem ela (o match por ancora ja resolve o "fenix"->RAZAO).
- Mover para Google Doc nativo o log bruto — `.txt` basta como prova.

## 7. Plano de implementacao (ordem corrigida pela Amelia)

Ordem respeita dependencias de teste/tipo: **fixture primeiro** (pre-requisito dos testes),
**schema antes da rota** (Prisma precisa tipar `rawLogLink`).

| Ordem | Arquivo | Mudanca |
|---|---|---|
| 0 | __fixtures__/fenix-messages.json (novo) | `MessageRecord[]` real do fenix (156) — **anonimizado** (ver 7.1); pre-requisito dos testes 1/4 |
| 1 | messageProcessor.ts | `classifyBySender`; classificacao por MENSAGEM com precedencia (3 baldes + default); `buildRawLog(messages, identities): string` (contrato de linha pinado); `extractPublicationLog(messages): {data,evento,link}[]` |
| 2 | promptSanitizer.ts (novo) | `sanitizePromptVar` (regra 4.7) |
| 3 | aiService.ts | SYSTEM_INSTRUCTION novo; interpolacao em bloco; Zod na saida -> `AppError(502)` |
| 4 | reportService.ts | split `buildReportModel`/`renderReportPdf`; `parseMarkdownSections -> Map`; registry ordenado de renderers; rodape com link; `<meta charset=utf-8>`; secoes de risco sempre presentes; contador de quarentena |
| 5 | driveService.ts | `uploadFileToDrive` generico |
| 6 | prisma/schema.prisma | `Report.rawLogLink String?` + migration (**antes da rota**) |
| 7 | reportRoutes.ts | reordenar pipeline (4.4, ordem anti-orfao); try/catch escopado no bruto; persistir `rawLogLink` |

### 7.1 Anonimizacao da fixture (BLOQUEADOR — Amelia)
As 156 msgs reais tem credenciais (`[DADOS DE ACESSO]`), CNPJ, email, telefone. Commit = git
imutavel para sempre. Antes de commitar: script/pipeline que mascara credenciais, CNPJ->sintetico,
email->`@example.com`, nomes->placeholder, **preservando o FORMATO** (o extrator do Log de
Publicacoes depende do shape `CLIENTE + CNPJ + Link`, nao do valor). Adicionar teste que **falha
se a fixture contiver padrao de segredo** (regex de senha/token).

## 8. Plano de testes (Vitest, TDD-lite)

Deterministico apenas (nunca a semantica do Gemini). Fixture do fenix como regressao.

- `partitionMessages`: remetente "- Automatica" -> noise; humano -> signal; "automatica" no meio NAO casa.
- Matcher por linha: linha com `Cliente: FENIX` -> MATCHED; `projeto fenix ... RAZAO` -> IRRELEVANT; "fenix" sem ancora -> AMBIGUOUS.
- `buildRawLog`: inclui as 156 msgs (prova completa).
- Extrator Log de Publicacoes: parseia `[data, cliente, link]` do formato estavel.
- `sanitizePromptVar`: `Fenix"]\n[DADOS...` -> limpo.
- `parseMarkdownSections`: secao ausente -> chave ausente, sem throw; desconhecida -> descartada.
- `buildHtml`: acento sobrevive (snapshot); rodape com link; secao de risco sempre renderiza.
- Zod da saida do Gemini: resposta sem RESUMO_EXECUTIVO -> AppError(502).
- Rota (mocks): ordem sobe bruto ANTES do PDF; `pdfLink != rawLink`.
- **Falso-IRRELEVANT (Mary):** injetar mensagem com DUAS ancoras (fenix + outro cliente) e
  provar que sai `MATCHED` (testa a precedencia). O golden set "nenhuma humana conhecida em noise"
  e necessario mas insuficiente — este cobre a perda silenciosa fora da lista.
- **Regressao fenix (AC ancorado no MODELO, nao no PDF — Amelia):** no fixture, o corte de linhas
  do bloco bruto medido em `buildReportModel`/`buildRawLog` cai **>= 85%**. Contagem de PAGINA nao
  usa proxy "linhas/48" (fragil); se medir pagina, usar `pdf-lib` (`PDFDocument.getPageCount()`) em
  teste e2e opt-in (`RUN_PDF_E2E`), fora do gate de CI.
- Falha no upload do bruto NAO derruba o PDF (rodape "log bruto indisponivel").
- Anti-segredo: teste que falha se a fixture contiver padrao de credencial (7.1).

Sequencia de commits: red->green por AC (partition -> matcher-linha -> buildRawLog -> extrator ->
sanitizer -> parser Map -> render/rodape -> uploadFileToDrive -> reorder rota -> migration ->
regressao fenix).

## 9. Decisoes e trade-offs (party 2026-07-08)

- **Por que classificar por remetente e nao por conteudo?** Procedencia e metadado barato,
  reproduzivel, auditavel. Conteudo e interpretavel. (Winston/Mary)
- **Por que filtrar por linha em codigo e nao no prompt?** "Achar a linha certa em lista de 40
  clientes" e estrutural (ancora por linha), nao semantico. No prompt vira loteria (~2% de erro
  sem log). So o resfduo sem ancora (AMBIGUOUS) e trabalho genuino de IA. (Mary/Winston)
- **Por que o Log de Publicacoes vira tabela de codigo?** Formato estavel + dado factual =
  fidelidade sem risco de alucinacao. Reforca "deterministico, nunca no prompt". (Mary)
- **Por que o log bruto sai do PDF mas continua existindo?** E prova contra alucinacao (rede de
  seguranca da usuaria), mas 105 paginas ninguem le. Link para arquivo completo resolve os dois.
  (John propos, usuaria confirmou.)
- **Por que nao omitir todas as secoes vazias?** Busca-falha e sem-atividade produzem relatorio
  vazio identico hoje. Omitir mascararia bug de coleta como "cliente tranquilo". (John/usuaria)
- **Falha no upload do bruto:** degradar (PDF sai com "log indisponivel"), nao abortar. (Amelia)

## 10. Criterios de aceite

1. No fixture do fenix, o corte de linhas do bloco bruto (medido no modelo) cai >= 85%.
2. Nenhuma das ~15-20 mensagens humanas conhecidas cai em `noise` (golden anti-falso-positivo).
3. `projeto fenix ... RAZAO` classificado como IRRELEVANT (nao entra no relatorio do fenix).
4. Mensagem com DUAS ancoras (fenix + outro) sai `MATCHED` (precedencia — anti-falso-IRRELEVANT).
5. Nenhuma mensagem HUMANA cai fora dos baldes (taxonomia MECE; default = MATCHED).
6. Log de Publicacoes do fenix aparece como lista cronologica montada por codigo (nao pela IA).
7. Metrica de ruido preserva tipo + janela + pico; balde estruturado NAO entra nela.
8. Contador de quarentena visivel ("X ambiguas | Y sinal | Z descartadas").
9. Log bruto completo existe como `.txt` na pasta do cliente; link no rodape (ou "indisponivel" se upload falhar, sem derrubar o PDF).
10. Busca vazia mostra "nenhuma mensagem encontrada — verificar"; secoes de risco sempre presentes.
11. Fixture anonimizada; teste anti-segredo verde.
12. Contrato de `POST /reports` inalterado; migration `Report.rawLogLink` versionada; `npm run check` verde.

## 11. Perguntas em aberto / dependencias

**Resolvidas pela owner (2026-07-08):**
- ~~`sender.type === BOT`~~ — bots sao webhooks sem marca confiavel; Camada 0 e por NOME (sufixo
  "- Automatica", convencao confirmada nos dados). Ver 4.1.
- ~~Catalogo de aliases~~ — clientes sempre referenciados por nome/CNPJ, sem apelido. `normalizeText`
  ja resolve acento. Ver 4.2.

**Em aberto:**
1. **Assinatura atual de `buildFieldMatchers`** (`messageProcessor.ts`) — nota de engenharia, nao
   depende da owner: hoje opera sobre `MessageRecord` e e consumida por `findMatchingMessagesByField`
   (UNION). Reusar por linha/texto (`(text: string) => boolean`) muda contrato -> AC de regressao
   garantindo que o `chatService` continua verde. Resolver durante a implementacao (etapa 1).
2. Deployar **PR #8** (timeout Puppeteer + nome do Drive) antes de comecar a v2.
