import { describe, it, expect } from 'vitest';

import { shouldOmitSection, filterRecordsByClient } from './reportService.js';
import type { MessageRecord } from './chatService.js';

// MessageRecord minimo. `type` ('HUMAN' | 'BOT') controla a classificacao de bot
// do corte forte: bot que nao cita o cliente e descartado; humano e preservado.
function rec(text: string, type: 'HUMAN' | 'BOT' = 'HUMAN'): MessageRecord {
  return {
    space: { name: 'spaces/AAA', displayName: 'Espaco Cliente' },
    message: {
      name: 'spaces/AAA/messages/1',
      text,
      createTime: '2026-01-01T09:00:00Z',
      sender: { name: 'users/1', displayName: 'Fulano', type }
    }
  };
}

describe('shouldOmitSection — omitir secoes descritivas vazias (v2 secao 4.5)', () => {
  // Descritivas: somem quando vazias.
  it('omite DADOS DE ACESSO com marcador vazio da IA', () => {
    expect(shouldOmitSection('DADOS DE ACESSO', 'Nenhum dado de acesso compartilhado no periodo.')).toBe(true);
  });

  it('omite DADOS CRITICOS com marcador vazio', () => {
    expect(shouldOmitSection('DADOS CRITICOS', 'Nenhum dado critico identificado.')).toBe(true);
  });

  it('omite descritiva com conteudo totalmente vazio', () => {
    expect(shouldOmitSection('DADOS DE ACESSO', '   \n ')).toBe(true);
  });

  it('tolera acento e caixa no titulo', () => {
    expect(shouldOmitSection('Dados Críticos', 'Nenhum dado critico identificado.')).toBe(true);
  });

  it('MANTEM descritiva quando ha conteudo real', () => {
    expect(shouldOmitSection('DADOS DE ACESSO', '- Cliente: X\n  Login: y\n  Senha: z')).toBe(false);
  });

  // Risco: sempre aparecem, mesmo vazias (nao mascarar busca-falha).
  it('NUNCA omite PRINCIPAIS GARGALOS mesmo vazio', () => {
    expect(shouldOmitSection('PRINCIPAIS GARGALOS', 'Nenhum gargalo recorrente identificado no periodo.')).toBe(false);
  });

  it('NUNCA omite PENDENCIAS mesmo vazio', () => {
    expect(shouldOmitSection('PENDENCIAS', 'Nenhuma pendencia.')).toBe(false);
  });

  it('NUNCA omite CRONOGRAMA mesmo vazio', () => {
    expect(shouldOmitSection('CRONOGRAMA', '')).toBe(false);
  });

  it('NUNCA omite RESUMO EXECUTIVO', () => {
    expect(shouldOmitSection('RESUMO EXECUTIVO', 'qualquer coisa')).toBe(false);
  });
});

