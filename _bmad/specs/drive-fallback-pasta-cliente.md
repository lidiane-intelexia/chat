# SDD Spec — Fallback de pasta do cliente no Drive

- **Status:** locked (validada com o usuário)
- **Owner:** processos@grupodpg.com.br
- **Branch:** `feat/drive-fallback-pasta-cliente`
- **Data:** 2026-05-08

## 1. Problema

Hoje, em [src/routes/reportRoutes.ts:100](../../src/routes/reportRoutes.ts#L100), o pipeline `POST /reports`
executa Chat → identidades → Gemini → Puppeteer (PDF) **antes** de tentar achar a pasta do cliente
no Drive compartilhado. Quando [src/services/driveService.ts:226-230](../../src/services/driveService.ts#L226-L230)
não localiza a pasta do cliente, lança `AppError(404)` e o `errorHandler` global devolve 404 ao
frontend. O PDF gerado é descartado, todo o custo de Gemini/Chat/Puppeteer é perdido, e o usuário
fica sem relatório.

## 2. Objetivo

**Nunca perder um relatório gerado.** Quando a pasta do cliente não existir no Drive, o sistema
deve salvar o PDF em uma pasta de fallback dentro do próprio Drive compartilhado e devolver o
link normalmente, com aviso ao usuário.

## 3. Restrições explícitas (locked)

1. **NÃO criar a pasta do cliente automaticamente.** Não inferir, não duplicar.
2. **NÃO bloquear a geração do relatório** quando a pasta do cliente não existir.
3. **NÃO lançar erro fatal** nesse caso — o pipeline deve concluir com sucesso.

## 4. Fluxo desejado

```
POST /reports
  ↓
Chat → Gemini → PDF
  ↓
procurar pasta do cliente em "Drive Clientes DPG"
  ├─ ENCONTROU → upload em
  │              "Drive Clientes DPG / <Cliente> / Relacionamento com Cliente / Relatórios / <ano>/"
  │              resposta:
  │                {
  │                  status: "ok",
  │                  fileId, webViewLink, downloadLink,
  │                  driveLocation: "client",
  │                  summary
  │                }
  │
  └─ NÃO ENCONTROU → upload em
                     "Drive Clientes DPG / _Sem-Pasta / <ano>/"
                     resposta:
                       {
                         status: "ok",
                         fileId, webViewLink, downloadLink,
                         driveLocation: "pending",
                         warning: "Pasta do cliente '<nome>' não encontrada no Drive. Relatório salvo em _Sem-Pasta",
                         summary
                       }
```

A pasta `_Sem-Pasta` e a subpasta `<ano>` são auto-criadas via `findOrCreateFolderInDrive` (já
existente). O underline força ordenação no topo da raiz alfabética do Drive — sinal visual de
"requer triagem".

## 5. Contrato de API

### Request (inalterado)

`POST /reports` — schema atual em [src/routes/reportRoutes.ts:14-29](../../src/routes/reportRoutes.ts#L14-L29).
Nenhum campo novo no body. Nenhuma mudança em validação Zod.

### Response (alterado)

Resposta de sucesso passa a incluir dois campos novos:

```ts
{
  status: "ok",
  fileId: string,
  webViewLink: string,
  downloadLink: string,
  driveLocation: "client" | "pending",   // NOVO
  warning?: string,                       // NOVO — presente apenas quando driveLocation === "pending"
  summary: { client, periodStart, periodEnd, totalMessages, participants }
}
```

`webViewLink` continua válido e clicável em ambos os casos — o Drive serve o arquivo igual
independentemente da pasta.

### Erros

- 401 / 404 / 500 / 503 — comportamento atual preservado.
- O caminho "pasta do cliente não encontrada" **deixa de ser** 404. Vira 200 com `warning`.
- Outros erros de Drive (cota, permissão, rede) continuam fluindo para o `errorHandler` como antes.

## 6. Persistência (Postgres)

`Report` é gravado normalmente em qualquer caso, com `driveFileId` e `driveLink` apontando para
o arquivo real (esteja ele na pasta do cliente ou em `_Sem-Pasta`).

**Não há migration nesta spec.** Auditoria de qual relatório caiu em fallback é deixada para um
PR seguinte se necessário (coluna opcional `Report.driveLocation`).

## 7. Frontend

[frontend/src/App.vue](../../frontend/src/App.vue): tipo `ReportRow` ganha `warning?: string` e
`driveLocation: 'client' | 'pending'`. Quando `driveLocation === 'pending'`, o card do relatório
mostra um banner amarelo (Tailwind `bg-amber-500/10 border-amber-500/40 text-amber-200`) com o
texto do `warning`.

O fluxo de submit é o mesmo — não há modal, não há confirmação extra. O usuário descobre o
fallback ao ver o resultado.

## 8. Decisões e trade-offs registrados

- **Por que `_Sem-Pasta` (e não auto-criação da pasta do cliente)?** Auto-criação polui o Drive
  com pastas duplicadas em caso de typo (`"Acme"` vs `"ACME LTDA"`). Restrição #1 explícita
  do usuário.
- **Por que não modal de confirmação (Opção B descartada)?** Adiciona round-trip e UX, sem
  resolver o problema de "trabalho perdido". A restrição #2 do usuário ("não bloquear") torna
  modal pré-submit incompatível.
- **Por que não persistir PDF no DB (Opção C descartada)?** O Drive já oferece persistência
  + `webViewLink`. Duplicar em DB cresce storage sem benefício.
- **Por que sucesso 200 e não 207 Multi-Status?** Frontend já trata `response.ok` em
  [App.vue:126](../../frontend/src/App.vue#L126) — manter HTTP 200 evita refatorar o branch
  de erro do front. O `warning` no body é suficiente.
- **Risco aceito: typos viram relatórios fantasma em `_Sem-Pasta`.** Mitigação manual (admin
  do Drive triamos periodicamente). Não bloqueante para esta spec.

## 9. Não-objetivos (fora de escopo)

- Reprocessamento automático ao criar a pasta do cliente posteriormente.
- Endpoint para listar/mover relatórios em `_Sem-Pasta`.
- Coluna `Report.driveLocation` no schema Prisma.
- Notificação por email/Chat quando um relatório cai em `_Sem-Pasta`.
- Alerta de "match fuzzy fraco" (score 1) — pasta encontrada com score baixo continua sendo
  tratada como match válido.

## 10. Plano de implementação

| Etapa | Arquivo | Mudança |
|---|---|---|
| 1 | [src/services/driveService.ts](../../src/services/driveService.ts) | Constante `PENDING_FOLDER_NAME = '_Sem-Pasta'`. `findClientFolderInDrive` retorna `string \| null` (não lança em "não encontrado"). `ensureClientFolder` retorna `{ yearFolderId, location: 'client' \| 'pending' }`; quando `null` da função anterior, monta `_Sem-Pasta/<ano>/` na raiz do drive. |
| 2 | [src/routes/reportRoutes.ts](../../src/routes/reportRoutes.ts) | Usa o `location` retornado para montar resposta. Quando `pending`, inclui `warning` em pt-BR com o nome buscado. |
| 3 | [frontend/src/App.vue](../../frontend/src/App.vue) | `ReportRow` ganha campos. Banner amarelo condicional. |
| 4 | `src/services/driveService.test.ts` (novo) | Testes Vitest com `googleapis` mockado. |
| 5 | `src/routes/reportRoutes.test.ts` (novo) | Testes Vitest do fluxo end-to-end mockado. |

## 11. Plano de testes (Vitest)

### `src/services/driveService.test.ts`

- `findClientFolderInDrive` retorna ID da pasta quando há match exato.
- `findClientFolderInDrive` retorna ID quando há match fuzzy (score 1).
- `findClientFolderInDrive` retorna `null` quando não há pasta correspondente (não lança).
- `ensureClientFolder` no caminho feliz retorna `{ yearFolderId, location: 'client' }`.
- `ensureClientFolder` em fallback monta `_Sem-Pasta/<ano>/` e retorna `location: 'pending'`.
- `_Sem-Pasta/<ano>/` é auto-criado se não existir.
- `normalizeName` smoke (acentos, prefixo numérico, espaços múltiplos).

### `src/routes/reportRoutes.test.ts` — **fora deste PR**

Trade-off registrado: a mudança em [src/routes/reportRoutes.ts](../../src/routes/reportRoutes.ts)
é mecânica (3 linhas de wiring que mapeiam `result.location` → `warning` + `driveLocation` na
resposta). Testá-la em isolamento exigiria adicionar `supertest` + `@types/supertest` como
devDeps, ou refatorar o handler anônimo do `reportRouter.post('/', async ...)` para função
nomeada exportável.

Decisão: nenhum dos dois agora. A regra 8 do CLAUDE.md pede dependências determinísticas e
mínimas; o ganho de cobertura é marginal porque toda a lógica que pode dar errado está em
`ensureClientFolder` (totalmente coberto pelos testes acima). Se aparecer regressão na
camada de rota, abrir PR separado para extrair o handler + adicionar `supertest`.

## 12. Segurança

- **Sem novo endpoint, sem novo campo de request, sem mudança de schema.** Superfície de
  ataque idêntica.
- **`_Sem-Pasta` herda permissões do shared drive `Drive Clientes DPG`** — quem já vê
  relatórios continua vendo. Não há mudança de ACL.
- **`warning` é template pt-BR que interpola apenas o `clientSearchName`** — valor
  controlado pelo próprio usuário humano logado (vem do form). Sem risco de leak de
  dados internos.
- **`pino.redact`** já cobre `Authorization`/`cookie` (PR #5). Os logs novos
  (`folder fallback usado para cliente X`) não tocam segredos.
- **Auditoria:** `searchLog` continua gravando o termo buscado e quem buscou; `Report`
  continua gravando `generatedByEmail`. Rastreabilidade preservada.

## 13. Critérios de aceite

1. POST `/reports` com cliente cuja pasta existe → comportamento atual idêntico.
2. POST `/reports` com cliente cuja pasta NÃO existe → 200 com `webViewLink` válido,
   `driveLocation: "pending"`, `warning` em pt-BR.
3. Arquivo está fisicamente em `Drive Clientes DPG / _Sem-Pasta / <ano>/` no caso de
   fallback.
4. `Report` no Postgres em ambos os casos.
5. Frontend mostra banner amarelo com o `warning` quando `driveLocation === 'pending'`.
6. `npm run check` (lint + typecheck + test + build) verde.
