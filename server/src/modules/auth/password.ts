import { hash, verify } from '@node-rs/argon2';

// Bawaan @node-rs/argon2 adalah argon2id.
export function hashPassword(password: string): Promise<string> {
  return hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password).catch(() => false);
}

export const PASSWORD_MIN_LENGTH = 10;
