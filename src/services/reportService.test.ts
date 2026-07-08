import { describe, it, expect } from 'vitest';

import { shouldOmitSection, cleanRawLog } from './reportService.js';

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

describe('cleanRawLog — limpa o log bruto inline (v2 opcao B)', () => {
  it('remove linhas "Teste" isoladas', () => {
    const input = 'Cod.: X | Protocolo: 1\nTeste\nCod.: Y | Protocolo: 2';
    expect(cleanRawLog(input)).toBe('Cod.: X | Protocolo: 1\nCod.: Y | Protocolo: 2');
  });

  it('remove "Testes"/variacoes de caixa e espaco', () => {
    expect(cleanRawLog('Teste \nTESTES\ntexto real')).toBe('texto real');
  });

  it('MANTEM linha que apenas contem "teste" dentro de conteudo real', () => {
    const line = 'Cod.: X | Cliente: Caio Teste | Protocolo: 1';
    expect(cleanRawLog(line)).toBe(line);
  });

  it('deduplica linhas de protocolo repetidas (mantem a primeira)', () => {
    const input = 'Cod.: X | Protocolo: 111\nCod.: X | Protocolo: 111\nCod.: X | Protocolo: 111';
    expect(cleanRawLog(input)).toBe('Cod.: X | Protocolo: 111');
  });

  it('mantem linhas de protocolo DIFERENTES', () => {
    const input = 'Cod.: X | Protocolo: 111\nCod.: Y | Protocolo: 222';
    expect(cleanRawLog(input)).toBe(input);
  });

  it('NAO deduplica linhas humanas repetidas (ex.: "ok")', () => {
    expect(cleanRawLog('ok\nok')).toBe('ok\nok');
  });

  it('preserva cabecalho [data] [sender]: e conversa real', () => {
    const input = '[21/11/2025 08:10:46] [Lidiane]: Bom dia\nCod.: X | Protocolo: 1\nTeste';
    expect(cleanRawLog(input)).toBe('[21/11/2025 08:10:46] [Lidiane]: Bom dia\nCod.: X | Protocolo: 1');
  });

  it('log vazio -> vazio', () => {
    expect(cleanRawLog('')).toBe('');
  });
});
