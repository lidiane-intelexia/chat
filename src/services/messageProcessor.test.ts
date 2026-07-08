import { describe, it, expect } from 'vitest';

import { sanitizeMessages, buildReportData } from './messageProcessor.js';
import type { MessageRecord } from './chatService.js';

/**
 * Helper para montar um MessageRecord minimo. `text = null` representa
 * mensagem sem texto (ex.: anexo/arquivo compartilhado).
 */
function rec(text: string | null, createTime = '2026-01-01T09:00:00Z', name = 'spaces/AAA/messages/1'): MessageRecord {
  return {
    space: { name: 'spaces/AAA', displayName: 'Espaco Cliente' },
    message: { name, text, createTime, sender: { name: 'users/1', displayName: 'Fulano' } }
  };
}

describe('sanitizeMessages — dropTestOnly', () => {
  it('descarta mensagem que e exatamente "Teste"', () => {
    const { records, stats } = sanitizeMessages([rec('Teste')]);
    expect(records).toHaveLength(0);
    expect(stats.droppedTestOnly).toBe(1);
  });

  it('descarta variacoes "Teste " (espaco) e "TESTES" (plural/caixa)', () => {
    const { records, stats } = sanitizeMessages([rec('Teste '), rec('TESTES')]);
    expect(records).toHaveLength(0);
    expect(stats.droppedTestOnly).toBe(2);
  });

  it('MANTEM mensagem que apenas contem "teste" dentro de conversa real', () => {
    const { records, stats } = sanitizeMessages([rec('Teste de mesa aprovado pelo cliente')]);
    expect(records).toHaveLength(1);
    expect(stats.droppedTestOnly).toBe(0);
  });

  it('nao descarta mensagem sem texto (anexo carrega sinal)', () => {
    const { records, stats } = sanitizeMessages([rec(null)]);
    expect(records).toHaveLength(1);
    expect(stats.droppedTestOnly).toBe(0);
  });
});

describe('sanitizeMessages — dedupExact', () => {
  it('5 mensagens de texto identico -> resta 1 (a primeira, preservando createTime)', () => {
    const input = [
      rec('Protocolo 123 em atraso', '2026-01-01T09:00:00Z'),
      rec('Protocolo 123 em atraso', '2026-01-02T09:00:00Z'),
      rec('Protocolo 123 em atraso', '2026-01-03T09:00:00Z'),
      rec('Protocolo 123 em atraso', '2026-01-04T09:00:00Z'),
      rec('Protocolo 123 em atraso', '2026-01-05T09:00:00Z')
    ];
    const { records, stats } = sanitizeMessages(input);
    expect(records).toHaveLength(1);
    expect(records[0].message.createTime).toBe('2026-01-01T09:00:00Z');
    expect(stats.droppedDuplicate).toBe(4);
  });

  it('mesmo protocolo reenviado em 2 datas com texto identico -> resta 1', () => {
    const input = [
      rec('Protocolo 999 pendente', '2026-01-01T09:00:00Z'),
      rec('Protocolo 999 pendente', '2026-02-01T09:00:00Z')
    ];
    const { records } = sanitizeMessages(input);
    expect(records).toHaveLength(1);
  });

  it('dois textos diferentes -> ambos mantidos', () => {
    const { records, stats } = sanitizeMessages([rec('Bom dia'), rec('Segue o orcamento')]);
    expect(records).toHaveLength(2);
    expect(stats.droppedDuplicate).toBe(0);
  });

  it('mensagens sem texto NUNCA sao deduplicadas (10 anexos = 10)', () => {
    const input = Array.from({ length: 10 }, (_, i) => rec(null, `2026-01-0${(i % 9) + 1}T09:00:00Z`));
    const { records, stats } = sanitizeMessages(input);
    expect(records).toHaveLength(10);
    expect(stats.droppedDuplicate).toBe(0);
  });

  it('normaliza acento/unicode e espacos multiplos antes de deduplicar', () => {
    const { records } = sanitizeMessages([rec('Relatório   enviado'), rec('relatorio enviado')]);
    expect(records).toHaveLength(1);
  });
});

describe('sanitizeMessages — stats e edge cases', () => {
  it('stats batem com a entrada (input/dropped/output)', () => {
    const input = [
      rec('Teste'),
      rec('Ola cliente'),
      rec('Ola cliente'),
      rec(null)
    ];
    const { records, stats } = sanitizeMessages(input);
    expect(stats.input).toBe(4);
    expect(stats.droppedTestOnly).toBe(1);
    expect(stats.droppedDuplicate).toBe(1);
    expect(stats.output).toBe(2);
    expect(records).toHaveLength(2);
  });

  it('array vazio -> records vazio e stats zerados', () => {
    const { records, stats } = sanitizeMessages([]);
    expect(records).toEqual([]);
    expect(stats).toEqual({ input: 0, droppedTestOnly: 0, droppedDuplicate: 0, output: 0 });
  });
});

describe('integracao leve — sanitize reduz a timeline', () => {
  it('buildReportData sobre records limpos tem timeline menor que sobre os crus', () => {
    const noisy = [
      rec('Teste'),
      rec('Teste'),
      rec('Protocolo 123 em atraso', '2026-01-01T09:00:00Z'),
      rec('Protocolo 123 em atraso', '2026-01-02T09:00:00Z'),
      rec('Reuniao marcada para sexta')
    ];
    const query = { name: 'Fenix' };
    const cru = buildReportData(noisy, query);
    const limpo = buildReportData(sanitizeMessages(noisy).records, query);
    expect(limpo.timeline.length).toBeLessThan(cru.timeline.length);
    expect(limpo.timeline.length).toBe(2);
  });
});
