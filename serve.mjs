import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import puppeteer from 'puppeteer';
import { marked } from 'marked';

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
const skillMdPath = path.join(__dirname, '.claude', 'skills', 'instagram-carousel', 'SKILL.md');
const systemPrompt = fs.readFileSync(skillMdPath, 'utf8');

// ─── Supabase server client (service role) ───
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://saayqbocxplmdnekwqrh.supabase.co';
const SUPABASE_SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;

function sbFetch(method, urlPath, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const url = new URL(SUPABASE_URL + urlPath);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${SUPABASE_SRK}`,
        'apikey': SUPABASE_SRK,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
        ...extraHeaders,
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, res2 => {
      let buf = '';
      res2.on('data', d => buf += d);
      res2.on('end', () => {
        try { resolve({ status: res2.statusCode, data: JSON.parse(buf) }); }
        catch { resolve({ status: res2.statusCode, data: buf }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function sbStorageUpload(storagePath, buffer, contentType) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SUPABASE_URL}/storage/v1/object/${storagePath}`);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SRK}`,
        'Content-Type': contentType,
        'Content-Length': buffer.length,
        'x-upsert': 'true',
      },
    }, res2 => {
      let buf = '';
      res2.on('data', d => buf += d);
      res2.on('end', () => resolve({ status: res2.statusCode }));
    });
    req.on('error', reject);
    req.write(buffer);
    req.end();
  });
}

// ─── Proposta Comercial skill system prompt ───
const propostaSkillBase = path.join(__dirname, '.claude', 'skills', 'proposta-comercial');
const PROPOSTA_SYSTEM_PROMPT = [
  fs.readFileSync(path.join(propostaSkillBase, 'SKILL.md'), 'utf8'),
  '---',
  '## Metodologia de Preços para Automações',
  fs.readFileSync(path.join(propostaSkillBase, 'pricing-automations.md'), 'utf8'),
  '---',
  '## Metodologia de Preços para Software',
  fs.readFileSync(path.join(propostaSkillBase, 'pricing-software.md'), 'utf8'),
  '---',
  '## Framework P.R.I.C.E. e Discovery Phase',
  fs.readFileSync(path.join(propostaSkillBase, 'discovery-framework.md'), 'utf8'),
  '---',
  '## Template — Proposta Técnica',
  fs.readFileSync(path.join(propostaSkillBase, 'templates', 'proposta-tecnica.md'), 'utf8'),
  '---',
  '## Template — Proposta Comercial',
  fs.readFileSync(path.join(propostaSkillBase, 'templates', 'proposta-comercial.md'), 'utf8'),
].join('\n\n');

// ─── n8n Builder skill system prompt + tools ───
const n8nSkillBase = path.join(__dirname, '.claude', 'skills', 'n8n-builder');
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

// ─── Proposta Comercial helpers ───

function calcularROI(respostas, settings) {
  const tarefas = Array.isArray(respostas.tarefas_detalhadas) ? respostas.tarefas_detalhadas : [];
  const custoHora = parseFloat(respostas.custo_hora_colaboradores) || parseFloat(settings.custo_hora_referencia) || 15;

  let horasMes = 0;
  for (const t of tarefas) {
    const vezes   = parseInt(t.vezes)    || 1;
    const tempoMin= parseFloat(t.tempo_min) || 0;
    const pessoas = parseInt(t.pessoas)  || 1;
    const freq    = (t.frequencia || '').toLowerCase();
    let vezesMes;
    if (freq === 'diária' || freq === 'diaria')   vezesMes = vezes * 20;
    else if (freq === 'semanal')                  vezesMes = vezes * 4;
    else                                          vezesMes = vezes;
    horasMes += (tempoMin / 60) * vezesMes * pessoas;
  }

  const horasAno   = horasMes * 12;
  const custoAnual = horasAno * custoHora;
  const tipo       = respostas.tipo_solucao_final || 'automacoes';

  let bandaMin, bandaMax;
  if (tipo === 'automacoes') {
    bandaMin = Math.max(parseFloat(settings.preco_minimo_projeto) || 1500, custoAnual * ((parseFloat(settings.banda_valor_min_pct) || 10) / 100));
    bandaMax = Math.max(parseFloat(settings.tier2_max) || 6000, custoAnual * ((parseFloat(settings.banda_valor_max_pct) || 30) / 100));
  } else if (tipo === 'software') {
    bandaMin = parseFloat(settings.preco_minimo_projeto) || 1500;
    bandaMax = parseFloat(settings.tier3_max) || 15000;
  } else {
    bandaMin = Math.max(parseFloat(settings.preco_minimo_projeto) || 1500, custoAnual * ((parseFloat(settings.banda_valor_min_pct) || 10) / 100));
    bandaMax = parseFloat(settings.tier3_max) || 15000;
  }

  return {
    horasMes:    Math.round(horasMes * 10) / 10,
    horasAno:    Math.round(horasAno * 10) / 10,
    custoAnual:  Math.round(custoAnual),
    bandaMin:    Math.round(bandaMin),
    bandaMax:    Math.round(bandaMax),
    custoHora,
  };
}

async function renderPDF(templateName, vars, contentMd) {
  const templatePath = path.join(__dirname, 'pdf-templates', `${templateName}.html`);
  let template = fs.readFileSync(templatePath, 'utf8');

  const logoPath = path.join(__dirname, 'brand_assets', 'logo-teammate.svg');
  const logoData = fs.existsSync(logoPath)
    ? `data:image/svg+xml;base64,${fs.readFileSync(logoPath).toString('base64')}`
    : '';

  const contentHtml = marked.parse(contentMd || '');

  for (const [k, v] of Object.entries(vars)) {
    template = template.replaceAll(`{{${k}}}`, String(v ?? ''));
  }
  template = template.replace('{{LOGO_BASE64}}', logoData).replace('{{CONTEUDO_HTML}}', contentHtml);

  const br  = await getBrowser();
  const pg  = await br.newPage();
  try {
    await pg.setContent(template, { waitUntil: 'networkidle0', timeout: 30000 });
    await pg.waitForFunction(() => document.fonts.ready, { timeout: 8000 }).catch(() => {});
    return await pg.pdf({ format: 'A4', printBackground: true, margin: { top: '2cm', bottom: '2cm', left: '2.5cm', right: '2.5cm' } });
  } finally {
    await pg.close();
  }
}

// ─── API: POST /api/generate-proposal ───
async function handleGenerateProposal(req, res) {
  let body;
  try { body = await readBody(req); }
  catch (e) { return sendJSON(res, 400, { error: e.message }); }

  const { proposta_id, tipo, informacoes_adicionais } = body;
  if (!proposta_id) return sendJSON(res, 400, { error: 'proposta_id em falta' });
  if (tipo && tipo !== 'tecnica' && tipo !== 'comercial') return sendJSON(res, 400, { error: 'tipo deve ser "tecnica" ou "comercial"' });

  // 1. Carregar dados
  const [frRes, stRes, prRes] = await Promise.all([
    sbFetch('GET', `/rest/v1/proposal_form_responses?proposta_id=eq.${proposta_id}&select=*&limit=1`),
    sbFetch('GET', '/rest/v1/proposal_settings?select=*&limit=1'),
    sbFetch('GET', `/rest/v1/propostas?id=eq.${proposta_id}&select=numero,nome&limit=1`),
  ]);

  const respostas = Array.isArray(frRes.data) ? frRes.data[0] : null;
  const settings  = Array.isArray(stRes.data) ? stRes.data[0] : {};
  const proposta  = Array.isArray(prRes.data) ? prRes.data[0] : {};

  if (!respostas) return sendJSON(res, 404, { error: 'Respostas do formulário não encontradas' });

  // 2. Calcular ROI
  const calculos = calcularROI(respostas, settings);

  // 3. Construir prompt
  const now     = new Date();
  const dataEmissao  = now.toLocaleDateString('pt-PT');
  const dataValidade = new Date(now.getTime() + (parseInt(settings.validade_proposta_dias) || 7) * 86400000).toLocaleDateString('pt-PT');
  const numeroProposta = proposta.numero || `PC-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;

  let instrucaoTipo;
  if (tipo === 'tecnica') {
    instrucaoTipo = 'Gera APENAS a proposta técnica. No JSON de resposta inclui apenas o campo "conteudo_tecnico_md" (e os campos de valores/ROI). Omite "conteudo_comercial_md".';
  } else if (tipo === 'comercial') {
    instrucaoTipo = 'Gera APENAS a proposta comercial. No JSON de resposta inclui apenas o campo "conteudo_comercial_md" (e os campos de valores/ROI). Omite "conteudo_tecnico_md".';
  } else {
    instrucaoTipo = 'Gera as duas propostas (técnica e comercial).';
  }

  let userMessage = `${instrucaoTipo}

## Dados do Cliente (Discovery Phase)
${JSON.stringify(respostas, null, 2)}

## Variáveis de Precificação (proposal_settings)
${JSON.stringify(settings, null, 2)}

## Cálculos Pré-Processados
- Horas perdidas por mês: ${calculos.horasMes}h
- Horas perdidas por ano: ${calculos.horasAno}h
- Custo anual estimado: ${calculos.custoAnual}€ (a ${calculos.custoHora}€/hora)
- Banda de investimento sugerida: ${calculos.bandaMin}€ – ${calculos.bandaMax}€

## Meta da Proposta
- Número da proposta: ${numeroProposta}
- Data de emissão: ${dataEmissao}
- Válida até: ${dataValidade}
- Validade: ${settings.validade_proposta_dias || 7} dias
- Preparada para: ${respostas.nome_contacto || ''}${respostas.cargo_contacto ? ', ' + respostas.cargo_contacto : ''}`;

  if (informacoes_adicionais && informacoes_adicionais.trim()) {
    userMessage += `\n\n## Informações Adicionais do Utilizador\n${informacoes_adicionais.trim()}`;
  }

  userMessage += '\n\nRetorna APENAS JSON puro sem formatação markdown (sem ```json).';

  // 4. Invocar Claude
  let result;
  try {
    const response = await anthropic.messages.create({
      model:      settings.modelo_claude || 'claude-sonnet-4-6',
      max_tokens: 8000,
      system:     PROPOSTA_SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: userMessage }],
    });
    const raw = response.content[0].text.trim();
    const cleaned = raw.startsWith('```') ? raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '') : raw;
    result = JSON.parse(cleaned);
  } catch (e) {
    console.error('Claude API error:', e);
    return sendJSON(res, 500, { error: e.message, stage: 'claude_api' });
  }

  // 5. Gerar PDF(s)
  const pdfVars = {
    NOME_EMPRESA:     respostas.nome_empresa,
    NUMERO_PROPOSTA:  numeroProposta,
    DATA_EMISSAO:     dataEmissao,
    DATA_VALIDADE:    dataValidade,
    VALIDADE_DIAS:    settings.validade_proposta_dias || 7,
  };

  const gerarTecnica  = !tipo || tipo === 'tecnica';
  const gerarComercial = !tipo || tipo === 'comercial';

  let pdfTecnica, pdfComercial;
  try {
    const tarefas = [];
    if (gerarTecnica)   tarefas.push(renderPDF('proposta-tecnica',  pdfVars, result.conteudo_tecnico_md).then(b => { pdfTecnica = b; }));
    if (gerarComercial) tarefas.push(renderPDF('proposta-comercial', pdfVars, result.conteudo_comercial_md).then(b => { pdfComercial = b; }));
    await Promise.all(tarefas);
  } catch (e) {
    console.error('PDF generation error:', e);
    return sendJSON(res, 500, { error: e.message, stage: 'pdf_generation' });
  }

  // 6. Upload para Supabase Storage
  let urlTecnica, urlComercial;
  try {
    const uploads = [];
    if (gerarTecnica)   uploads.push(sbStorageUpload(`propostas-pdfs/${proposta_id}/tecnica.pdf`,   pdfTecnica,   'application/pdf'));
    if (gerarComercial) uploads.push(sbStorageUpload(`propostas-pdfs/${proposta_id}/comercial.pdf`, pdfComercial, 'application/pdf'));
    await Promise.all(uploads);
    if (gerarTecnica)   urlTecnica   = `${SUPABASE_URL}/storage/v1/object/public/propostas-pdfs/${proposta_id}/tecnica.pdf`;
    if (gerarComercial) urlComercial = `${SUPABASE_URL}/storage/v1/object/public/propostas-pdfs/${proposta_id}/comercial.pdf`;
  } catch (e) {
    console.error('Storage upload error:', e);
    return sendJSON(res, 500, { error: e.message, stage: 'storage_upload' });
  }

  // 7. Actualizar propostas
  const roi = result.valor_total_recomendado > 0 ? Math.round((calculos.custoAnual / result.valor_total_recomendado) * 10) / 10 : 0;
  const patch = {
    estado:   'rascunho',
    origem:   'ia',
    tipo_solucao:               respostas.tipo_solucao_final,
    nicho:                      respostas.nicho,
    valor:                      result.valor_total_recomendado,
    tempo_perdido_mensal_horas: calculos.horasMes,
    tempo_perdido_anual_horas:  calculos.horasAno,
    custo_anual_estimado:       calculos.custoAnual,
    roi_estimado:               roi,
    variaveis_snapshot:         settings,
  };
  if (gerarTecnica)   { patch.pdf_tecnica_url = urlTecnica;     patch.conteudo_tecnico_md = result.conteudo_tecnico_md; }
  if (gerarComercial) { patch.pdf_comercial_url = urlComercial; patch.conteudo_comercial_md = result.conteudo_comercial_md; }
  if (informacoes_adicionais && tipo === 'tecnica')   patch.informacoes_adicionais_tecnica = informacoes_adicionais;
  if (informacoes_adicionais && tipo === 'comercial') patch.informacoes_adicionais_comercial = informacoes_adicionais;
  await sbFetch('PATCH', `/rest/v1/propostas?id=eq.${proposta_id}`, patch);

  // 8. Criar cliente se não existir
  if (respostas.nome_empresa) {
    const cliRes = await sbFetch('GET', `/rest/v1/clientes?nome=eq.${encodeURIComponent(respostas.nome_empresa)}&select=id&limit=1`);
    let clienteId = Array.isArray(cliRes.data) && cliRes.data[0]?.id;
    if (!clienteId) {
      const newCli = await sbFetch('POST', '/rest/v1/clientes', { nome: respostas.nome_empresa });
      clienteId = Array.isArray(newCli.data) ? newCli.data[0]?.id : null;
    }
    if (clienteId) {
      await sbFetch('PATCH', `/rest/v1/propostas?id=eq.${proposta_id}`, { cliente_id: clienteId });
    }
  }

  sendJSON(res, 200, {
    success:           true,
    proposta_id,
    pdf_tecnica_url:   urlTecnica,
    pdf_comercial_url: urlComercial,
    conteudo_tecnico_md:   result.conteudo_tecnico_md,
    conteudo_comercial_md: result.conteudo_comercial_md,
    valor_total:       result.valor_total_recomendado,
    roi_estimado:      roi,
  });
}

