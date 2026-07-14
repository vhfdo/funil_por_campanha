// api/pipedrive.js
// Proxy serverless: roda no servidor da Vercel, nunca no navegador.
// Recebe "path" (ex: "deals", "stages", "deals/123/changelog") + demais
// query params do front-end, injeta o api_token (via env var) e repassa
// a chamada pra API real do Pipedrive. O token NUNCA chega no navegador.

import { verifyToken } from '../lib/auth.js';

export default async function handler(req, res) {
  // Exige um token de sessão válido (gerado pelo /api/login) antes de
  // repassar qualquer chamada real ao Pipedrive.
  const sessionSecret = process.env.SESSION_SECRET;
  const authHeader = req.headers.authorization || '';
  const sessionToken = authHeader.replace(/^Bearer\s+/i, '');
  const username = sessionSecret ? verifyToken(sessionToken, sessionSecret) : null;
  if (!username) {
    return res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
  }

  const { path, ...query } = req.query;

  if (!path) {
    return res.status(400).json({ error: 'Parâmetro "path" é obrigatório. Ex: ?path=deals&filter_id=123' });
  }

  const pipedriveToken = process.env.PIPEDRIVE_TOKEN;
  if (!pipedriveToken) {
    return res.status(500).json({ error: 'PIPEDRIVE_TOKEN não configurado nas Environment Variables da Vercel.' });
  }

  // Monta a query string repassando tudo que o front mandou + o token
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    // query params podem vir como array se repetidos — trata os dois casos
    if (Array.isArray(value)) {
      value.forEach(v => params.append(key, v));
    } else {
      params.append(key, value);
    }
  }
  params.set('api_token', pipedriveToken);

  const url = `https://api.pipedrive.com/v1/${path}?${params.toString()}`;

  try {
    const pdRes = await fetch(url);
    const data = await pdRes.json();
    // Repassa o mesmo status code que o Pipedrive retornou (200, 404, 401, etc)
    res.status(pdRes.status).json(data);
  } catch (err) {
    res.status(500).json({ error: `Erro ao chamar Pipedrive: ${err.message}` });
  }
}
