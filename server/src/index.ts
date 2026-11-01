import { buildApp } from './app';

const port = Number(process.env.PORT ?? 3210);
const app = await buildApp();
await app.listen({ port, host: '127.0.0.1' });
console.log(`WA Inbox listening on 127.0.0.1:${port}`);
