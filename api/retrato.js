// api/retrato.js
// Lê as células específicas da aba "[PERPÉTUO] Julho PFCC" e retorna
// os dados estruturados pro dashboard exibir no Retrato do Dia.
// Exige sessão válida.

import { verifyToken } from '../lib/auth.js';
import { getValues } from '../lib/sheets.js';

const SPREADSHEET_ID = '1sFLWhfBAeGmDnJ22TadZ0ZMC5AOZXBODXBrwKClENJk';
const ABA = '[PERPÉTUO] Julho PFCC';

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
    // Busca tudo de E6:H80 de uma vez só (1 chamada à API do Google)
    const range = `'${ABA}'!E6:H80`;
    const rows = await getValues({ spreadsheetId: SPREADSHEET_ID, range });

    // Helper: busca célula pelo índice de linha real (1-based) e coluna (E=0, F=1, G=2, H=3)
    function cel(linhaReal, col) {
      const idx = linhaReal - 6; // offset: E6 = índice 0
      return rows[idx]?.[col] ?? '';
    }

    const H = (linha) => cel(linha, 3); // coluna H
    const E = (linha) => cel(linha, 0); // coluna E (metas)

    const data = {
      // ── MQLs totais ──
      mqls: {
        valor: parseNum(H(36)),
        meta:  parseNum(E(36)),
      },

      // ── Investimento ──
      investimento:    { valor: parseNum(H(6)),  meta: parseNum(E(6))  },

      // ── Etapas do funil ──
      etapas: {
        aplicacao:   { valor: parseNum(H(46)), meta: parseNum(E(46)) },
        etapa1:      { valor: parseNum(H(47)), meta: parseNum(E(47)) },
        etapa2:      { valor: parseNum(H(48)), meta: parseNum(E(48)) },
        etapa3:      { valor: parseNum(H(49)), meta: parseNum(E(49)) },
        contatado:   { valor: parseNum(H(50)), meta: parseNum(E(50)) },
        oportunidade:{ valor: parseNum(H(51)), meta: parseNum(E(51)) },
        agendados:   { valor: parseNum(H(52)), meta: parseNum(E(52)) },
        noshow:      { valor: parseNum(H(53)), meta: parseNum(E(53)) },
        validacao:   { valor: parseNum(H(54)), meta: parseNum(E(54)) },
        negociacao:  { valor: parseNum(H(55)), meta: parseNum(E(55)) },
        inscricao:   { valor: parseNum(H(56)), meta: parseNum(E(56)) },
        descarte:    { valor: parseNum(H(62)), meta: parseNum(E(62)) },
      },

      // ── Taxas ──
      taxas: {
        conexao:           { valor: parseNum(H(65)), meta: parseNum(E(65)) },
        descarte:          { valor: parseNum(H(66)), meta: parseNum(E(66)) },
        sql:               { valor: parseNum(H(67)), meta: parseNum(E(67)) },
        agendamento:       { valor: parseNum(H(68)), meta: parseNum(E(68)) },
        noshow:            { valor: parseNum(H(69)), meta: parseNum(E(69)) },
        vendasEmCall:      { valor: parseNum(H(70)), meta: parseNum(E(70)) },
        vendasEmMqlsTotal: { valor: parseNum(H(71)), meta: parseNum(E(71)) },
        vendasEmMqlsReais: { valor: parseNum(H(72)), meta: parseNum(E(72)) },
      },

      // ── Vendas (quantidade) ──
      vendas: {
        valor: (parseNum(H(57)) || 0) + (parseNum(H(58)) || 0),
        meta:  76,
        eraPraEstar: Math.round(76 / 31 * new Date().getDate()),
      },

      // ── Faturamento e ROAS ──
      faturamento: {
        valor: (parseNum(H(73)) || 0) + (parseNum(H(74)) || 0),
        meta:  (parseNum(E(73)) || 0) + (parseNum(E(74)) || 0),
      },
      roas: {
        valor: (parseNum(H(79)) || 0) + (parseNum(H(80)) || 0),
        meta:  (parseNum(E(79)) || 0) + (parseNum(E(80)) || 0),
      },
    };

    return res.status(200).json(data);
  } catch (err) {
    console.error('Falha ao ler retrato:', err.message);
    return res.status(500).json({ error: 'Falha ao ler a planilha.' });
  }
}
