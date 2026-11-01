import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { contacts, users } from '../src/db/schema';
import { verifyPassword } from '../src/modules/auth/password';
import { createUser } from '../src/modules/users/service';
import { useTestDatabase } from './helpers/db';

const t = useTestDatabase();

describe('users', () => {
  it('creates a user with a hashed password and normalized email', async () => {
    const user = await createUser(t.get().db, {
      name: ' Admin KPP ',
      email: ' Admin@KPP.go.id ',
      password: 'rahasia-panjang-1',
      role: 'admin',
    });
    expect(user.email).toBe('admin@kpp.go.id');
    expect(user.name).toBe('Admin KPP');
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(user.passwordHash!, 'rahasia-panjang-1')).toBe(true);
    expect(await verifyPassword(user.passwordHash!, 'salah')).toBe(false);
  });

  it('rejects duplicate emails and weak passwords', async () => {
    const db = t.get().db;
    await createUser(db, { name: 'A', email: 'a@x.id', password: 'rahasia-panjang-1', role: 'agent' });
    await expect(
      createUser(db, { name: 'B', email: 'A@x.id', password: 'rahasia-panjang-1', role: 'agent' }),
    ).rejects.toMatchObject({ code: 'email_taken' });
    await expect(
      createUser(db, { name: 'C', email: 'c@x.id', password: 'pendek', role: 'agent' }),
    ).rejects.toMatchObject({ code: 'weak_password' });
    expect(await db.$count(users)).toBe(1);
  });

  it('stores JSON columns and UTC datetimes faithfully', async () => {
    const db = t.get().db;
    const seen = new Date('2026-11-01T07:30:15.123Z');
    await db.insert(contacts).values({ waId: '6281234567890', raw: { profile: { name: 'Budi 😀' } }, firstSeenAt: seen });
    const row = await db.query.contacts.findFirst({ where: eq(contacts.waId, '6281234567890') });
    expect(row?.raw).toEqual({ profile: { name: 'Budi 😀' } });
    expect(row?.firstSeenAt.toISOString()).toBe(seen.toISOString());
  });
});
