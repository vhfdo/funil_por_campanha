// api/login.js
import { hashPassword, signToken } from '../lib/auth.js';
import { appendLoginLog } from '../lib/sheets.js';

// ⚠️ Confirme se o nome da aba é esse mesmo na sua planilha de log de acessos.
const LOG_SPREADSHEET_ID = '1o-R8sa_MVSNiT94KZ3VwTjRbAG_RB4mUIJlAYxKk8wI';
const LOG_SHEET_NAME = 'ACESSOS';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
  }

  // DASHBOARD_USERS é um JSON tipo: {"vitao":"<hash sha256>","fulano":"<hash sha256>"}
  let users;
  try {
    users = JSON.parse(process.env.DASHBOARD_USERS || '{}');
  } catch {
    return res.status(500).json({ error: 'DASHBOARD_USERS mal configurado na Vercel (JSON inválido).' });
  }

  const storedHash = users[username];
  if (!storedHash || storedHash !== hashPassword(password)) {
    return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'SESSION_SECRET não configurado na Vercel.' });
  }
  const token = signToken(username, secret);

  // Log de acesso — se falhar, não impede o login (só registra no console da Vercel)
  try {
    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
    const userAgent = req.headers['user-agent'] || '';
    await appendLoginLog({
      spreadsheetId: LOG_SPREADSHEET_ID,
      sheetName: LOG_SHEET_NAME,
      username,
      ip,
      userAgent,
    });
  } catch (err) {
    console.error('Falha ao registrar log de acesso:', err.message);
  }

  res.status(200).json({ token, username });
}
