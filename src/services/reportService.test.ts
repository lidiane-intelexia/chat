import { describe, it, expect } from 'vitest';

import { shouldOmitSection, cleanRawLog, filterRawLogStrong } from './reportService.js';

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

describe('filterRawLogStrong — corte forte por cliente (v2 nivel 1)', () => {
  it('mantem a linha de cabecalho [data] [remetente]:', () => {
    const input = '[21/11/2025 08:10:46] [Lidiane]: Bom dia';
    expect(filterRawLogStrong(input, { name: 'Fenix' })).toBe(input);
  });

  it('descarta protocolo de OUTRO cliente e mantem o do cliente-alvo (por nome)', () => {
    const input =
      'Cod.: FEN588SP | Cliente: FENIX ASSESSORIA CONTABIL | Protocolo: 100916.2420c2\n' +
      'Cod.: EXE403ES | Cliente: EXECUTA CONTABILIDADE | Protocolo: 251112.100414';
    expect(filterRawLogStrong(input, { name: 'Fenix' })).toBe(
      'Cod.: FEN588SP | Cliente: FENIX ASSESSORIA CONTABIL | Protocolo: 100916.2420c2\n' +
        '(... +1 linha de outro cliente omitida)'
    );
  });

  it('mantem item de lista que casa por CNPJ e descarta os demais', () => {
    const input =
      '- Protocolo: Cod.: X | 29.280.197/0001-41 | Protocolo: 1\n' +
      '- Protocolo: Cod.: Y | 11.111.111/0001-11 | Protocolo: 2';
    expect(filterRawLogStrong(input, { cnpj: '29.280.197/0001-41' })).toBe(
      '- Protocolo: Cod.: X | 29.280.197/0001-41 | Protocolo: 1\n' +
        '(... +1 linha de outro cliente omitida)'
    );
  });

  it('nas listas de tarefas com bullet, mantem so a do cliente', () => {
    const input =
      '• *Criacao de Imagens* — _FENIX CONTABILIDADE_ · em atraso\n' +
      '• *Edicao de Video* — _REVICONT REVISORA CONTABIL_ · em atraso';
    expect(filterRawLogStrong(input, { name: 'Fenix' })).toBe(
      '• *Criacao de Imagens* — _FENIX CONTABILIDADE_ · em atraso\n' +
        '(... +1 linha de outro cliente omitida)'
    );
  });

  it('mantem conversa humana (prosa) mesmo sem citar o cliente', () => {
    const input = 'Ontem eu criei o planejamento\nSolicito para que de sequencia a eles.';
    expect(filterRawLogStrong(input, { name: 'ZZZZZ' })).toBe(input);
  });

  it('mantem o bloco "Log de Publicacoes" inteiro (campos com "-" nao sao dump)', () => {
    const input =
      '[04/03/2026 10:29:23] [Log de Publicacoes Busca Post - Automatica]: \n' +
      '- CLIENTE: FENIX CONTABILIDADE LTDA\n' +
      '- CNPJ/CPF: 29.280.197/0001-41\n' +
      '- ID do BD: 47615\n' +
      'Link da publicacao: https://www.instagram.com/p/DVdtdZgipXk/';
    expect(filterRawLogStrong(input, { name: 'Fenix' })).toBe(input);
  });

  it('casa item de lista por @usuario do link', () => {
    const input =
      '• Post do cliente @fenixcontabilidadesl atrasado | Protocolo: 1\n' +
      '• Post do cliente @outro atrasado | Protocolo: 2';
    expect(filterRawLogStrong(input, { link: 'https://www.instagram.com/fenixcontabilidadesl/' })).toBe(
      '• Post do cliente @fenixcontabilidadesl atrasado | Protocolo: 1\n' +
        '(... +1 linha de outro cliente omitida)'
    );
  });

  it('log vazio -> vazio', () => {
    expect(filterRawLogStrong('', { name: 'Fenix' })).toBe('');
  });

  it('anti-orfao: remove bloco de bot INTEIRO quando nao cita o cliente', () => {
    const input =
      '[13/02/2026 14:05:02] [Atrasados Time Caio - Automatica]: Atencao, chamados atrasados:\n' +
      '• Cod.: OUT | Cliente: OUTRO CLIENTE | Protocolo: 9';
    expect(filterRawLogStrong(input, { name: 'Cescon' })).toBe('');
  });

  it('mantem bloco de bot que cita o cliente (so a linha dele)', () => {
    const input =
      '[12/02/2026 16:29:20] [Atrasados Time Caio - Automatica]: Atencao:\n' +
      '• Cod.: RIC624GO | Cliente: CESCON GESTAO CONTABIL | Protocolo: 1\n' +
      '• Cod.: OUT | Cliente: OUTRO | Protocolo: 2';
    expect(filterRawLogStrong(input, { name: 'Cescon' })).toBe(
      '[12/02/2026 16:29:20] [Atrasados Time Caio - Automatica]: Atencao:\n' +
        '• Cod.: RIC624GO | Cliente: CESCON GESTAO CONTABIL | Protocolo: 1\n' +
        '(... +1 linha de outro cliente omitida)'
    );
  });

  it('preserva conversa humana mesmo sem citar o cliente (nao e orfao)', () => {
    const input = '[16/03/2026 09:42:18] [Lidiane de Souza Mendes]: Sim, ja fiz isso ontem.';
    expect(filterRawLogStrong(input, { name: 'Cescon' })).toBe(input);
  });

  it('bloco-lista de nomes: mantem cabecalho + so a linha do cliente', () => {
    const names = [
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
    const input =
      '[16/04/2026 14:52:24] [Bruno Maurus]: Algum desses clientes esta ativo em midias\n' + names.join('\n');
    expect(filterRawLogStrong(input, { name: 'Cescon' })).toBe(
      '[16/04/2026 14:52:24] [Bruno Maurus]: Algum desses clientes esta ativo em midias\n' +
        'CESCON GESTAO CONTABIL\n' +
        '(... +8 linhas de outros clientes omitidas)'
    );
  });

  it('NAO trata conversa humana curta (poucos nomes) como roster', () => {
    const input =
      '[20/04/2026 14:31:57] [Lidiane de Souza Mendes]: Rafa\n' +
      'O post da Cescon de hoje:\n' +
      'Instagram';
    expect(filterRawLogStrong(input, { name: 'Cescon' })).toBe(input);
  });
});
