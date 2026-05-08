import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks de googleapis sao hoisted via vi.hoisted para estarem prontos quando
// vi.mock for executado (vi.mock e hoisted antes dos imports).
const { mockDrivesList, mockFilesList, mockFilesCreate } = vi.hoisted(() => ({
  mockDrivesList: vi.fn(),
  mockFilesList: vi.fn(),
  mockFilesCreate: vi.fn()
}));

vi.mock('googleapis', () => ({
  google: {
    drive: vi.fn(() => ({
      drives: { list: mockDrivesList },
      files: { list: mockFilesList, create: mockFilesCreate }
    }))
  }
}));

import { ensureClientFolder, normalizeName } from './driveService.js';

// Auth real nao e usado: google.drive() esta mockado e ignora o argumento.
const fakeAuth = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('normalizeName', () => {
  it('lowercase + remove acentos', () => {
    expect(normalizeName('Relatórios')).toBe('relatorios');
  });

  it('remove prefixo numerico no formato "01 - X"', () => {
    expect(normalizeName('01 - Cliente X')).toBe('cliente x');
  });

  it('remove caracteres especiais e colapsa espacos', () => {
    expect(normalizeName('  ACME!! LTDA / DPG  ')).toBe('acme ltda dpg');
  });
});

describe('ensureClientFolder — pasta do cliente encontrada', () => {
  it('retorna yearFolderId e location=client quando match exato', async () => {
    mockDrivesList.mockResolvedValueOnce({
      data: { drives: [{ id: 'drive-1', name: 'Drive Clientes DPG' }] }
    });
    // Sequencia esperada de files.list:
    // 1) raiz do drive — busca da pasta do cliente
    // 2) dentro do cliente — "Relacionamento com Cliente"
    // 3) dentro de Relacionamento — "Relatórios"
    // 4) dentro de Relatórios — "<ano>"
    mockFilesList
      .mockResolvedValueOnce({ data: { files: [{ id: 'cli-1', name: 'Cliente X' }] } })
      .mockResolvedValueOnce({ data: { files: [{ id: 'rc-1', name: 'Relacionamento com Cliente' }] } })
      .mockResolvedValueOnce({ data: { files: [{ id: 'rel-1', name: 'Relatórios' }] } })
      .mockResolvedValueOnce({ data: { files: [{ id: 'year-1', name: '2026' }] } });

    const result = await ensureClientFolder(fakeAuth, 'Cliente X', 2026);

    expect(result).toEqual({ yearFolderId: 'year-1', location: 'client' });
    // Caminho feliz nao deve criar nenhuma pasta
    expect(mockFilesCreate).not.toHaveBeenCalled();
  });

  it('aceita match fuzzy (prefixo numerico no nome da pasta)', async () => {
    mockDrivesList.mockResolvedValueOnce({
      data: { drives: [{ id: 'drive-1', name: 'Drive Clientes DPG' }] }
    });
    mockFilesList
      .mockResolvedValueOnce({ data: { files: [{ id: 'cli-fuzzy', name: '01 - Cliente X LTDA' }] } })
      .mockResolvedValueOnce({ data: { files: [{ id: 'rc-1', name: 'Relacionamento com Cliente' }] } })
      .mockResolvedValueOnce({ data: { files: [{ id: 'rel-1', name: 'Relatórios' }] } })
      .mockResolvedValueOnce({ data: { files: [{ id: 'year-1', name: '2026' }] } });

    const result = await ensureClientFolder(fakeAuth, 'Cliente X', 2026);

    expect(result.location).toBe('client');
    expect(result.yearFolderId).toBe('year-1');
  });
});

describe('ensureClientFolder — pasta do cliente NAO encontrada (fallback _Sem-Pasta)', () => {
  it('cai em _Sem-Pasta/<ano> e retorna location=pending sem lancar', async () => {
    mockDrivesList.mockResolvedValueOnce({
      data: { drives: [{ id: 'drive-1', name: 'Drive Clientes DPG' }] }
    });
    // Sequencia esperada de files.list no fallback:
    // 1) raiz do drive — busca cliente, retorna apenas pastas que nao casam
    // 2) raiz do drive — busca _Sem-Pasta (existente)
    // 3) dentro de _Sem-Pasta — busca <ano>
    mockFilesList
      .mockResolvedValueOnce({ data: { files: [{ id: 'outro', name: 'Outro Cliente' }] } })
      .mockResolvedValueOnce({ data: { files: [{ id: 'sp-1', name: '_Sem-Pasta' }] } })
      .mockResolvedValueOnce({ data: { files: [{ id: 'year-fb', name: '2026' }] } });

    const result = await ensureClientFolder(fakeAuth, 'Cliente Que Nao Existe', 2026);

    expect(result).toEqual({ yearFolderId: 'year-fb', location: 'pending' });
    // _Sem-Pasta ja existia, ano ja existia — nada criado
    expect(mockFilesCreate).not.toHaveBeenCalled();
  });

  it('auto-cria _Sem-Pasta na raiz do drive quando ainda nao existe', async () => {
    mockDrivesList.mockResolvedValueOnce({
      data: { drives: [{ id: 'drive-1', name: 'Drive Clientes DPG' }] }
    });
    mockFilesList
      .mockResolvedValueOnce({ data: { files: [] } })   // cliente nao encontrado
      .mockResolvedValueOnce({ data: { files: [] } })   // _Sem-Pasta nao existe
      .mockResolvedValueOnce({ data: { files: [] } });  // ano dentro do _Sem-Pasta novo nao existe
    mockFilesCreate
      .mockResolvedValueOnce({ data: { id: 'sp-novo' } })       // cria _Sem-Pasta
      .mockResolvedValueOnce({ data: { id: 'year-novo' } });    // cria <ano>

    const result = await ensureClientFolder(fakeAuth, 'Novo Cliente', 2026);

    expect(result).toEqual({ yearFolderId: 'year-novo', location: 'pending' });
    expect(mockFilesCreate).toHaveBeenCalledTimes(2);
    expect(mockFilesCreate).toHaveBeenNthCalledWith(1, expect.objectContaining({
      requestBody: expect.objectContaining({
        name: '_Sem-Pasta',
        mimeType: 'application/vnd.google-apps.folder',
        parents: ['drive-1']
      })
    }));
    expect(mockFilesCreate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      requestBody: expect.objectContaining({
        name: '2026',
        mimeType: 'application/vnd.google-apps.folder',
        parents: ['sp-novo']
      })
    }));
  });

  it('NUNCA auto-cria a pasta do cliente em fallback', async () => {
    mockDrivesList.mockResolvedValueOnce({
      data: { drives: [{ id: 'drive-1', name: 'Drive Clientes DPG' }] }
    });
    mockFilesList
      .mockResolvedValueOnce({ data: { files: [] } })   // cliente nao encontrado
      .mockResolvedValueOnce({ data: { files: [{ id: 'sp', name: '_Sem-Pasta' }] } })
      .mockResolvedValueOnce({ data: { files: [{ id: 'y', name: '2026' }] } });

    await ensureClientFolder(fakeAuth, 'Cliente Inexistente', 2026);

    // Nenhuma chamada de criacao deve usar o nome do cliente como name
    const createdNames = mockFilesCreate.mock.calls.map(
      (call) => (call[0] as { requestBody?: { name?: string } }).requestBody?.name
    );
    expect(createdNames).not.toContain('Cliente Inexistente');
  });
});
