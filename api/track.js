// api/track.js
// Recebe um lote de eventos de uso do dashboard (cliques, filtros, etc)
// e grava cada um como uma linha na aba de eventos da planilha.
// Exige sessão válida — mesma trava usada em api/pipedrive.js.

import { verifyToken } from '../lib/auth.js';
import { appendRows } from '../lib/sheets.js';

const LOG_SPREADSHEET_ID = '1o-R8sa_MVSNiT94KZ3VwTjRbAG_RB4mUIJlAYxKk8wI';
const EVENTS_SHEET_NAME = 'EVENTOS'; // ⚠️ confirme se é esse o nome da aba

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  const sessionSecret = process.env.SESSION_SECRET;
  const authHeader = req.headers.authorization || '';
  const sessionToken = authHeader.replace(/^Bearer\s+/i, '');
  const username = sessionSecret ? verifyToken(sessionToken, sessionSecret) : null;
  if (!username) {
    return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  }

  const { events } = req.body || {};
  if (!Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ error: 'Nenhum evento recebido.' });
  }

  // Limita o tamanho do lote pra evitar abuso/erro de payload gigante
  const eventsSlice = events.slice(0, 200);

  const rows = eventsSlice.map(ev => [
    ev.timestamp || new Date().toISOString(),
    username,
    ev.type || 'desconhecido',
    typeof ev.details === 'string' ? ev.details : JSON.stringify(ev.details || {}),
  ]);

  try {
    await appendRows({
      spreadsheetId: LOG_SPREADSHEET_ID,
      sheetName: EVENTS_SHEET_NAME,
      rows,
    });
  } catch (err) {
    console.error('Falha ao gravar eventos:', err.message);
    // Não retorna erro pro front — perder um log de clique não deve travar o uso.
    return res.status(200).json({ ok: false, warning: 'Eventos recebidos mas não gravados.' });
  }

  res.status(200).json({ ok: true, gravados: rows.length });
}
