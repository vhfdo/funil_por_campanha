// lib/sheets.js
// Registra cada login bem-sucedido numa aba do Google Sheets, usando o mesmo
// service account já usado nas automações Python (funil_denise.py etc).
// Não usa nenhuma biblioteca externa (googleapis) — assina o JWT manualmente
// com o módulo "crypto" nativo do Node, pra não precisar de build step no Vercel.

import crypto from 'crypto';

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

async function getAccessToken(credentialsJson) {
  const creds = JSON.parse(credentialsJson);

  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(creds.private_key).toString('base64url');
  const jwt = `${unsigned}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error('Falha ao obter access_token do Google: ' + JSON.stringify(data));
  }
  return data.access_token;
}

// Adiciona uma linha na planilha de log de acessos.
// Não lança erro pra fora se o Google falhar — quem chamar decide se quer
// bloquear o login por causa disso (recomendo NÃO bloquear).
export async function appendLoginLog({ spreadsheetId, sheetName, username, ip, userAgent }) {
  const credentialsJson = process.env.GOOGLE_CREDENTIALS;
  if (!credentialsJson) throw new Error('GOOGLE_CREDENTIALS não configurado na Vercel.');

  const accessToken = await getAccessToken(credentialsJson);

  const timestamp = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const range = `${sheetName}!A:D`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [[timestamp, username, ip, userAgent]] }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Falha ao gravar log na planilha (${res.status}): ${errBody}`);
  }
}
