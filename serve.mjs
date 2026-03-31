import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

const mime = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'text/javascript',
  '.mjs':  'text/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
};

const server = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];

  // Root → homepage
  if (urlPath === '/' || urlPath === '/index.html') urlPath = '/homepage.html';

  // /documentos/[id] → editor page (pass id via query string rewrite)
  const docEditorMatch = urlPath.match(/^\/documentos\/([^/]+)$/);
  if (docEditorMatch) {
    urlPath = '/pages/documento-editor.html';
    // Preserve the id so the page can read it from document.location
  }

  // /documentos → documents list page
  if (urlPath === '/documentos') urlPath = '/pages/documentos.html';

  // Extensionless paths → try .html (e.g. /homepage → /homepage.html)
  if (!path.extname(urlPath)) urlPath += '.html';

  const filePath = path.join(__dirname, urlPath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found: ' + urlPath);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
