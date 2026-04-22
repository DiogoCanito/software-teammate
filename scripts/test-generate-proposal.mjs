/**
 * Teste end-to-end do pipeline /api/generate-proposal.
 * Insere dados mock, chama o endpoint, valida resultado.
 */
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env
fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n').forEach(line => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) return;
  const key = trimmed.slice(0, eqIdx).trim();
  const val = trimmed.slice(eqIdx + 1).trim();
  if (key && !(key in process.env)) process.env[key] = val;
});

const SUPABASE_URL = process.env.SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;

function sbPost(urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url  = new URL(SUPABASE_URL + urlPath);
    const req  = https.request({ hostname: url.hostname, path: url.pathname + url.search, method: 'POST',
      headers: { 'Authorization': `Bearer ${SRK}`, 'apikey': SRK, 'Content-Type': 'application/json', 'Prefer': 'return=representation', 'Content-Length': Buffer.byteLength(data) }
    }, res => { let b=''; res.on('data', d=>b+=d); res.on('end', ()=>resolve({ status: res.statusCode, data: JSON.parse(b) })); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function apiPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req  = http.request({ hostname: 'localhost', port: 3000, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => { let b=''; res.on('data', d=>b+=d); res.on('end', ()=>resolve({ status: res.statusCode, data: JSON.parse(b) })); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// 1. Criar proposta shell
const now = new Date();
const numero = `PC-TEST-${Date.now().toString(36).toUpperCase()}`;
const propostaRes = await sbPost('/rest/v1/propostas', {
  numero,
  nome:        'Lopes & Filhos Lda',
  cliente:     'Lopes & Filhos Lda',
  valor:       0,
  origem:      'ia',
  estado:      'rascunho',
  data_criacao: now.toISOString().split('T')[0],
});

if (propostaRes.status >= 300) {
  console.error('Falha ao criar proposta shell:', propostaRes.data);
  process.exit(1);
}

const proposta_id = propostaRes.data[0]?.id;
console.log(`✓ Proposta shell criada: ${proposta_id}`);

// 2. Criar form_responses mock
const formRes = await sbPost('/rest/v1/proposal_form_responses', {
  proposta_id,
  nome_empresa:        'Lopes & Filhos Lda',
  nicho:               'Construção Civil',
  tipo_solucao_inicial:'automacoes',
  nome_contacto:       'António Lopes',
  cargo_contacto:      'Sócio-Gerente',
  email_contacto:      'antonio@lopesfilhos.pt',
  area_negocio:        'Empresa de construção civil com 15 funcionários. Fazemos obras de habitação e reabilitação.',
  numero_pessoas:      15,
  equipas_separadas:   true,
  equipas_lista:       ['Comercial', 'Operacional', 'Administrativa'],
  tipo_mercado:        'B2B',
  ferramentas_digitais:['Faturação', 'Folhas de cálculo'],
  sistemas_integrados: 'Não, é tudo manual',
  dia_tipico:          'Todos os dias enviamos orçamentos por email manualmente, atualizamos folhas de Excel com materiais e mão de obra, e ligamos a fornecedores para confirmar preços.',
  tarefas_repetitivas: 'Criação de orçamentos, atualização de Excel com horas de trabalho, envio de relatórios de obra aos clientes.',
  copiar_colar_nivel:  'Muito',
  pedidos_manuais:     'Sim, muitos',
  tres_tarefas_eliminar: 'Orçamentos manuais, relatórios de obra, controlo de horas em Excel',
  tarefas_detalhadas: [
    { nome: 'Criar orçamento de obra', frequencia: 'Semanal', vezes: 3, tempo_min: 90, pessoas: 2 },
    { nome: 'Relatório de progresso de obra', frequencia: 'Semanal', vezes: 5, tempo_min: 45, pessoas: 1 },
    { nome: 'Controlo de horas em Excel', frequencia: 'Diária', vezes: 1, tempo_min: 30, pessoas: 1 },
  ],
  custo_hora_colaboradores: 20,
  impacto_mudanca:     'A equipa comercial poderia responder muito mais rápido aos clientes e fazer mais orçamentos.',
  crescimento_percepcao:'Não, os processos travam',
  decisor:             'Só eu',
  orcamento_definido:  'Não, queremos avaliar primeiro',
  urgencia:            'Curto prazo (1-3 meses)',
  preocupacao_principal:'O tempo que perdemos em papelada em vez de estar em obra.',
  tipo_solucao_final:  'automacoes',
  notas_internas:      'Cliente com muito potencial. Muito manual, espaço enorme para automação.',
});

if (formRes.status >= 300) {
  console.error('Falha ao criar form_responses:', formRes.data);
  process.exit(1);
}
console.log('✓ Form responses inseridos');

// 3. Chamar endpoint
console.log('\n→ Chamando /api/generate-proposal (pode demorar 30-60s)...');
const genRes = await apiPost('/api/generate-proposal', { proposta_id });

console.log(`\n Status: ${genRes.status}`);
if (genRes.status === 200) {
  console.log('✅ Proposta gerada com sucesso!');
  console.log('  PDF Técnica:   ', genRes.data.pdf_tecnica_url);
  console.log('  PDF Comercial: ', genRes.data.pdf_comercial_url);
  console.log('  Valor total:   ', genRes.data.valor_total, '€');
  console.log('  ROI estimado:  ', genRes.data.roi_estimado, 'x');
  console.log('\n proposta_id:', proposta_id);
} else {
  console.error('✗ Erro:', JSON.stringify(genRes.data, null, 2));
}
