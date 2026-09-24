const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, 'public');
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};

http.createServer((req, res) => {
  const clean = decodeURIComponent(req.url.split('?')[0]);
  const requested = clean === '/' ? 'index.html' : clean.replace(/^\/+/, '');
  const file = path.normalize(path.join(root, requested));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(file, (err, stat) => {
    const target = !err && stat.isFile() ? file : path.join(root, 'index.html');
    fs.readFile(target, (readErr, data) => {
      if (readErr) { res.writeHead(500); return res.end('Server error'); }
      res.writeHead(200, {'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': path.extname(target)==='.html'?'no-cache':'public, max-age=3600'});
      res.end(data);
    });
  });
}).listen(process.env.PORT || 3000, () => console.log(`Angermund Transport running on port ${process.env.PORT || 3000}`));
