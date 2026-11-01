import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', cli: 'src/cli.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Paket workspace (@wa/shared) berupa source TypeScript, jadi ikut di-bundle.
  noExternal: [/^@wa\//],
  // Versi aplikasi dikunci saat build (APP_VERSION diberikan skrip deploy = SHA commit).
  define: { 'process.env.APP_VERSION': JSON.stringify(process.env.APP_VERSION ?? 'dev') },
});
