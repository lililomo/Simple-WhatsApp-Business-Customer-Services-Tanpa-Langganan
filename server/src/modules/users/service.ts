import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { sessions, users } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { hashPassword, PASSWORD_MIN_LENGTH } from '../auth/password';

export type UserRow = typeof users.$inferSelect;
export type Role = UserRow['role'];

export interface NewUser {
  name: string;
  email: string;
  password: string;
  role: Role;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function assertPasswordStrength(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new AppError(400, 'weak_password', `Password minimal ${PASSWORD_MIN_LENGTH} karakter.`);
  }
}

export async function createUser(db: Db, input: NewUser): Promise<UserRow> {
  assertPasswordStrength(input.password);
  const email = normalizeEmail(input.email);
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) throw new AppError(409, 'email_taken', 'Email sudah dipakai pengguna lain.');
  const [res] = await db.insert(users).values({
    name: input.name.trim(),
    email,
    passwordHash: await hashPassword(input.password),
    role: input.role,
  });
  const user = await db.query.users.findFirst({ where: eq(users.id, res.insertId) });
  return user!;
}

export async function setPassword(db: Db, userId: number, password: string): Promise<void> {
  assertPasswordStrength(password);
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(users.id, userId));
}

export async function revokeAllSessions(db: Db, userId: number): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}