describe('filterRecordsByClient — corte forte NA FONTE (IA + PDF)', () => {
  it('descarta mensagem de BOT que nao cita o cliente', () => {
    const recs = [rec('Atencao, chamados atrasados:\n• Cod.: OUT | Cliente: OUTRO | Protocolo: 9', 'BOT')];
    expect(filterRecordsByClient(recs, { name: 'Cescon' })).toEqual([]);
  });

  it('preserva conversa HUMANA sem citar o cliente (contexto)', () => {
    const recs = [rec('Sim, ja fiz isso ontem.', 'HUMAN')];
    expect(filterRecordsByClient(recs, { name: 'Cescon' })).toEqual(recs);
  });

  it('mensagem HUMANA sem nome resolvido (tipo HUMAN) NAO e tratada como bot', () => {
    // Mesmo que caia no rotulo "<grupo> - Automatica", o tipo HUMAN a preserva.
    const recs = [rec('nós temos acesso a essa página?', 'HUMAN')];
    expect(filterRecordsByClient(recs, { name: 'Cescon' })).toEqual(recs);
  });

  it('num despejo, mantem so a linha do cliente + marcador', () => {
    const recs = [
      rec(
        'Seguem protocolos:\n' +
          'Cod.: RIC624GO | Cliente: CESCON GESTAO CONTABIL | Protocolo: 1\n' +
          'Cod.: X | Cliente: OUTRO | Protocolo: 2'
      )
    ];
    const out = filterRecordsByClient(recs, { name: 'Cescon' });
    expect(out).toHaveLength(1);
    expect(out[0]!.message.text).toBe(
      'Seguem protocolos:\n' +
        'Cod.: RIC624GO | Cliente: CESCON GESTAO CONTABIL | Protocolo: 1\n' +
        '(... +1 linha de outro cliente omitida)'
    );
  });

  it('deduplica protocolo do cliente repetido entre mensagens; a 2a vira casca e cai', () => {
    const linha = '• Cod.: RIC624GO | Cliente: CESCON GESTAO CONTABIL | Protocolo: 012713';
    const recs = [rec('Atencao:\n' + linha, 'BOT'), rec('Atencao:\n' + linha, 'BOT')];
    const out = filterRecordsByClient(recs, { name: 'Cescon' });
    expect(out).toHaveLength(1);
    expect(out[0]!.message.text).toContain('RIC624GO');
  });

  it('bloco-lista de nomes (roster): mantem so a linha do cliente + marcador', () => {
    const nomes = [
      'ADCON ADM CONTABIL',
      'AGILIZA',
      'ALBATROZ CONTABIL',
      'NET WORTH',
      'Grupo DPG',
      'CESCON GESTAO CONTABIL',
      'FENIX CONTABILIDADE',
      'SOMUS CONTABILIDADE',
      'PETLOVE'
    ];
    const recs = [rec('Algum desses clientes esta ativo em midias?\n' + nomes.join('\n'))];
    const out = filterRecordsByClient(recs, { name: 'Cescon' });
    expect(out[0]!.message.text).toBe(
      'Algum desses clientes esta ativo em midias?\n' +
        'CESCON GESTAO CONTABIL\n' +
        '(... +8 linhas de outros clientes omitidas)'
    );
  });

  it('conversa humana curta com nomes soltos nao vira roster', () => {
    const recs = [rec('Rafa\nO post da Cescon de hoje:\nInstagram')];
    const out = filterRecordsByClient(recs, { name: 'Cescon' });
    expect(out[0]!.message.text).toBe('Rafa\nO post da Cescon de hoje:\nInstagram');
  });

  it('remove linha "Teste" isolada da mensagem', () => {
    const recs = [rec('Cod.: RIC624GO | Cliente: CESCON | Protocolo: 1\nTeste')];
    const out = filterRecordsByClient(recs, { name: 'Cescon' });
    expect(out[0]!.message.text).toBe('Cod.: RIC624GO | Cliente: CESCON | Protocolo: 1');
  });

  it('casa a mensagem por CNPJ', () => {
    const recs = [rec('23.624.458/0001-17')];
    expect(filterRecordsByClient(recs, { cnpj: '23.624.458/0001-17' })).toHaveLength(1);
  });

  it('casa item de lista por @usuario do link', () => {
    const recs = [
      rec(
        '• Post do cliente @fenixcontabilidadesl atrasado | Protocolo: 1\n' +
          '• Post do cliente @outro atrasado | Protocolo: 2'
      )
    ];
    const out = filterRecordsByClient(recs, { link: 'https://www.instagram.com/fenixcontabilidadesl/' });
    expect(out[0]!.message.text).toBe(
      '• Post do cliente @fenixcontabilidadesl atrasado | Protocolo: 1\n' + '(... +1 linha de outro cliente omitida)'
    );
  });

  it('lista vazia -> vazia', () => {
    expect(filterRecordsByClient([], { name: 'Cescon' })).toEqual([]);
  });
});
