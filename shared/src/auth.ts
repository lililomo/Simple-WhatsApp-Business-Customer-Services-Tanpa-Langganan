import { z } from 'zod';

export const PASSWORD_MIN = 10;

export const roleSchema = z.enum(['admin', 'agent']);
export type Role = z.infer<typeof roleSchema>;

export interface UserDTO {
  id: string;
  name: string;
  /** Hanya akun lokal (login darurat); pegawai portal dikenali lewat NIP. */
  email: string | null;
  nip: string | null;
  seksi: string | null;
  authSource: 'local' | 'portal';
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export const loginBody = z.object({
  email: z.string().trim().min(1, 'Email wajib diisi'),
  password: z.string().min(1, 'Password wajib diisi'),
});

export const changePasswordBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(PASSWORD_MIN, `Password minimal ${PASSWORD_MIN} karakter`),
});

export const createUserBody = z.object({
  name: z.string().trim().min(1, 'Nama wajib diisi').max(120),
  email: z.email('Email tidak valid').max(190),
  password: z.string().min(PASSWORD_MIN, `Password minimal ${PASSWORD_MIN} karakter`),
  role: roleSchema,
});

export const updateUserBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: roleSchema.optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(PASSWORD_MIN, `Password minimal ${PASSWORD_MIN} karakter`).optional(),
});

export interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}
