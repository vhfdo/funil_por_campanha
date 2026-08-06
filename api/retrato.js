// api/retrato.js
import { verifyToken } from '../lib/auth.js';
import { getValues } from '../lib/sheets.js';

const SPREADSHEET_ID      = '1sFLWhfBAeGmDnJ22TadZ0ZMC5AOZXBODXBrwKClENJk';
const SPREADSHEET_ID_PIPE = '1Evtto8jEIQ6_239Ad-4jP_pYa1twc8iY4XWfIjgEARo';
const ABA                 = "[PERPÉTUO] Agosto PFCC";
const ABA_RETRATO         = 'RETRATO DIA';

function checkAuth(req) {
  const secret = process.env.SESSION_SECRET;
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  return secret ? verifyToken(token, secret) : null;
}

function parseNum(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).replace(/[R$\s%]/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido.' });

  const username = checkAuth(req);
  if (!username) return res.status(401).json({ error: 'Sessão inválida ou expirada.' });

  try {
    // Nome da aba com caracteres especiais: escapa aspas simples internas
    // e envolve em aspas simples no range
    const abaEscapada = ABA.replace(/'/g, "''");

    const [rows, rowsRetrato] = await Promise.all([
      getValues({ spreadsheetId: SPREADSHEET_ID,      range: `'${abaEscapada}'!F6:K70` }),
      getValues({ spreadsheetId: SPREADSHEET_ID_PIPE, range: `'${ABA_RETRATO}'!A:B` }),
    ]);

    // Range F6:K70 → F=0, G=1, H=2, I=3, J=4, K=5
    function cel(linhaReal, col) {
      const idx = linhaReal - 6;
      return rows[idx]?.[col] ?? '';
    }

    const K = (linha) => cel(linha, 5); // valores
    const F = (linha) => cel(linha, 0); // metas

    // Monta mapa do RETRATO DIA
    const retratoMap = {};
    for (const r of rowsRetrato) {
      const etapa = String(r[0] || '').trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g,'');
      const qtd = parseNum(r[1]);
      if (etapa && qtd !== null) retratoMap[etapa] = qtd;
    }

    function retratoVal(nomeEtapa) {
      const key = nomeEtapa.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
      return retratoMap[key] ?? null;
    }

    const hoje = new Date();
    const diaAtual = hoje.getDate();
    const diasNoMes = 31;

    function eraPraEstar(meta) {
      if (!meta) return null;
      return Math.round(meta / diasNoMes * diaAtual);
    }

    const data = {
      // ── Investimento ──
      investimento: {
        valor: parseNum(K(6)),
        meta:  parseNum(F(6)),
      },

      // ── MQLs ──
      mqls: {
        valor: parseNum(K(31)),
        meta:  parseNum(F(31)),
        eraPraEstar: eraPraEstar(parseNum(F(31))),
      },

      // ── Etapas do funil ──
      etapas: {
        aplicacao:   { valor: parseNum(K(32)),  meta: parseNum(F(32)) },
        etapa1:      { valor: parseNum(K(33)),  meta: null            },
        etapa2:      { valor: parseNum(K(34)),  meta: null            },
        etapa3:      { valor: parseNum(K(35)),  meta: null            },
        contatado:   { valor: parseNum(K(36)),  meta: parseNum(F(36)) },
        oportunidade:{ valor: parseNum(K(37)),  meta: parseNum(F(37)) },
        agendados:   { valor: parseNum(K(38)),  meta: parseNum(F(38)) },
        noshow:      { valor: parseNum(K(39)),  meta: parseNum(F(39)) },
        validacao:   { valor: parseNum(K(40)),  meta: parseNum(F(40)) },
        negociacao:  { valor: parseNum(K(41)),  meta: parseNum(F(41)) },
        inscricao:   { valor: parseNum(K(42)),  meta: parseNum(F(42)) },
      },

      // ── Vendas ──
      vendas: {
        valor: parseNum(K(44)),
        meta:  parseNum(F(44)),
      },

      // ── Taxas ──
      taxas: {
        conversaoPagina:   { valor: parseNum(K(50)), meta: parseNum(F(50)) },
        qualificacao:      { valor: parseNum(K(51)), meta: parseNum(F(51)) },
        conexao:           { valor: parseNum(K(52)), meta: parseNum(F(52)) },
        descarte:          { valor: parseNum(K(53)), meta: parseNum(F(53)) },
        sql:               { valor: parseNum(K(54)), meta: parseNum(F(54)) },
        agendamento:       { valor: parseNum(K(55)), meta: parseNum(F(55)) },
        noshow:            { valor: parseNum(K(56)), meta: parseNum(F(56)) },
        vendasEmCall:      { valor: parseNum(K(57)), meta: parseNum(F(57)) },
        vendasEmMqlsTotal: { valor: parseNum(K(58)), meta: parseNum(F(58)) },
        vendasEmMqlsReais: { valor: parseNum(K(59)), meta: parseNum(F(59)) },
      },

      // ── Faturamento ──
      faturamento: {
        valor: parseNum(K(61)),
        meta:  parseNum(F(61)),
        eraPraEstar: eraPraEstar(parseNum(F(61))),
      },

      // ── ROAS ──
      roas: {
        valor: parseNum(K(70)),
        meta:  parseNum(F(70)),
      },

      // ── Ticket médio ──
      ticketMedio: {
        valor: parseNum(K(65)),
        meta:  parseNum(F(65)),
      },
    };

    return res.status(200).json(data);
  } catch (err) {
    console.error('Falha ao ler retrato:', err.message);
    return res.status(500).json({ error: 'Falha ao ler a planilha.' });
  }
}
