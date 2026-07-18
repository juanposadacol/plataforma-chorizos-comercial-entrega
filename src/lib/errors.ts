export class AppError extends Error {
  constructor(
    message: string,
    public readonly code = 'APP_ERROR',
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const getErrorMessage = (error: unknown): string => {
  if (error instanceof AppError || error instanceof Error) return error.message;
  return 'Ocurrió un error inesperado. Intenta de nuevo.';
};
