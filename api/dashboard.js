// api/dashboard.js
// Le todas as abas da planilha PERPETUO GERAL e devolve um JSON unico
// com os dados dos 5 produtos. O index carrega isso uma vez e filtra local.

import { verifyToken } from '../lib/auth.js';
import { getValues } from '../lib/sheets.js';

const SPREADSHEET_ID = '1yw82Xywh0pTDj10Kwq7jfpezE14gyBGwFsbDLiAXjYY';

// Cada produto sabe de quais abas puxar seus dados.
// As abas de investimento tem colunas diferentes — por isso o par [data, valor].
const PRODUTOS = {
  'PFCC BRASIL': {
    leads:  'LEADS PFCC BRASIL',
    etapa:  'ETAPA PFCC BRASIL',
    ganhos: 'GANHOS PFCC BRASIL',
    investimento: [
      { rede: 'Meta',     aba: 'INVESTIMENTO META PFCC BRASIL',     colData: 6, colValor: 7 },
      { rede: 'Google',   aba: 'INVESTIMENTO GOOGLE PFCC BRASIL',   colData: 5, colValor: 6 },
      { rede: 'LinkedIn', aba: 'INVESTIMENTO LINKEDIN PFCC BRASIL', colData: 6, colValor: 7 },
    ],
  },
  'PFCC MÉXICO': {
    leads:  'LEADS PFCC MÉXICO',
    etapa:  'ETAPA PFCC MÉXICO',
    ganhos: 'GANHOS PFCC MÉXICO',
    investimento: [
      { rede: 'Meta',     aba: 'INVESTIMENTO META PFCC MEXICO',     colData: 6, colValor: 7 },
      { rede: 'Google',   aba: 'INVESTIMENTO GOOGLE PFCC MEXICO',   colData: 5, colValor: 6 },
      { rede: 'LinkedIn', aba: 'INVESTIMENTO LINKEDIN PFCC MEXICO', colData: 6, colValor: 7 },
    ],
  },
  'PFCC CHILE': {
    leads:  'LEADS PFCC CHILE',
    etapa:  'ETAPA PFCC CHILE',
    ganhos: 'GANHOS PFCC CHILE',
    investimento: [
      { rede: 'Meta',     aba: 'INVESTIMENTO META PFCC CHILE',     colData: 6, colValor: 7 },
      { rede: 'Google',   aba: 'INVESTIMENTO GOOGLE PFCC CHILE',   colData: 5, colValor: 6 },
      { rede: 'LinkedIn', aba: 'INVESTIMENTO LINKEDIN PFCC CHILE', colData: 6, colValor: 7 },
    ],
  },
  'LEAN': {
    leads:  'LEADS LEAN',
    etapa:  'ETAPA LEAN',
    ganhos: 'GANHOS LEAN',
    investimento: [
      { rede: 'Meta',     aba: 'INVESTIMENTO META LEAN',     colData: 6, colValor: 7 },
      { rede: 'LinkedIn', aba: 'INVESTIMENTO LINKEDIN LEAN', colData: 6, colValor: 7 },
    ],
  },
  'CES': {
    leads:  'LEADS CES',
    etapa:  'ETAPA CES',
    ganhos: 'GANHOS CES',
    investimento: [
      { rede: 'Meta',     aba: 'INVESTIMENTO META CES',     colData: 7, colValor: 8 },
      { rede: 'LinkedIn', aba: 'INVESTIMENTO LINKEDIN CES', colData: 6, colValor: 7 },
    ],
  },
};

const ABA_BACKLOG  = 'BACKLOG MQL';
const ABA_REUNIOES = 'BACKLOG REUNIÕES';

function checkAuth(req) {
  const secret = process.env.SESSION_SECRET;
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return secret ? verifyToken(token, secret) : null;
}

