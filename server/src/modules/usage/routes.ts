import type { AppInstance } from '../../types';
import { requireUserHook } from '../auth/plugin';
import { computeUsage } from './service';

/** Kuota pesan service gratis bulan ini; dibaca semua petugas (ditampilkan di daftar chat). */
export async function usageRoutes(app: AppInstance) {
  app.addHook('preValidation', requireUserHook);
  app.get('/', async () => computeUsage(app.deps));
}
