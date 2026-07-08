# SDD Spec — Sanitizacao de mensagens antes do relatorio (v1)

- **Status:** locked (validada com o usuario em 2026-07-03 — escopo completo, Opcao A, branch nova)
- **Owner:** processos@grupodpg.com.br
- **Branch sugerida:** `feat/sanitize-mensagens-relatorio`
- **Data:** 2026-07-03
- **Origem:** discussao em party mode (BMAD) sobre a qualidade do `Relatorio-fenix-2026.pdf`

## 1. Problema

O relatorio gerado (`POST /reports`) sai afogado em ruido. No caso real (cliente "fenix",
152 mensagens) o PDF tem **80 paginas, das quais 77 sao `[RELATORIO BRUTO COMPLETO]`** — um
dump literal com centenas de linhas so com "Teste", protocolos identicos repetidos em datas
diferentes e mensagens duplicadas na integra. Boa parte do volume nem e conversa com cliente:
sao notificacoes automaticas de "protocolos em atraso".

Duas causas somam para o mesmo efeito:

1. **Entrada sem higiene.** As mensagens chegam a
   [generateReport](../../src/services/reportService.ts#L664) cruas. `buildReportData`
   ([messageProcessor.ts:326](../../src/services/messageProcessor.ts#L326)) monta a `timeline`
   com todo o ruido, e `buildReportText`
   ([reportService.ts:79-86](../../src/services/reportService.ts#L79-L86)) despeja isso no log
   enviado ao Gemini.
2. **Eco do ruido pela IA.** O `SYSTEM_INSTRUCTION`
   ([aiService.ts:71-81](../../src/services/aiService.ts#L71-L81)) instrui o Gemini a
   **anexar o log completo de volta** como `[RELATORIO BRUTO COMPLETO]`. O modelo re-emite
   cada "Teste" e cada duplicata — gastando tokens de saida e produzindo as 77 paginas.

Consequencia: PDF ilegivel como documento executivo, custo de tokens inflado e risco de
estourar a janela de contexto do `gemini-2.5-flash-lite` conforme o volume cresce.

## 2. Objetivo

**Limpar a materia-prima de forma deterministica antes da IA e parar de ecoar o log bruto.**
Filtro e regra booleana — mora no codigo, e testavel e auditavel. A IA fica so com sintese e
redacao. Meta pratica: reduzir o PDF de ~80 para ~5-10 paginas **sem perder sinal**.

## 3. Restricoes explicitas (a validar)

1. **Filtro deterministico, nunca probabilistico.** Nao delegar dedup/limpeza ao prompt do
   Gemini (nao-reproduzivel, nao-auditavel, custa tokens).
2. **Conservador por padrao.** Na duvida, manter a mensagem. Um falso-negativo (ruido que passa)
   e toleravel; um falso-positivo (conversa real descartada) nao.
3. **Sem mudanca de contrato de API.** `POST /reports` request/response inalterados nesta spec.
4. **Sem migration Prisma.** Nenhuma mudanca de schema.
5. **Fora de escopo o prompt novo de BI/Customer Success e tabelas** — isso e o v2 (spec propria).

## 4. Escopo — o que muda

### 4.1 Nova funcao pura `sanitizeMessages` (messageProcessor.ts)

Opera sobre `MessageRecord[]` (ja filtrados por cliente em `findMatchingMessagesByField`),
antes de `buildReportData`. Retorna as mensagens limpas + estatisticas de auditoria.

```ts
export interface SanitizeStats {
  input: number;
  droppedTestOnly: number;   // mensagens "Teste" isoladas
  droppedDuplicate: number;  // duplicatas exatas (conteudo normalizado)
  output: number;
}

export function sanitizeMessages(
  records: MessageRecord[]
): { records: MessageRecord[]; stats: SanitizeStats };
```

**Regras (nesta ordem), todas puras e deterministicas:**

1. **`dropTestOnly`** — descarta mensagens cujo texto, apos `normalizeText`
   ([utils/text.ts:5](../../src/utils/text.ts#L5)), case exatamente em `teste` / `testes`
   (regex ancorada `^testes?$`). NAO descarta mensagens que apenas *contenham* a palavra
   "teste" dentro de conteudo real, nem mensagens **sem texto** (podem ser anexos/arquivos
   compartilhados — carregam sinal).
2. **`dedupExact`** — para mensagens com texto normalizado **nao-vazio**, mantem a **primeira**
   ocorrencia de cada texto e descarta repeticoes identicas subsequentes (via `Set` de hash do
   conteudo normalizado). Colapsa tanto duplicatas na integra quanto o mesmo bloco de protocolo
   reenviado em dias diferentes. Mensagens **sem texto nunca sao deduplicadas** (10 anexos
   distintos permanecem 10).

`collapseProtocols` (agrupar por numero de protocolo mesmo com texto levemente diferente,
usando `similarityRatio` de [utils/similarity.ts:3](../../src/utils/similarity.ts#L3)) fica
**fora do v1** — ver Nao-objetivos. Risco de descartar atualizacoes legitimas de status do
mesmo protocolo; exige mais criterio e testes proprios.

### 4.2 Wiring em `generateReport` (reportService.ts)

No topo de [generateReport](../../src/services/reportService.ts#L664), sanitizar uma unica vez
e usar o resultado tanto em `buildReportData` quanto em `analyzeWithAI` (que hoje recebem
`records` nas linhas [671](../../src/services/reportService.ts#L671) e
[673](../../src/services/reportService.ts#L673)):

```ts
const { records: clean, stats } = sanitizeMessages(records);
logger.info({ ...stats }, 'sanitizacao de mensagens do relatorio');
const report = buildReportData(clean, query, nameMap);
const rawText = buildReportText(report);
const text = await analyzeWithAI(rawText, clean, analyzeOptions);
```

### 4.3 Parar o eco do log bruto (aiService.ts + reportService.ts)

1. **Remover o bloco `[RELATORIO BRUTO COMPLETO]`** do `SYSTEM_INSTRUCTION`
   ([aiService.ts:71-81](../../src/services/aiService.ts#L71-L81)). O Gemini deixa de re-emitir
   o log — menos tokens de saida, zero risco de alucinacao/omissao no eco.
2. **Renderizar o anexo bruto em codigo**, de forma deterministica, a partir da `timeline`
   ja limpa. `buildHtml` ([reportService.ts:592-597](../../src/services/reportService.ts#L592-L597))
   passa a montar a secao `RELATORIO BRUTO COMPLETO` diretamente de `report.timeline` (mesmo
   formato de linha `[DD/MM/AAAA - HH:mm:ss] [Nome]: mensagem` que `buildReportText` ja produz
   em [reportService.ts:83](../../src/services/reportService.ts#L83)), reaproveitando
   `buildRawLogHtml` ([reportService.ts:525](../../src/services/reportService.ts#L525)).

Resultado: o anexo bruto continua existindo (rastreabilidade preservada), mas deduplicado,
sem "Teste", vindo do codigo e nao da IA.

> **Decisao (validada 2026-07-03):** **Opcao A** — manter o anexo bruto no PDF, limpo e
> renderizado em codigo. Mover o anexo para fora do documento (Opcao B) fica para o v2 de UX.

## 5. Contrato de API

Inalterado. Nenhum campo novo no request nem no response. Nenhuma mudanca de validacao Zod.
`stats` da sanitizacao vai para o **log estruturado (Pino)**, nao para a resposta HTTP.

## 6. Nao-objetivos (fora de escopo do v1)

- `collapseProtocols` / near-dup por similaridade (levenshtein) — refino de v1.1/v2.
- Classificacao "notificacao automatica x conversa humana" na ingestao (ponto da Mary; e o
  maior ganho de qualidade, mas e um projeto proprio — v2).
- Prompt novo de "Analista de BI/Customer Success", piramide invertida, tabelas por
  departamento (Paige/Mary) — v2, spec propria. **Alerta ja registrado:** a regra ASCII-only
  ([aiService.ts:12,63](../../src/services/aiService.ts#L12)) precisa ser reconciliada com
  tabelas Markdown/acentos no render HTML->PDF antes do v2.
- Mudar o entregavel de PDF para "alerta de 5 linhas" (provocacao Sally/John) — decisao de
  produto, fora de engenharia por ora.
- Coluna de auditoria em `Report` (ex: `noiseRemoved`) no schema Prisma.

## 7. Plano de implementacao

| Etapa | Arquivo | Mudanca |
|---|---|---|
| 1 | [messageProcessor.ts](../../src/services/messageProcessor.ts) | `sanitizeMessages` + `SanitizeStats` (regras `dropTestOnly`, `dedupExact`). Funcoes puras, sem I/O. |
| 2 | [reportService.ts](../../src/services/reportService.ts#L664) | Sanitizar no topo de `generateReport`; usar `clean` em `buildReportData` e `analyzeWithAI`; `logger.info(stats)`. |
| 3 | [aiService.ts](../../src/services/aiService.ts#L71-L81) | Remover bloco `[RELATORIO BRUTO COMPLETO]` do `SYSTEM_INSTRUCTION`. |
| 4 | [reportService.ts](../../src/services/reportService.ts#L563) | `buildHtml` monta a secao bruta a partir de `report.timeline` limpa (reaproveita `buildRawLogHtml`). |
| 5 | `src/services/messageProcessor.test.ts` (novo) | Testes Vitest (test-first, ver secao 8). |

## 8. Plano de testes (Vitest, test-first)

Arquivo `src/services/messageProcessor.test.ts` ao lado do source. Escrever **vermelho antes**
da implementacao (regra 2 do CLAUDE.md).

- `dropTestOnly`: mensagem "Teste" / "Teste " / "TESTES" -> descartada.
- `dropTestOnly`: mensagem "Teste de mesa aprovado pelo cliente" -> **mantida** (contem "teste"
  mas nao e teste isolado). Guard contra falso-positivo.
- `dedupExact`: 5 mensagens de texto identico -> resta 1 (a primeira, preservando `createTime`).
- `dedupExact`: mesmo protocolo enviado em 2 datas com texto identico -> resta 1.
- `dedupExact`: dois textos diferentes -> ambos mantidos.
- `stats`: `input`, `droppedTestOnly`, `droppedDuplicate`, `output` batem com a entrada.
- Edge: array vazio -> `{ records: [], stats: {input:0,...,output:0} }`.
- Edge: texto com acento/unicode e espacos multiplos normaliza igual (usa `normalizeText`).
- Integracao leve: `buildReportData(sanitizeMessages(fixture).records, query)` produz `timeline`
  menor que `buildReportData(fixture, query)` para um fixture com ruido conhecido.

## 9. Decisoes e trade-offs registrados

- **Por que filtro em codigo e nao no prompt?** Consenso unanime da party (Winston, Amelia,
  Mary, Paige, Sally, John): dedup e regra booleana. No prompt vira probabilistico — o Gemini
  "quase sempre" acerta, falha de forma invisivel e custa tokens. No codigo falha visivel
  (teste vermelho) e e reproduzivel numa auditoria de cliente.
- **Por que `dedupExact` por texto normalizado e nao por `message.name`?** `message.name` ja
  deduplica identidade de mensagem na busca; o ruido aqui e **conteudo repetido** por mensagens
  distintas (protocolo reenviado). A chave e o conteudo normalizado.
- **Risco aceito: `dedupExact` pode colapsar uma repeticao legitima** (ex: cliente manda
  "ok" duas vezes em momentos diferentes). Impacto baixo — "ok" repetido nao carrega sinal.
  Mitigacao futura: janela temporal ou exigir texto > N chars para deduplicar (v1.1 se
  necessario).
- **Por que remover o eco em vez de so encolher via filtro?** Mesmo limpo, pedir para a IA
  copiar o log de volta gasta tokens de saida e arrisca omissao/alucinacao. Render em codigo e
  deterministico e barato (ponto de Winston/Amelia).
- **Por que manter o anexo bruto (Opcao A) e nao remove-lo?** Rastreabilidade de auditoria
  com o menor delta possivel. O formato final (anexo vs. link) e decisao de UX do v2.

## 10. Criterios de aceite

1. `sanitizeMessages` remove "Teste" isolados e duplicatas exatas; mantem conversa real
   (coberto por testes Vitest verdes).
2. Para o fixture do cliente "fenix" (ou equivalente), o numero de entradas na `timeline` cai
   de forma expressiva e o PDF resultante fica em ~5-10 paginas.
3. O Gemini nao emite mais `[RELATORIO BRUTO COMPLETO]`; a secao bruta vem do codigo, limpa.
4. `stats` da sanitizacao aparece no log estruturado (Pino) de cada geracao.
5. Contrato de `POST /reports` inalterado (request e response identicos).
6. `npm run check` (lint + typecheck + test + build) verde.

## 11. Resultado do v1 e direcao v2 (retrospectiva 2026-07-08)

**Status v1:** implementado, mergeado (PR #7) e deployado. Pipeline roda fim-a-fim.
Eco da IA removido com sucesso (secoes da IA + raw log renderizado por codigo).
**Porem o criterio de aceite 2 NAO foi atingido.**

**Evidencia (PDF real do cliente "fenix"):** o PDF saiu com **117 paginas** (meta era
~5-10). Da pagina 13 a 117 (~105 paginas) e o `[RELATORIO BRUTO COMPLETO]`, ainda
cheio de "Teste" e protocolos repetidos. Log da sanitizacao:
`input:156, droppedTestOnly:0, droppedDuplicate:11, output:145`.

**Causa raiz — o modelo de ruido da v1 estava errado para os dados reais:**
`dropTestOnly` e `dedupExact` operam no nivel da **mensagem inteira**. Mas o ruido e
**intra-mensagem**: cada notificacao automatica e cada despejo "Seguem protocolos em
atraso do departamento..." e UMA unica mensagem do Google Chat contendo centenas de
linhas (com "Teste" e protocolos repetidos dentro). Por isso quase nada casou.

**Estrutura real observada:**
- Sinal (conversa humana real): ~15-20 mensagens (Jacqueline, Nestor, Bruno, Lidiane).
- Ruido (~130 msgs): remetentes terminando em "- Automatica" (Novos Clientes BuscaPost,
  Atrasados Time Caio, Log de Publicacoes Busca Post, Atrasados time Amanda) + despejos
  manuais de "Seguem protocolos em atraso".

**Direcao v2 (a validar em party / spec propria):** classificar/filtrar/colapsar
mensagens de **notificacao automatica x conversa humana** ANTES do pipeline — o ponto
que a Mary ja havia levantado (secao 6, Nao-objetivos). Marca clara de ruido: remetente
"Automatica", blocos "Seguem protocolos em atraso", "Log de Publicacoes". Usar o PDF do
fenix como **fixture real** para medir antes/depois (117 -> X paginas).

**Pendencia paralela:** PR #8 (fix timeout Puppeteer `waitUntil: 'load'` + 60s; nome do
Drive corrigido para "DRIVE de CLIENTES da DPG") ainda a deployar — necessario para
confiabilidade do PDF e para o upload no Drive.
