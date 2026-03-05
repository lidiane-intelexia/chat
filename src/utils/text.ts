const DIACRITICS_REGEX = /\p{Diacritic}/gu;
const NON_WORD_REGEX = /[^a-z0-9@.\s-]/gi;
const MULTI_SPACE_REGEX = /\s+/g;

export function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(DIACRITICS_REGEX, '')
    .replace(NON_WORD_REGEX, ' ')
    .replace(MULTI_SPACE_REGEX, ' ')
    .trim()
    .toLowerCase();
}

export function digitsOnly(value: string) {
  return value.replace(/\D+/g, '');
}

export function toRFC3339(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}

export const STOPWORDS_PT = new Set([
  'a', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'para', 'por',
  'com', 'na', 'no', 'nas', 'nos', 'um', 'uma', 'uns', 'umas', 'que', 'se',
  'ao', 'aos', 'à', 'às', 'como', 'mais', 'menos', 'já', 'não', 'sim', 'sua',
  'seu', 'suas', 'seus', 'nosso', 'nossa', 'nossos', 'nossas', 'também', 'ainda',
  'ser', 'ter', 'fica', 'ficar', 'está', 'estao', 'estamos', 'foi', 'era', 'sao',
  'pra', 'pro', 'sobre', 'entre', 'sem', 'ou', 'até', 'ate', 'essa', 'esse',
  'isso', 'isto', 'aquele', 'aquela', 'aquilo', 'ele', 'ela', 'eles', 'elas'
]);

export function tokenize(value: string) {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  return normalized.split(' ').filter((token) => token.length > 2);
}


// ! Alerta (Vermelho): Use para partes críticas, como o tratamento de erros ou onde as credenciais OAuth são manipuladas.
// ? Dúvida (Azul): Use quando estiver tentando entender uma lógica do Codex, como a busca por similaridade textual.
// TODO Tarefa (Laranja): Use para o que falta fazer, como a subpasta por ano no Drive.
// * Destaque (Verde): Use para explicar funcionalidades que já estão prontas e funcionando.
// (sem nada) ou //// Riscado (Cinza): Use para códigos que você desativou temporariamente.