// ─── API: POST /api/regenerate-pdf ───
async function handleRegeneratePdf(req, res) {
  let body;
  try { body = await readBody(req); }
  catch (e) { return sendJSON(res, 400, { error: e.message }); }

  const { proposta_id, tipo, conteudo_md } = body;
  if (!proposta_id || !tipo || !conteudo_md) return sendJSON(res, 400, { error: 'proposta_id, tipo e conteudo_md são obrigatórios' });
  if (tipo !== 'tecnica' && tipo !== 'comercial') return sendJSON(res, 400, { error: 'tipo deve ser "tecnica" ou "comercial"' });

  const prRes = await sbFetch('GET', `/rest/v1/propostas?id=eq.${proposta_id}&select=numero,nicho&limit=1`);
  const proposta = Array.isArray(prRes.data) ? prRes.data[0] : {};
  const frRes = await sbFetch('GET', `/rest/v1/proposal_form_responses?proposta_id=eq.${proposta_id}&select=nome_empresa&limit=1`);
  const respostas = Array.isArray(frRes.data) ? frRes.data[0] : {};
  const stRes = await sbFetch('GET', '/rest/v1/proposal_settings?select=validade_proposta_dias&limit=1');
  const settings = Array.isArray(stRes.data) ? stRes.data[0] : {};

  const now = new Date();
  const pdfVars = {
    NOME_EMPRESA:    respostas.nome_empresa || '',
    NUMERO_PROPOSTA: proposta.numero || '',
    DATA_EMISSAO:    now.toLocaleDateString('pt-PT'),
    DATA_VALIDADE:   new Date(now.getTime() + (parseInt(settings.validade_proposta_dias) || 7) * 86400000).toLocaleDateString('pt-PT'),
    VALIDADE_DIAS:   settings.validade_proposta_dias || 7,
  };

  let pdfBuffer;
  try {
    pdfBuffer = await renderPDF(`proposta-${tipo}`, pdfVars, conteudo_md);
  } catch (e) {
    return sendJSON(res, 500, { error: e.message, stage: 'pdf_generation' });
  }

  const storagePath = `propostas-pdfs/${proposta_id}/${tipo}.pdf`;
  await sbStorageUpload(storagePath, pdfBuffer, 'application/pdf');

  const urlCol  = tipo === 'tecnica' ? 'pdf_tecnica_url'  : 'pdf_comercial_url';
  const mdCol   = tipo === 'tecnica' ? 'conteudo_tecnico_md' : 'conteudo_comercial_md';
  const pdfUrl  = `${SUPABASE_URL}/storage/v1/object/public/${storagePath}`;
  await sbFetch('PATCH', `/rest/v1/propostas?id=eq.${proposta_id}`, { [urlCol]: pdfUrl, [mdCol]: conteudo_md });

  sendJSON(res, 200, { success: true, url: pdfUrl });
}

