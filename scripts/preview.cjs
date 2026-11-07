const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../src');
const mime = { '.html': 'text/html', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const target = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!target.startsWith(root + path.sep) || !mime[path.extname(target)]) { res.writeHead(404); return res.end(); }
  fs.readFile(target, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': mime[path.extname(target)], 'X-Content-Type-Options': 'nosniff' });
    res.end(data);
  });
}).listen(4173, '127.0.0.1', () => console.log('Web Canvas preview: http://127.0.0.1:4173 (canvas only; use npm start for live websites)'));
