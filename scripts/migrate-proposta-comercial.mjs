import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env
const envPath = path.join(__dirname, '..', '.env');
fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) return;
  const key = trimmed.slice(0, eqIdx).trim();
  const val = trimmed.slice(eqIdx + 1).trim();
  if (key && !(key in process.env)) process.env[key] = val;
});

const PROJECT_REF = 'saayqbocxplmdnekwqrh';
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;

function post(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({ hostname, path, method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(data) } }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function runSQL(sql, label) {
  console.log(`\n→ ${label}`);
  const res = await post(
    'api.supabase.com',
    `/v1/projects/${PROJECT_REF}/database/query`,
    { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    { query: sql }
  );
  if (res.status >= 400) {
    console.error(`  ✗ HTTP ${res.status}:`, JSON.stringify(res.body, null, 2));
    process.exit(1);
  }
  console.log(`  ✓ OK`);
  return res.body;
}

async function createStorageBucket(name) {
  console.log(`\n→ Storage bucket: ${name}`);
  const url = new URL(`${SUPABASE_URL}/storage/v1/bucket`);
  const res = await post(
    url.hostname,
    url.pathname,
    { 'Authorization': `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', 'apikey': SERVICE_ROLE_KEY },
    { id: name, name, public: false, file_size_limit: 52428800 }
  );
  if (res.status === 200 || res.status === 201) {
    console.log(`  ✓ Bucket criado`);
  } else if (res.body?.error === 'Duplicate' || res.body?.message?.includes('already exists')) {
    console.log(`  ✓ Bucket já existe`);
  } else {
    console.error(`  ✗ HTTP ${res.status}:`, JSON.stringify(res.body));
  }
}

// ─────────────────────────────────────────────
// MIGRATIONS
// ─────────────────────────────────────────────

await runSQL(`
ALTER TABLE public.propostas
  ADD COLUMN IF NOT EXISTS cliente_id UUID,
  ADD COLUMN IF NOT EXISTS tipo_solucao TEXT,
  ADD COLUMN IF NOT EXISTS nicho TEXT,
  ADD COLUMN IF NOT EXISTS tempo_perdido_mensal_horas NUMERIC,
  ADD COLUMN IF NOT EXISTS tempo_perdido_anual_horas NUMERIC,
  ADD COLUMN IF NOT EXISTS custo_anual_estimado NUMERIC,
  ADD COLUMN IF NOT EXISTS roi_estimado NUMERIC,
  ADD COLUMN IF NOT EXISTS pdf_tecnica_url TEXT,
  ADD COLUMN IF NOT EXISTS pdf_comercial_url TEXT,
  ADD COLUMN IF NOT EXISTS conteudo_tecnico_md TEXT,
  ADD COLUMN IF NOT EXISTS conteudo_comercial_md TEXT,
  ADD COLUMN IF NOT EXISTS variaveis_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS origem TEXT DEFAULT 'manual';
`, 'ALTER TABLE propostas — novas colunas');

await runSQL(`
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name='propostas' AND constraint_name='propostas_tipo_solucao_check'
  ) THEN
    ALTER TABLE public.propostas
      ADD CONSTRAINT propostas_tipo_solucao_check
      CHECK (tipo_solucao IN ('automacoes','software','software_automacoes') OR tipo_solucao IS NULL);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name='propostas' AND constraint_name='propostas_origem_check'
  ) THEN
    ALTER TABLE public.propostas
      ADD CONSTRAINT propostas_origem_check
      CHECK (origem IN ('manual','ia'));
  END IF;
END $$;
`, 'CHECK constraints em propostas');

await runSQL(`
CREATE TABLE IF NOT EXISTS public.proposal_form_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposta_id UUID NOT NULL REFERENCES public.propostas(id) ON DELETE CASCADE,

  -- Passo 1
  nome_empresa TEXT NOT NULL,
  nicho TEXT NOT NULL,
  tipo_solucao_inicial TEXT NOT NULL,
  nome_contacto TEXT,
  cargo_contacto TEXT,
  email_contacto TEXT,
  telefone_contacto TEXT,
  localizacao TEXT,

  -- Passo 2
  area_negocio TEXT,
  numero_pessoas INTEGER,
  equipas_separadas BOOLEAN,
  equipas_lista TEXT[],
  tipo_mercado TEXT,

  -- Passo 3
  ferramentas_digitais TEXT[],
  sistemas_integrados TEXT,
  tempo_uso_ferramentas TEXT,
  experiencia_negativa TEXT,

  -- Passo 4
  dia_tipico TEXT,
  tarefas_repetitivas TEXT,
  copiar_colar_nivel TEXT,
  pedidos_manuais TEXT,
  documentos_padrao TEXT,
  tres_tarefas_eliminar TEXT,

  -- Passo 5
  tarefas_detalhadas JSONB DEFAULT '[]'::jsonb,
  custo_hora_colaboradores NUMERIC,

  -- Passo 6
  impacto_mudanca TEXT,
  tempo_extra_uso TEXT,
  projectos_parados TEXT,
  crescimento_percepcao TEXT,

  -- Passo 7
  investimento_anterior BOOLEAN,
  investimento_contexto TEXT,
  decisor TEXT,
  orcamento_definido TEXT,
  banda_orcamento TEXT,
  urgencia TEXT,

  -- Passo 8
  preocupacao_principal TEXT,
  nota_adicional TEXT,
  tipo_solucao_final TEXT NOT NULL DEFAULT 'automacoes',
  notas_internas TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
`, 'CREATE TABLE proposal_form_responses');

await runSQL(`
CREATE INDEX IF NOT EXISTS idx_form_responses_proposta
  ON public.proposal_form_responses(proposta_id);
`, 'INDEX em proposal_form_responses');

await runSQL(`
CREATE TABLE IF NOT EXISTS public.proposal_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- IA
  modelo_claude TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
  temperatura NUMERIC NOT NULL DEFAULT 0.3,

  -- Automações
  banda_valor_min_pct NUMERIC NOT NULL DEFAULT 10,
  banda_valor_max_pct NUMERIC NOT NULL DEFAULT 30,
  preco_minimo_projeto NUMERIC NOT NULL DEFAULT 1500,
  tier1_min NUMERIC NOT NULL DEFAULT 1500,
  tier1_max NUMERIC NOT NULL DEFAULT 3000,
  tier2_min NUMERIC NOT NULL DEFAULT 3000,
  tier2_max NUMERIC NOT NULL DEFAULT 6000,
  tier3_min NUMERIC NOT NULL DEFAULT 6000,
  tier3_max NUMERIC NOT NULL DEFAULT 15000,

  -- Software
  preco_base_modulo NUMERIC NOT NULL DEFAULT 200,
  multiplicador_simples NUMERIC NOT NULL DEFAULT 1,
  multiplicador_media NUMERIC NOT NULL DEFAULT 1.5,
  multiplicador_alta NUMERIC NOT NULL DEFAULT 2,
  multiplicador_muito_alta NUMERIC NOT NULL DEFAULT 3,
  custo_integracao_min NUMERIC NOT NULL DEFAULT 300,
  custo_integracao_max NUMERIC NOT NULL DEFAULT 500,

  -- Custos internos
  preco_hora_interno NUMERIC NOT NULL DEFAULT 50,
  margem_retentor_pct NUMERIC NOT NULL DEFAULT 50,
  custo_hora_referencia NUMERIC NOT NULL DEFAULT 15,

  -- Termos
  suporte_gratuito_dias INTEGER NOT NULL DEFAULT 30,
  validade_proposta_dias INTEGER NOT NULL DEFAULT 7,
  prazo_min_semanas INTEGER NOT NULL DEFAULT 1,
  prazo_max_semanas INTEGER NOT NULL DEFAULT 4,
  taxa_discovery NUMERIC NOT NULL DEFAULT 150,
  primeiros_clientes_gratis INTEGER NOT NULL DEFAULT 5,

  updated_at TIMESTAMPTZ DEFAULT now()
);
`, 'CREATE TABLE proposal_settings');

await runSQL(`
INSERT INTO public.proposal_settings DEFAULT VALUES
ON CONFLICT DO NOTHING;
`, 'INSERT default proposal_settings');

// Storage bucket
await createStorageBucket('propostas-pdfs');

console.log('\n✅ Migrations concluídas com sucesso!');