// ─── HTTP Server ───
const server = http.createServer(async (req, res) => {
  let urlPath = req.url.split('?')[0];

  // ── API routes (POST) ──
  if (req.method === 'POST') {
    if (urlPath === '/api/generate-carousel')    return handleGenerateCarousel(req, res);
    if (urlPath === '/api/export-slides')        return handleExportSlides(req, res);
    if (urlPath === '/api/build-n8n-workflow')   return handleBuildN8nWorkflow(req, res);
    if (urlPath === '/api/generate-proposal')    return handleGenerateProposal(req, res);
    if (urlPath === '/api/regenerate-pdf')       return handleRegeneratePdf(req, res);
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
  if (urlPath === '/documentos')                              urlPath = '/pages/documentos.html';
  if (urlPath === '/agentes')                                 urlPath = '/pages/agentes.html';
  if (urlPath === '/carrossel-instagram')                     urlPath = '/pages/carrossel-instagram.html';
  if (urlPath === '/n8n-builder')                             urlPath = '/pages/n8n-builder.html';
  if (urlPath === '/agentes/proposta-comercial')              urlPath = '/pages/proposta-comercial.html';
  if (urlPath === '/agentes/proposta-comercial/nova')         urlPath = '/pages/proposta-comercial-nova.html';
  if (urlPath === '/agentes/proposta-comercial/nova/revisao') urlPath = '/pages/proposta-comercial-revisao.html';
  if (urlPath.match(/^\/agentes\/proposta-comercial\/[^/]+$/)) urlPath = '/pages/proposta-comercial-detalhe.html';

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
  // Ensure propostas-pdfs bucket is public (safe to call on every startup)
  if (SUPABASE_SRK) {
    const data = JSON.stringify({ id: 'propostas-pdfs', name: 'propostas-pdfs', public: true });
    const url  = new URL(`${SUPABASE_URL}/storage/v1/bucket/propostas-pdfs`);
    const req  = https.request({ hostname: url.hostname, path: url.pathname, method: 'PUT',
      headers: { 'Authorization': `Bearer ${SUPABASE_SRK}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, r => r.resume());
    req.on('error', () => {});
    req.write(data);
    req.end();
  }
});
