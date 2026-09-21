// lib/sheets.js
// Registra cada login bem-sucedido numa aba do Google Sheets, usando o mesmo
// service account já usado nas automações Python (funil_denise.py etc).
// Não usa nenhuma biblioteca externa (googleapis) — assina o JWT manualmente
// com o módulo "crypto" nativo do Node, pra não precisar de build step no Vercel.

import crypto from 'crypto';

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

// O token do Google vale uma hora. Antes ele era pedido de novo a cada
// leitura: um carregamento do dashboard lia 45 abas e fazia 45 pedidos de
// token alem das 45 leituras — 90 chamadas, lentas, e cutucando o limite
// de emissao de token do Google.
//
// O cache vive enquanto a funcao do Vercel estiver quente. Renovamos um
// minuto antes do vencimento pra nenhuma leitura pegar o token expirando
// no meio do caminho.
let tokenCache = { token: null, expira: 0 };

async function getAccessToken(credentialsJson) {
  const agora = Math.floor(Date.now() / 1000);
  if (tokenCache.token && tokenCache.expira - 60 > agora) {
    return tokenCache.token;
  }
  const token = await pedirToken(credentialsJson);
  tokenCache = { token, expira: agora + 3600 };
  return token;
}

async function pedirToken(credentialsJson) {
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

// Lê um range qualquer da planilha, retornando os valores brutos (array de arrays).
export async function getValues({ spreadsheetId, range }) {
  const credentialsJson = process.env.GOOGLE_CREDENTIALS;
  if (!credentialsJson) throw new Error('GOOGLE_CREDENTIALS não configurado na Vercel.');

  const accessToken = await getAccessToken(credentialsJson);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Falha ao ler a planilha (${res.status}): ${errBody}`);
  }
  const data = await res.json();
  return data.values || [];
}

// Nomes de todas as abas da planilha. Uma requisicao so.
export async function getSheetTitles({ spreadsheetId }) {
  const credentialsJson = process.env.GOOGLE_CREDENTIALS;
  if (!credentialsJson) throw new Error('GOOGLE_CREDENTIALS não configurado na Vercel.');

  const accessToken = await getAccessToken(credentialsJson);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`
            + `?fields=sheets.properties.title`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Falha ao listar as abas (${res.status}): ${errBody}`);
  }
  const data = await res.json();
  return (data.sheets || []).map(s => s.properties.title);
}

// Le varias abas numa UNICA requisicao, devolvendo na mesma ordem pedida.
//
// Existe por causa da cota do Google Sheets: 60 leituras por minuto por
// usuario. Com uma requisicao por aba, o dashboard fazia 45 por
// carregamento — uma recarga ja estourava, e as abas que passavam do
// limite voltavam vazias.
//
// ATENCAO: o batchGet falha INTEIRO se qualquer range apontar pra aba que
// nao existe. Quem chama precisa filtrar antes — ver lerAbas no
// dashboard.js, que confere os nomes com getSheetTitles.
export async function batchGetValues({ spreadsheetId, ranges }) {
  if (!ranges || !ranges.length) return [];

  const credentialsJson = process.env.GOOGLE_CREDENTIALS;
  if (!credentialsJson) throw new Error('GOOGLE_CREDENTIALS não configurado na Vercel.');

  const accessToken = await getAccessToken(credentialsJson);
  const qs = ranges.map(r => 'ranges=' + encodeURIComponent(r)).join('&');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`
            + `/values:batchGet?${qs}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Falha ao ler a planilha em lote (${res.status}): ${errBody}`);
  }
  const data = await res.json();
  return (data.valueRanges || []).map(v => v.values || []);
}

// Escreve num range específico e conhecido (diferente de appendRows, que
// calcula a próxima linha vazia — aqui o range já é exato, ex: "ORCAMENTO!C3").
export async function updateValues({ spreadsheetId, range, values }) {
  const credentialsJson = process.env.GOOGLE_CREDENTIALS;
  if (!credentialsJson) throw new Error('GOOGLE_CREDENTIALS não configurado na Vercel.');

  const accessToken = await getAccessToken(credentialsJson);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Falha ao atualizar a planilha (${res.status}): ${errBody}`);
  }
}

// Escreve N linhas na próxima posição vazia de uma aba, sempre calculando
// a linha manualmente (em vez de usar o endpoint "append" com auto-detect,
// que já causou bagunça de coluna antes). "rows" é um array de arrays,
// ex: [[valA,valB,valC], [valA,valB,valC]] — todas do mesmo tamanho.
export async function appendRows({ spreadsheetId, sheetName, rows }) {
  if (!rows || !rows.length) return;

  const credentialsJson = process.env.GOOGLE_CREDENTIALS;
  if (!credentialsJson) throw new Error('GOOGLE_CREDENTIALS não configurado na Vercel.');

  const accessToken = await getAccessToken(credentialsJson);

  // 1. Descobre a próxima linha vazia olhando a coluna A.
  const readRange = `${sheetName}!A:A`;
  const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(readRange)}`;
  const readRes = await fetch(readUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!readRes.ok) {
    const errBody = await readRes.text();
    throw new Error(`Falha ao ler a planilha (${readRes.status}): ${errBody}`);
  }
  const readData = await readRes.json();
  const nextRow = (readData.values?.length || 0) + 1;
  const lastRow = nextRow + rows.length - 1;
  const numCols = rows[0].length;
  const lastColLetter = String.fromCharCode('A'.charCodeAt(0) + numCols - 1);

  // 2. Escreve todas as linhas de uma vez, num único bloco A:{lastCol}.
  const writeRange = `${sheetName}!A${nextRow}:${lastColLetter}${lastRow}`;
  const writeUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(writeRange)}?valueInputOption=USER_ENTERED`;

  const writeRes = await fetch(writeUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: rows }),
  });

  if (!writeRes.ok) {
    const errBody = await writeRes.text();
    throw new Error(`Falha ao gravar na planilha (${writeRes.status}): ${errBody}`);
  }
}

// Mantido por compatibilidade — grava uma linha de log de acesso.
export async function appendLoginLog({ spreadsheetId, sheetName, username, ip, userAgent }) {
  const timestamp = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  await appendRows({
    spreadsheetId,
    sheetName,
    rows: [[timestamp, username, ip, userAgent]],
  });
}
