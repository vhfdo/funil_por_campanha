// api/budget.js
// GET  -> retorna orçamento, gasto e restante de cada produto
// POST -> atualiza o "gasto" de um produto específico
// Exige sessão válida nos dois casos.

import { verifyToken } from '../lib/auth.js';
import { getValues, updateValues } from '../lib/sheets.js';

const SPREADSHEET_ID = '1o-R8sa_MVSNiT94KZ3VwTjRbAG_RB4mUIJlAYxKk8wI';
const SHEET_NAME = 'ORCAMENTO'; // ⚠️ confirme se é esse o nome da aba
// Estrutura esperada da aba (linha 1 = cabeçalho, dados a partir da linha 2):
// A: produto | B: orcamento | C: gasto | D: atualizado_em | E: atualizado_por

function checkAuth(req) {
  const secret = process.env.SESSION_SECRET;
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  return secret ? verifyToken(token, secret) : null;
}

export default async function handler(req, res) {
  const username = checkAuth(req);
  if (!username) {
    return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  }

  if (req.method === 'GET') {
    try {
      const rows = await getValues({ spreadsheetId: SPREADSHEET_ID, range: `${SHEET_NAME}!A2:E100` });
      const produtos = rows
        .filter(r => r[0]) // ignora linhas vazias
        .map((r, i) => ({
          linha: i + 2, // linha real na planilha (offset do A2)
          produto: r[0] || '',
          orcamento: parseFloat((r[1] || '0').toString().replace(',', '.')) || 0,
          gasto: parseFloat((r[2] || '0').toString().replace(',', '.')) || 0,
          atualizado_em: r[3] || '',
          atualizado_por: r[4] || '',
        }));
      return res.status(200).json({ produtos });
    } catch (err) {
      console.error('Falha ao ler orçamento:', err.message);
      return res.status(500).json({ error: 'Falha ao ler orçamento.' });
    }
  }

  if (req.method === 'POST') {
    const { produto, gasto } = req.body || {};
    if (!produto || gasto === undefined || gasto === null || isNaN(Number(gasto))) {
      return res.status(400).json({ error: 'Informe "produto" e "gasto" (número).' });
    }

    try {
      const rows = await getValues({ spreadsheetId: SPREADSHEET_ID, range: `${SHEET_NAME}!A2:A100` });
      const idx = rows.findIndex(r => (r[0] || '').trim().toLowerCase() === produto.trim().toLowerCase());
      if (idx === -1) {
        return res.status(404).json({ error: `Produto "${produto}" não encontrado na aba ${SHEET_NAME}.` });
      }
      const linha = idx + 2;
      const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

      await updateValues({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!C${linha}:E${linha}`,
        values: [[Number(gasto), agora, username]],
      });

      return res.status(200).json({ ok: true, produto, gasto: Number(gasto), atualizado_em: agora, atualizado_por: username });
    } catch (err) {
      console.error('Falha ao atualizar orçamento:', err.message);
      return res.status(500).json({ error: 'Falha ao atualizar orçamento.' });
    }
  }

  return res.status(405).json({ error: 'Método não permitido.' });
}
