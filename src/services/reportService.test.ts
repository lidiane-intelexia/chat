import { describe, it, expect } from 'vitest';

import { shouldOmitSection } from './reportService.js';

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
