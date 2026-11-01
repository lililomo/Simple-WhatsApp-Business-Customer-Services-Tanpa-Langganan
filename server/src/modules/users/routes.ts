import { and, asc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { createUserBody, updateUserBody } from '@wa/shared';
import { users } from '../../db/schema';
import { AppError, notFound } from '../../lib/errors';
import type { AppInstance } from '../../types';
import { audit } from '../audit/service';
import { requireAdminHook, requireUser } from '../auth/plugin';
import { toUserDTO } from './dto';
import { createUser, revokeAllSessions, setPassword } from './service';

const idParams = z.object({ id: z.coerce.number().int().positive() });

export async function userRoutes(app: AppInstance) {
  const db = app.deps.database.db;
  app.addHook('preHandler', requireAdminHook);

  app.get('/', async () => {
    const rows = await db.select().from(users).orderBy(asc(users.name));
    return { users: rows.map(toUserDTO) };
  });

  app.post('/', { schema: { body: createUserBody } }, async (req, reply) => {
    requireUser(req);
    const user = await createUser(db, req.body);
    await audit(db, { actorUserId: req.user.id, action: 'user.create', targetType: 'user', targetId: user.id, ip: req.ip });
    return reply.status(201).send({ user: toUserDTO(user) });
  });

  app.patch('/:id', { schema: { params: idParams, body: updateUserBody } }, async (req) => {
    requireUser(req);
    const target = await db.query.users.findFirst({ where: eq(users.id, req.params.id) });
    if (!target) throw notFound('Pengguna');
    const { name, role, isActive, password } = req.body;

    // Jangan sampai tidak ada admin aktif yang tersisa.
    const losingAdmin = target.role === 'admin' && target.isActive && (role === 'agent' || isActive === false);
    if (losingAdmin) {
      const otherAdmins = await db.$count(
        users,
        and(eq(users.role, 'admin'), eq(users.isActive, true), ne(users.id, target.id)),
      );
      if (otherAdmins === 0) {
        throw new AppError(400, 'last_admin', 'Harus ada minimal satu admin aktif.');
      }
    }

    const changes: Partial<typeof users.$inferInsert> = {};
    if (name !== undefined) changes.name = name;
    if (role !== undefined) changes.role = role;
    if (isActive !== undefined) changes.isActive = isActive;
    if (Object.keys(changes).length > 0) await db.update(users).set(changes).where(eq(users.id, target.id));
    if (password !== undefined) await setPassword(db, target.id, password);
    if (isActive === false || password !== undefined || role !== undefined) await revokeAllSessions(db, target.id);

    await audit(db, {
      actorUserId: req.user.id,
      action: 'user.update',
      targetType: 'user',
      targetId: target.id,
      meta: { ...changes, passwordReset: password !== undefined },
      ip: req.ip,
    });
    const updated = await db.query.users.findFirst({ where: eq(users.id, target.id) });
    return { user: toUserDTO(updated!) };
  });
}
