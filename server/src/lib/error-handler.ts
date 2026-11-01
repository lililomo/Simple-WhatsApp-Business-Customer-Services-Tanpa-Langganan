import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { AppError } from './errors';

export function errorHandler(err: FastifyError, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof AppError) {
    return reply
      .status(err.statusCode)
      .send({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (hasZodFastifySchemaValidationErrors(err)) {
    return reply.status(400).send({
      error: {
        code: 'validation_error',
        message: err.validation[0]?.message ?? 'Data yang dikirim tidak valid.',
        details: { issues: err.validation },
      },
    });
  }
  if (err.statusCode === 429) {
    return reply
      .status(429)
      .send({ error: { code: 'rate_limited', message: 'Terlalu banyak permintaan. Coba lagi sebentar lagi.' } });
  }
  if (err.statusCode === 413) {
    return reply.status(413).send({ error: { code: 'payload_too_large', message: 'Ukuran data terlalu besar.' } });
  }
  if (err.statusCode && err.statusCode < 500) {
    return reply.status(err.statusCode).send({ error: { code: err.code ?? 'bad_request', message: err.message } });
  }
  req.log.error({ err }, 'unhandled error');
  return reply.status(500).send({ error: { code: 'internal_error', message: 'Terjadi kesalahan di server.' } });
}
