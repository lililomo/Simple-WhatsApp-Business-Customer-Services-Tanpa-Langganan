import type { UserDTO } from '@wa/shared';
import type { UserRow } from './service';

export function toUserDTO(u: UserRow): UserDTO {
  return {
    id: String(u.id),
    name: u.name,
    email: u.email,
    nip: u.nip,
    seksi: u.seksi,
    authSource: u.authSource,
    role: u.role,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}