function parseNum(v) {
  if (v === undefined || v === null || v === '') return 0;
  const s = String(v).replace(/[R$\s%]/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// Aceita 12/08/2026 ou 2026-08-12 e devolve sempre DD/MM
function normalizarData(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  if (s.includes('/')) {
    const [d, m] = s.split('/');
    if (!d || !m) return null;
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}`;
  }
  if (s.includes('-')) {
    const [, m, d] = s.split('-');
    if (!d || !m) return null;
    return `${d.slice(0, 2).padStart(2, '0')}/${m.padStart(2, '0')}`;
  }
  return null;
}

// Le uma aba e nunca derruba a resposta inteira se ela nao existir
async function lerAba(range) {
  try {
    return await getValues({ spreadsheetId: SPREADSHEET_ID, range: `'${range}'` });
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido.' });
  if (!checkAuth(req)) return res.status(401).json({ error: 'Sessão inválida ou expirada.' });

  try {
    // Monta a lista de todas as abas que precisamos e busca em paralelo
    const tarefas = [];
    const indice  = {};

    for (const [produto, cfg] of Object.entries(PRODUTOS)) {
      indice[produto] = { leads: tarefas.length };
      tarefas.push(lerAba(cfg.leads));

      indice[produto].etapa = tarefas.length;
      tarefas.push(lerAba(cfg.etapa));

      indice[produto].ganhos = tarefas.length;
      tarefas.push(lerAba(cfg.ganhos));

      indice[produto].investimento = [];
      for (const inv of cfg.investimento) {
        indice[produto].investimento.push({ ...inv, idx: tarefas.length });
        tarefas.push(lerAba(inv.aba));
      }
    }

    const idxBacklog = tarefas.length;
    tarefas.push(lerAba(ABA_BACKLOG));

    const idxReunioes = tarefas.length;
    tarefas.push(lerAba(ABA_REUNIOES));

    const resultados = await Promise.all(tarefas);

    // ── Monta cada produto ────────────────────────────────────────────────
    const produtos = {};

    for (const [nomeProduto, cfg] of Object.entries(PRODUTOS)) {
      const ref = indice[nomeProduto];

      // Leads por dia: Data | Leads | MQL
      const leadsPorDia = [];
      for (const linha of (resultados[ref.leads] || []).slice(1)) {
        const data = normalizarData(linha[0]);
        if (!data) continue;
        leadsPorDia.push({
          data,
          leads: parseNum(linha[1]),
          mqls:  parseNum(linha[2]),
        });
      }

      // Etapas do funil: Etapa | Qtd (a linha TOTAL fica de fora)
      const etapas = [];
      for (const linha of (resultados[ref.etapa] || []).slice(1)) {
        const nome = String(linha[0] || '').trim();
        if (!nome || nome.toUpperCase() === 'TOTAL') continue;
        etapas.push({ etapa: nome, qtd: parseNum(linha[1]) });
      }

      // Ganhos: uma linha por venda, com "Vale?" na ultima coluna
      const ganhos = [];
      for (const linha of (resultados[ref.ganhos] || []).slice(1)) {
        const data = normalizarData(linha[0]);
        if (!data) continue;
        ganhos.push({
          data,
          id:       linha[1] || '',
          nome:     linha[2] || '',
          email:    linha[3] || '',
          produto:  linha[4] || '',
          valor:    parseNum(linha[5]),
          campanha: linha[6] || '',
          source:   linha[7] || '',
          medium:   linha[8] || '',
          content:  linha[9] || '',
          term:     linha[10] || '',
          vale:     String(linha[11] || '').trim().toLowerCase(),
        });
      }

      // Investimento por rede e por dia
      const investPorRede = {};
      const investPorDia  = {};
      // Tambem guardamos por rede e por dia: sem isso, filtrar por rede no
      // dashboard nao teria como recalcular a linha de investimento do grafico.
      const investDiaRede = {};
      for (const inv of ref.investimento) {
        let totalRede = 0;
        investDiaRede[inv.rede] = {};
        for (const linha of (resultados[inv.idx] || []).slice(1)) {
          const data = normalizarData(linha[inv.colData]);
          const val  = parseNum(linha[inv.colValor]);
          if (!data || !val) continue;
          totalRede += val;
          investPorDia[data] = (investPorDia[data] || 0) + val;
          investDiaRede[inv.rede][data] = (investDiaRede[inv.rede][data] || 0) + val;
        }
        investPorRede[inv.rede] = totalRede;
      }

      const totalInvestimento = Object.values(investPorRede).reduce((s, v) => s + v, 0);
      const totalLeads = leadsPorDia.reduce((s, d) => s + d.leads, 0);
      const totalMqls  = leadsPorDia.reduce((s, d) => s + d.mqls, 0);

      // So conta faturamento das vendas marcadas como "sim" na coluna Vale?
      const ganhosValidos  = ganhos.filter(g => g.vale === 'sim');
      const totalGanhos    = ganhosValidos.length;
      const faturamento    = ganhosValidos.reduce((s, g) => s + g.valor, 0);

      produtos[nomeProduto] = {
        leadsPorDia,
        etapas,
        ganhos,
        investPorRede,
        investPorDia,
        investDiaRede,
        kpis: {
          leads:        totalLeads,
          mqls:         totalMqls,
          investimento: totalInvestimento,
          ganhos:       totalGanhos,
          faturamento,
          roas: totalInvestimento ? faturamento / totalInvestimento : 0,
          // MQL e' subconjunto de leads: CPL divide so por leads
          cpl:   totalLeads ? totalInvestimento / totalLeads : 0,
          cpmql: totalMqls   ? totalInvestimento / totalMqls   : 0,
          cac:   totalGanhos ? totalInvestimento / totalGanhos : 0,
        },
      };
    }

    // ── Backlog: uma linha por lead, de todos os produtos ─────────────────
    const backlog = [];
    for (const linha of (resultados[idxBacklog] || []).slice(1)) {
      if (!linha[0]) continue;
      backlog.push({
        id:          linha[0],
        produto:     linha[1]  || '',
        nomeProduto: linha[2]  || '',
        nome:        linha[3]  || '',
        email:       linha[4]  || '',
        cargo:       linha[5]  || '',
        mql:         String(linha[6] || '').trim() !== '',
        funil:       linha[7]  || '',
        reaplicacao: String(linha[8] || '').trim() !== '',
        etapa:       linha[9]  || '',
        proprietario:linha[10] || '',
        status:      linha[11] || '',
        valor:       parseNum(linha[12]),
        aplicacao:   linha[13] || '',
        campanha:    linha[14] || '',
        source:      linha[15] || '',
      });
    }

    // ── Reunioes: mesma estrutura do backlog ─────────────────────────────
    const reunioes = [];
    for (const linha of (resultados[idxReunioes] || []).slice(1)) {
      if (!linha[0]) continue;
      reunioes.push({
        id:           linha[0],
        produto:      linha[1]  || '',
        nome:         linha[3]  || '',
        cargo:        linha[5]  || '',
        mql:          String(linha[6] || '').trim() !== '',
        funil:        linha[7]  || '',
        etapa:        linha[8]  || '',
        proprietario: linha[9]  || '',
        status:       linha[10] || '',
        valor:        parseNum(linha[11]),
        dataReuniao:  linha[12] || '',
        tipo:         linha[13] || '',
        realizada:    String(linha[14] || '').trim() !== '',
        assunto:      linha[15] || '',
        campanha:     linha[17] || '',
        source:       linha[18] || '',
      });
    }

    return res.status(200).json({
      atualizadoEm: new Date().toISOString(),
      produtos,
      backlog,
      reunioes,
    });

  } catch (err) {
    console.error('dashboard error:', err.message);
    return res.status(500).json({ error: 'Falha ao ler a planilha.' });
  }
}
