// api/retrato.js
// Lê as células específicas da aba "[PERPÉTUO] Julho PFCC" e retorna
// os dados estruturados pro dashboard exibir no Retrato do Dia.
// Exige sessão válida.

import { verifyToken } from '../lib/auth.js';
import { getValues } from '../lib/sheets.js';

const SPREADSHEET_ID      = '1sFLWhfBAeGmDnJ22TadZ0ZMC5AOZXBODXBrwKClENJk';
const SPREADSHEET_ID_PIPE = '1Evtto8jEIQ6_239Ad-4jP_pYa1twc8iY4XWfIjgEARo';
const ABA                 = '[PERPÉTUO] Julho PFCC';
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
    // Busca os dois em paralelo
    const [rows, rowsRetrato] = await Promise.all([
      getValues({ spreadsheetId: SPREADSHEET_ID,      range: `'${ABA}'!E6:H80` }),
      // ✅ A:B — Python agora grava só nome (A) + qtd (B), sem data
      getValues({ spreadsheetId: SPREADSHEET_ID_PIPE, range: `${ABA_RETRATO}!A:B` }),
    ]);

    // Helper: busca célula pelo índice de linha real (1-based) e coluna (E=0, F=1, G=2, H=3)
    function cel(linhaReal, col) {
      const idx = linhaReal - 6; // offset: E6 = índice 0
      return rows[idx]?.[col] ?? '';
    }

    const H = (linha) => cel(linha, 3); // coluna H
    const E = (linha) => cel(linha, 0); // coluna E (metas)

    // Monta mapa de etapa → quantidade do RETRATO DIA
    // Formato: col A = nome da etapa, col B = quantidade
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
      // ── MQLs totais ──
      mqls: {
        valor: parseNum(H(36)),
        meta:  parseNum(E(36)),
        eraPraEstar: eraPraEstar(parseNum(E(36))),
      },

      // ── Investimento ──
      investimento: {
        valor: parseNum(H(6)),
        meta:  parseNum(E(6)),
      },

      // ── Etapas do funil — vêm do RETRATO DIA (snapshot atual) ──
      etapas: {
        aplicacao:   { valor: retratoVal('aplicacao'),                   meta: parseNum(E(46)) },
        etapa1:      { valor: retratoVal('etapa 1'),                     meta: parseNum(E(47)) },
        etapa2:      { valor: retratoVal('etapa 2'),                     meta: parseNum(E(48)) },
        etapa3:      { valor: retratoVal('etapa 3'),                     meta: parseNum(E(49)) },
        contatado:   { valor: retratoVal('contatado'),                   meta: parseNum(E(50)) },
        oportunidade:{ valor: retratoVal('oportunidade'),                meta: parseNum(E(51)) },
        agendados:   { valor: retratoVal('agendados'),                   meta: parseNum(E(52)) },
        noshow:      { valor: retratoVal('no show'),                     meta: parseNum(E(53)) },
        validacao:   { valor: retratoVal('validacao de reuniao'),        meta: parseNum(E(54)) },
        negociacao:  { valor: retratoVal('negociacao'),                  meta: parseNum(E(55)) },
        inscricao:   { valor: retratoVal('inscricao em andamento'),      meta: parseNum(E(56)) },
        descarte:    { valor: retratoVal('descarte'),                    meta: parseNum(E(62)) },
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
        eraPraEstar: eraPraEstar(76),
      },

      // ── Faturamento e ROAS ──
      faturamento: {
        valor: (parseNum(H(73)) || 0) + (parseNum(H(74)) || 0),
        meta:  (parseNum(E(73)) || 0) + (parseNum(E(74)) || 0),
        eraPraEstar: eraPraEstar((parseNum(E(73)) || 0) + (parseNum(E(74)) || 0)),
      },
      roas: {
        valor: (parseNum(H(79)) || 0) + (parseNum(H(80)) || 0),
        meta:  (parseNum(E(79)) || 0) + (parseNum(E(80)) || 0),
      },

      // ── Ticket médio ──
      ticketMedio: {
        valor: parseNum(H(75)) !== null && parseNum(H(76)) !== null
          ? ((parseNum(H(75)) || 0) + (parseNum(H(76)) || 0)) / 2
          : null,
        meta: parseNum(E(76)),
      },
    };

    return res.status(200).json(data);
  } catch (err) {
    console.error('Falha ao ler retrato:', err.message);
    return res.status(500).json({ error: 'Falha ao ler a planilha.' });
  }
}
