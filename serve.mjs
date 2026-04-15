import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import puppeteer from 'puppeteer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

// ─── Load .env ───
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) return;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  });
}

// ─── Anthropic client + SKILL.md system prompt ───
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const skillMdPath = path.join(__dirname, 'skills', 'instagram-carousel', 'SKILL.md');
const systemPrompt = fs.readFileSync(skillMdPath, 'utf8');

// ─── Persistent Puppeteer browser (launched once, reused per request) ───
let browser = null;
async function getBrowser() {
  if (!browser || !browser.connected) {
    browser = await puppeteer.launch({ headless: true });
  }
  return browser;
}

// ─── MIME types ───
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

// ─── Helper: read POST body as JSON ───
function readBody(req, maxBytes = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) { req.destroy(); reject(new Error('Payload too large')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

// ─── Helper: extract XML-delimited tag from Claude response ───
function extractTag(text, tag) {
  return (text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`)) || [])[1]?.trim() ?? '';
}

// ─── Helper: send JSON response ───
function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

// ─── API: POST /api/generate-carousel ───
async function handleGenerateCarousel(req, res) {
  let body;
  try { body = await readBody(req); }
  catch (e) { return sendJSON(res, 400, { error: e.message }); }

  const { handle, tema, descricao, formato, fundo, hookType, cta, imagemBase64, imagemMime } = body;

  let userMessage = `Cria um carrossel de Instagram com as seguintes especificações:

- Handle Instagram: @${handle || 'teammatept'}
- Tema: ${tema}
- O que abordar: ${descricao}
- Formato: ${formato}
- Cor de fundo do 1º slide: ${fundo}
- Tipo de hook para o 1º slide: ${hookType}
- CTA do slide final: ${cta}
- Marca: TeamMate (usa as cores, fontes e logo pré-definidos)
- Idioma: Português (pt-PT)`;

  if (imagemBase64) {
    userMessage += `\n- Imagem de fundo fornecida pelo utilizador: incorpora-a como base64 data URI nos slides adequados. MIME type: ${imagemMime || 'image/jpeg'}. Data URI: ${imagemBase64}`;
  }

  userMessage += `

Devolve a resposta EXATAMENTE neste formato (sem texto fora dos delimitadores):
<CAROUSEL_HTML>
[HTML completo e auto-contido do carrossel]
</CAROUSEL_HTML>
<CAPTION>
[legenda em português, 150-200 palavras]
</CAPTION>
<HASHTAGS>
[15-20 hashtags separados por espaço]
</HASHTAGS>`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const raw = message.content[0].text;
    const html     = extractTag(raw, 'CAROUSEL_HTML');
    const caption  = extractTag(raw, 'CAPTION');
    const hashtags = extractTag(raw, 'HASHTAGS');

    if (!html) {
      return sendJSON(res, 500, { error: 'O modelo não devolveu HTML. Tenta novamente.' });
    }

    sendJSON(res, 200, { html, caption, hashtags });
  } catch (e) {
    console.error('Claude API error:', e);
    sendJSON(res, 500, { error: e.message || 'Erro na API do Claude' });
  }
}

// ─── API: POST /api/export-slides ───
async function handleExportSlides(req, res) {
  let body;
  try { body = await readBody(req); }
  catch (e) { return sendJSON(res, 400, { error: e.message }); }

  const { html, totalSlides = 7 } = body;
  if (!html) return sendJSON(res, 400, { error: 'HTML em falta' });

  let page;
  try {
    const br = await getBrowser();
    page = await br.newPage();

    const VIEW_W = 420;
    const VIEW_H = 525;
    const SCALE  = 1080 / 420;

    await page.setViewport({ width: VIEW_W, height: VIEW_H, deviceScaleFactor: SCALE });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.fonts.ready, { timeout: 5000 }).catch(() => {});

    // Strip IG chrome, expose raw carousel viewport
    await page.evaluate(() => {
      document.querySelectorAll('.ig-header,.ig-dots,.ig-actions,.ig-caption')
        .forEach(el => el.style.display = 'none');
      const frame = document.querySelector('.ig-frame');
      if (frame) frame.style.cssText = 'width:420px;height:525px;max-width:none;border-radius:0;box-shadow:none;overflow:hidden;margin:0;';
      const viewport = document.querySelector('.carousel-viewport');
      if (viewport) viewport.style.cssText = 'width:420px;height:525px;aspect-ratio:unset;overflow:hidden;cursor:default;';
      document.body.style.cssText = 'padding:0;margin:0;display:block;overflow:hidden;background:#000;';
    });

    const slides = [];
    for (let i = 0; i < totalSlides; i++) {
      await page.evaluate((idx) => {
        const track = document.querySelector('.carousel-track');
        if (track) {
          track.style.transition = 'none';
          track.style.transform = `translateX(${-idx * 420}px)`;
        }
      }, i);
      await new Promise(r => setTimeout(r, 80));
      const buf = await page.screenshot({ clip: { x: 0, y: 0, width: VIEW_W, height: VIEW_H } });
      slides.push(buf.toString('base64'));
    }

    await page.close();
    sendJSON(res, 200, { slides });
  } catch (e) {
    if (page) await page.close().catch(() => {});
    console.error('Puppeteer error:', e);
    sendJSON(res, 500, { error: e.message || 'Erro ao exportar slides' });
  }
}

// ─── HTTP Server ───
const server = http.createServer(async (req, res) => {
  let urlPath = req.url.split('?')[0];

  // ── API routes (POST) ──
  if (req.method === 'POST') {
    if (urlPath === '/api/generate-carousel') return handleGenerateCarousel(req, res);
    if (urlPath === '/api/export-slides')     return handleExportSlides(req, res);
    res.writeHead(404); res.end('Not found');
    return;
  }

  // ── Static file routes ──

  // Root → homepage
  if (urlPath === '/' || urlPath === '/index.html') urlPath = '/homepage.html';

  // /documentos/[id] → editor page
  const docEditorMatch = urlPath.match(/^\/documentos\/([^/]+)$/);
  if (docEditorMatch) urlPath = '/pages/documento-editor.html';

  // Clean URL rewrites
  if (urlPath === '/documentos')          urlPath = '/pages/documentos.html';
  if (urlPath === '/agentes')             urlPath = '/pages/agentes.html';
  if (urlPath === '/carrossel-instagram') urlPath = '/pages/carrossel-instagram.html';

  // Extensionless paths → try .html
  if (!path.extname(urlPath)) urlPath += '.html';

  const filePath = path.join(__dirname, urlPath);

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found: ' + urlPath); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
