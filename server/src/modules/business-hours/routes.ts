import { saveBusinessHoursBody } from '@wa/shared';
import type { AppInstance } from '../../types';
import { audit } from '../audit/service';
import { requireAdminHook, requireUser, requireUserHook } from '../auth/plugin';
import { businessHoursDTO, saveBusinessHours, syncHolidays } from './service';

/** Jam kerja, hari libur, dan balasan otomatis. Semua petugas boleh melihat status; hanya admin yang mengubah. */
export async function businessHoursRoutes(app: AppInstance) {
  const deps = app.deps;
  const { db } = deps.database;
  app.addHook('preValidation', requireUserHook);

  app.get('/', async () => businessHoursDTO(deps));

  app.put('/', { preValidation: requireAdminHook, schema: { body: saveBusinessHoursBody } }, async (req) => {
    requireUser(req);
    const { holidayApiKey, ...settings } = req.body;
    await saveBusinessHours(deps, settings, holidayApiKey, req.user.id);
    await audit(db, {
      actorUserId: req.user.id,
      action: 'business_hours.update',
      meta: { autoReply: settings.autoReply.enabled, apiKeyChanged: holidayApiKey !== undefined && holidayApiKey !== '' },
      ip: req.ip,
    });
    // Kunci baru langsung dicoba agar admin tahu hasilnya.
    if (holidayApiKey) await syncHolidays(deps);
    return businessHoursDTO(deps);
  });

  app.post('/sync-holidays', { preValidation: requireAdminHook }, async () => {
    const result = await syncHolidays(deps);
    return { ...result, businessHours: await businessHoursDTO(deps) };
  });
}
