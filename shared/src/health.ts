import { z } from 'zod';

export const healthSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
  time: z.string(),
});

export type Health = z.infer<typeof healthSchema>;
