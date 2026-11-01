// Placeholder sampai aplikasi WA Inbox dideploy (lihat docs/PROMPTS.md, Prompt 3).
const http = require("http");
const PORT = Number(process.env.PORT || 3210);
http.createServer((req, res) => {
  if (req.url === "/healthz") { res.writeHead(200, {"content-type": "application/json"}); return res.end(JSON.stringify({ ok: true, app: "placeholder" })); }
  res.writeHead(200, {"content-type": "text/html; charset=utf-8"});
  res.end("<!doctype html><title>WA KPP</title><p>WA Inbox KPP Pratama Banyuwangi sedang dibangun.</p>");
}).listen(PORT, "127.0.0.1", () => console.log("placeholder listening on " + PORT));
