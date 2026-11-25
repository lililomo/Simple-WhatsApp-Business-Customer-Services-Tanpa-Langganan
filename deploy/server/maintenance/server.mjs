// Halaman "sedang pemeliharaan" yang menggantikan aplikasi selama deploy (lihat bin/maintenance.sh).
// Tanpa dependensi, supaya bisa jalan sebelum release baru selesai dibangun.
import http from 'node:http';
import process from 'node:process';

const PORT = Number(process.env.PORT || 3210);
const MESSAGE = 'WA Inbox sedang dalam pemeliharaan. Coba lagi beberapa saat lagi.';

const PAGE = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="15">
<title>WA Inbox · Pemeliharaan</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f4ef;color:#131b44;font-family:system-ui,"Segoe UI",sans-serif}
  main{background:#fff;border-radius:16px;padding:32px;max-width:420px;margin:16px;text-align:center;box-shadow:0 1px 3px #0002}
  i{display:block;width:44px;height:44px;margin:0 auto 16px;border:4px solid #e7e5dc;border-top-color:#ffc91b;border-radius:50%;animation:s 1s linear infinite}
  h1{font-size:20px;margin:0 0 8px;color:#212c5f}
  p{margin:0;line-height:1.5}
  small{display:block;margin-top:16px;color:#6a6a6a}
  @keyframes s{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<main>
  <i></i>
  <h1>Sedang pemeliharaan</h1>
  <p>WA Inbox sedang diperbarui dan akan kembali dalam beberapa menit.</p>
  <small>Halaman ini memuat ulang sendiri. Pesan WhatsApp yang masuk tidak hilang.</small>
</main>
</body>
</html>`;

const UNAVAILABLE = { 'retry-after': '60', 'cache-control': 'no-store' };

http
  .createServer((req, res) => {
    const url = req.url ?? '/';
    req.resume();
    // Dipakai watchdog dan skrip deploy; tanpa "version" supaya tidak pernah dianggap aplikasi yang sehat.
    if (url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, app: 'maintenance' }));
      return;
    }
    // Webhook Meta wajib dijawab selain 2xx agar Meta mengirim ulang nanti: membalas 200 berarti pesan hilang.
    if (
      url.startsWith('/api/') ||
      url.startsWith('/webhooks/') ||
      url.startsWith('/sso/revoke') ||
      url.startsWith('/sso/stats')
    ) {
      res.writeHead(503, { ...UNAVAILABLE, 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { code: 'maintenance', message: MESSAGE } }));
      return;
    }
    res.writeHead(503, { ...UNAVAILABLE, 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  })
  .listen(PORT, '127.0.0.1', () => console.log(`maintenance page listening on ${PORT}`));
