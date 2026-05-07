export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly safeMessage: string,
    options?: { cause?: unknown }
  ) {
    super(safeMessage, options);
    this.name = 'AppError';
  }
}
