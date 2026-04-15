import http from 'http';
import https from 'https';
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

// ─── n8n Builder skill system prompt + tools ───
const n8nSkillBase = path.join(__dirname, 'skills', 'n8n-builder');
const N8N_SYSTEM_PROMPT = [
  fs.readFileSync(path.join(n8nSkillBase, 'CLAUDE.md'), 'utf8'),
  '---',
  '## n8n Workflow Patterns',
  fs.readFileSync(path.join(n8nSkillBase, 'n8n-skills', 'skills', 'n8n-workflow-patterns', 'SKILL.md'), 'utf8'),
  '---',
  '## n8n MCP Tools Expert',
  fs.readFileSync(path.join(n8nSkillBase, 'n8n-skills', 'skills', 'n8n-mcp-tools-expert', 'SKILL.md'), 'utf8'),
  '---',
  '## Workflow Management Guide',
  fs.readFileSync(path.join(n8nSkillBase, 'n8n-skills', 'skills', 'n8n-mcp-tools-expert', 'WORKFLOW_GUIDE.md'), 'utf8'),
  '---',
  `## Instructions for this session
You are building an n8n workflow via tool calls. The user will describe what they want automated.
Use the n8n_create_workflow tool to create the workflow directly in n8n Cloud.
If the user requested auto-activation, use n8n_activate_workflow after creation.
Build the COMPLETE workflow in a single n8n_create_workflow call — do not split into multiple creates.
After successfully creating (and optionally activating) the workflow, confirm success briefly.`,
].join('\n\n');

const N8N_TOOLS = [
  {
    name: 'n8n_create_workflow',
    description: 'Create a new workflow in n8n Cloud. Returns the created workflow with its ID.',
    input_schema: {
      type: 'object',
      properties: {
        name:        { type: 'string', description: 'Workflow name' },
        nodes:       { type: 'array',  items: { type: 'object' }, description: 'Array of workflow nodes' },
        connections: { type: 'object', description: 'Node connections object' },
        settings:    { type: 'object', description: 'Workflow settings (e.g. {"executionOrder":"v1"})' },
      },
      required: ['name', 'nodes', 'connections'],
    },
  },
  {
    name: 'n8n_activate_workflow',
    description: 'Activate a workflow so it runs automatically on its trigger.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Workflow ID returned by n8n_create_workflow' },
      },
      required: ['id'],
    },
  },
];

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

// ─── Helper: call n8n REST API ───
function callN8nApi(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const n8nUrl = process.env.N8N_API_URL || 'https://teamm8.app.n8n.cloud';
    const apiKey = process.env.N8N_API_KEY;
    if (!apiKey) { reject(new Error('N8N_API_KEY não configurada no servidor.')); return; }

    const url = new URL(n8nUrl + endpoint);
    const postData = body ? JSON.stringify(body) : undefined;
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'X-N8N-API-KEY': apiKey,
        'Accept': 'application/json',
        ...(postData ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } : {}),
      },
    };

    const proto = url.protocol === 'https:' ? https : http;
    const req = proto.request(options, (res2) => {
      let data = '';
      res2.on('data', c => data += c);
      res2.on('end', () => {
        if (res2.statusCode < 200 || res2.statusCode >= 300) {
          let detail = '';
          try { detail = JSON.parse(data)?.message || data; } catch {}
          reject(new Error(`n8n API ${res2.statusCode}: ${detail}`));
        } else {
          try { resolve(JSON.parse(data)); }
          catch { resolve(data); }
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

// ─── API: POST /api/build-n8n-workflow ───
async function handleBuildN8nWorkflow(req, res) {
  let body;
  try { body = await readBody(req); }
  catch (e) { return sendJSON(res, 400, { error: e.message }); }

  const {
    nomeWorkflow, objetivo, tipoTrigger,
    webhookPath, scheduleFrequencia, scheduleCron,
    integracoes, logicaAdicional, ativarAutomaticamente,
  } = body;

  if (!nomeWorkflow || !objetivo || !tipoTrigger)
    return sendJSON(res, 400, { error: 'Campos obrigatórios em falta: nome, objetivo e tipo de trigger.' });

  const intList = Array.isArray(integracoes) && integracoes.length
    ? integracoes.join(', ')
    : 'nenhuma especificada';

  let triggerDetails = '';
  if (tipoTrigger === 'Webhook') {
    triggerDetails = webhookPath ? `caminho: /${webhookPath}` : 'caminho auto-gerado';
  } else if (tipoTrigger === 'Schedule') {
    triggerDetails = scheduleCron
      ? `cron customizado: ${scheduleCron}`
      : `frequência: ${scheduleFrequencia || 'Diária'}`;
  } else {
    triggerDetails = 'execução manual';
  }

  const userMessage = [
    `Cria um workflow n8n com as seguintes especificações:`,
    `Nome: ${nomeWorkflow}`,
    `Objetivo: ${objetivo}`,
    `Tipo de trigger: ${tipoTrigger} (${triggerDetails})`,
    `Integrações necessárias: ${intList}`,
    logicaAdicional ? `Lógica adicional: ${logicaAdicional}` : '',
    ativarAutomaticamente ? 'Ativar automaticamente após criação: sim' : '',
  ].filter(Boolean).join('\n');

  const messages = [{ role: 'user', content: userMessage }];
  const n8nApiUrl = process.env.N8N_API_URL || 'https://teamm8.app.n8n.cloud';
  let workflowId = null;

  try {
    for (let i = 0; i < 10; i++) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        system: N8N_SYSTEM_PROMPT,
        tools: N8N_TOOLS,
        messages,
      });

      messages.push({ role: 'assistant', content: response.content });

      if (response.stop_reason === 'end_turn') break;

      if (response.stop_reason === 'tool_use') {
        const toolResults = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          let result;
          try {
            if (block.name === 'n8n_create_workflow') {
              const created = await callN8nApi('POST', '/api/v1/workflows', block.input);
              workflowId = created.id;
              result = { success: true, id: workflowId, url: `${n8nApiUrl}/workflow/${workflowId}` };
            } else if (block.name === 'n8n_activate_workflow') {
              await callN8nApi('POST', `/api/v1/workflows/${block.input.id}/activate`);
              result = { success: true, message: 'Workflow activated' };
            } else {
              result = { error: `Unknown tool: ${block.name}` };
            }
          } catch (err) {
            result = { error: err.message };
          }
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
        }
        messages.push({ role: 'user', content: toolResults });
      }
    }
  } catch (e) {
    console.error('n8n builder error:', e);
    return sendJSON(res, 500, { error: e.message || 'Erro ao construir o workflow.' });
  }

  if (!workflowId)
    return sendJSON(res, 500, { error: 'Não foi possível criar o workflow. Verifica os detalhes e tenta novamente.' });

  sendJSON(res, 200, {
    success: true,
    workflowId,
    workflowUrl: `${n8nApiUrl}/workflow/${workflowId}`,
    workflowName: nomeWorkflow,
  });
}

// ─── HTTP Server ───
const server = http.createServer(async (req, res) => {
  let urlPath = req.url.split('?')[0];

  // ── API routes (POST) ──
  if (req.method === 'POST') {
    if (urlPath === '/api/generate-carousel')    return handleGenerateCarousel(req, res);
    if (urlPath === '/api/export-slides')        return handleExportSlides(req, res);
    if (urlPath === '/api/build-n8n-workflow')   return handleBuildN8nWorkflow(req, res);
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
  if (urlPath === '/n8n-builder')         urlPath = '/pages/n8n-builder.html';

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
