// api/pipedrive.js
// Proxy serverless: roda no servidor da Vercel, nunca no navegador.
// Recebe "path" (ex: "deals", "stages", "deals/123/changelog") + demais
// query params do front-end, injeta o api_token (via env var) e repassa
// a chamada pra API real do Pipedrive. O token NUNCA chega no navegador.

export default async function handler(req, res) {
  const { path, ...query } = req.query;

  if (!path) {
    return res.status(400).json({ error: 'Parâmetro "path" é obrigatório. Ex: ?path=deals&filter_id=123' });
  }

  const token = process.env.PIPEDRIVE_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'PIPEDRIVE_TOKEN não configurado nas Environment Variables da Vercel.' });
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      value.forEach(v => params.append(key, v));
    } else {
      params.append(key, value);
    }
  }
  params.set('api_token', token);

  const url = `https://api.pipedrive.com/v1/${path}?${params.toString()}`;

  try {
    const pdRes = await fetch(url);
    const data = await pdRes.json();
    res.status(pdRes.status).json(data);
  } catch (err) {
    res.status(500).json({ error: `Erro ao chamar Pipedrive: ${err.message}` });
  }
}
