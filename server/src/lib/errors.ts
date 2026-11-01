// Error yang aman ditampilkan ke pengguna: status HTTP, kode mesin, dan pesan bahasa Indonesia.
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what = 'Data') => new AppError(404, 'not_found', `${what} tidak ditemukan.`);
export const forbidden = () => new AppError(403, 'forbidden', 'Anda tidak punya akses untuk tindakan ini.');
export const unauthorized = () => new AppError(401, 'unauthorized', 'Silakan masuk terlebih dahulu.');
