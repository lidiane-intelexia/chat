import { describe, it, expect } from 'vitest';

import { shouldOmitSection, filterTimelineByClient } from './reportService.js';
import type { TimelineEntry } from './messageProcessor.js';

function te(sender: string, text: string): TimelineEntry {
  return { time: '2026-01-01T09:00:00Z', sender, space: 'Espaco Cliente', text };
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

describe('filterTimelineByClient — corte forte NA FONTE (IA + PDF)', () => {
  it('descarta mensagem automatica que nao cita o cliente', () => {
    const tl = [
      te('Atrasados Time Caio - Automatica', 'Atencao, chamados atrasados:\n• Cod.: OUT | Cliente: OUTRO | Protocolo: 9')
    ];
    expect(filterTimelineByClient(tl, { name: 'Cescon' })).toEqual([]);
  });

  it('preserva conversa humana sem citar o cliente (contexto)', () => {
    const tl = [te('Lidiane de Souza Mendes', 'Sim, ja fiz isso ontem.')];
    expect(filterTimelineByClient(tl, { name: 'Cescon' })).toEqual(tl);
  });

  it('num despejo, mantem so a linha do cliente + marcador', () => {
    const tl = [
      te(
        'Lidiane de Souza Mendes',
        'Seguem protocolos:\n' +
          'Cod.: RIC624GO | Cliente: CESCON GESTAO CONTABIL | Protocolo: 1\n' +
          'Cod.: X | Cliente: OUTRO | Protocolo: 2'
      )
    ];
    const out = filterTimelineByClient(tl, { name: 'Cescon' });
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe(
      'Seguem protocolos:\n' +
        'Cod.: RIC624GO | Cliente: CESCON GESTAO CONTABIL | Protocolo: 1\n' +
        '(... +1 linha de outro cliente omitida)'
    );
  });

  it('deduplica protocolo do cliente repetido entre mensagens; a 2a vira casca e cai', () => {
    const linha = '• Cod.: RIC624GO | Cliente: CESCON GESTAO CONTABIL | Protocolo: 012713';
    const tl = [
      te('Atrasados Time Caio - Automatica', 'Atencao:\n' + linha),
      te('Atrasados Time Caio - Automatica', 'Atencao:\n' + linha)
    ];
    const out = filterTimelineByClient(tl, { name: 'Cescon' });
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toContain('RIC624GO');
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
    const tl = [te('Bruno Maurus', 'Algum desses clientes esta ativo em midias?\n' + nomes.join('\n'))];
    const out = filterTimelineByClient(tl, { name: 'Cescon' });
    expect(out[0]!.text).toBe(
      'Algum desses clientes esta ativo em midias?\n' +
        'CESCON GESTAO CONTABIL\n' +
        '(... +8 linhas de outros clientes omitidas)'
    );
  });

  it('conversa humana curta com nomes soltos nao vira roster', () => {
    const tl = [te('Lidiane de Souza Mendes', 'Rafa\nO post da Cescon de hoje:\nInstagram')];
    const out = filterTimelineByClient(tl, { name: 'Cescon' });
    expect(out[0]!.text).toBe('Rafa\nO post da Cescon de hoje:\nInstagram');
  });

  it('remove linha "Teste" isolada da mensagem', () => {
    const tl = [te('Lidiane de Souza Mendes', 'Cod.: RIC624GO | Cliente: CESCON | Protocolo: 1\nTeste')];
    const out = filterTimelineByClient(tl, { name: 'Cescon' });
    expect(out[0]!.text).toBe('Cod.: RIC624GO | Cliente: CESCON | Protocolo: 1');
  });

  it('casa a mensagem por CNPJ', () => {
    const tl = [te('Lidiane de Souza Mendes', '23.624.458/0001-17')];
    expect(filterTimelineByClient(tl, { cnpj: '23.624.458/0001-17' })).toHaveLength(1);
  });

  it('casa item de lista por @usuario do link', () => {
    const tl = [
      te(
        'Lidiane de Souza Mendes',
        '• Post do cliente @fenixcontabilidadesl atrasado | Protocolo: 1\n' +
          '• Post do cliente @outro atrasado | Protocolo: 2'
      )
    ];
    const out = filterTimelineByClient(tl, { link: 'https://www.instagram.com/fenixcontabilidadesl/' });
    expect(out[0]!.text).toBe(
      '• Post do cliente @fenixcontabilidadesl atrasado | Protocolo: 1\n' + '(... +1 linha de outro cliente omitida)'
    );
  });

  it('timeline vazia -> vazia', () => {
    expect(filterTimelineByClient([], { name: 'Cescon' })).toEqual([]);
  });
});
