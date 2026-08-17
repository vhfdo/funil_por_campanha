// api/login.js
// Autenticação via Microsoft Entra ID (SSO).
//
// O navegador faz o login com a Microsoft e manda pra cá o id_token que ela
// devolveu. Aqui conferimos se esse token é legítimo — assinatura, emissor,
// destinatário e validade — e só então emitimos o token de sessão do
// dashboard, que é o mesmo de antes. Nada mudou do lado do index.html.

import crypto from 'crypto';
import { signToken } from '../lib/auth.js';
import { appendLoginLog } from '../lib/sheets.js';

const TENANT_ID = 'ea06a4f8-af74-49ad-ade9-90eedd9d720e';
const CLIENT_ID = '85f7de7e-7983-4c0f-92c2-376cfb34df68';
const DOMINIO   = 'boardacademy.com.br';

const LOG_SPREADSHEET_ID = '1o-R8sa_MVSNiT94KZ3VwTjRbAG_RB4mUIJlAYxKk8wI';
const LOG_SHEET_NAME     = 'ACESSOS';

// Chaves públicas da Microsoft, guardadas em memória por 1h.
// Sem cache, cada login faria uma requisição extra pra Microsoft.
let cacheChaves = { chaves: null, expira: 0 };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  const { idToken } = req.body || {};
  if (!idToken) {
    return res.status(400).json({ error: 'Token não recebido.' });
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'SESSION_SECRET não configurado na Vercel.' });
  }

  let dados;
  try {
    dados = await validarTokenMicrosoft(idToken);
  } catch (err) {
    console.error('Token da Microsoft recusado:', err.message);
    return res.status(401).json({ error: 'Não foi possível validar sua identidade.' });
  }

  // Só gente da casa
  const email = (dados.preferred_username || dados.email || '').toLowerCase();
  if (!email.endsWith('@' + DOMINIO)) {
    return res.status(403).json({
      error: `Acesso restrito a contas @${DOMINIO}.`,
    });
  }

  // O nome de usuário passa a ser o e-mail, que é único e rastreável
  const username = email;
  const nome     = dados.name || email.split('@')[0];
  const token    = signToken(username, secret);

  // Log de acesso — falhar aqui não impede o login
  try {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
               || req.socket?.remoteAddress || '';
    await appendLoginLog({
      spreadsheetId: LOG_SPREADSHEET_ID,
      sheetName: LOG_SHEET_NAME,
      username,
      ip,
      userAgent: req.headers['user-agent'] || '',
    });
  } catch (err) {
    console.error('Falha ao registrar log de acesso:', err.message);
  }

  return res.status(200).json({ token, username: nome, email });
}

// ─────────────────────────────────────────────────────────────────────────────

async function validarTokenMicrosoft(idToken) {
  const partes = idToken.split('.');
  if (partes.length !== 3) throw new Error('formato inválido');

  const [cabecalhoB64, payloadB64, assinaturaB64] = partes;
  const cabecalho = JSON.parse(Buffer.from(cabecalhoB64, 'base64url').toString());
  const payload   = JSON.parse(Buffer.from(payloadB64,   'base64url').toString());

  // ── 1. A assinatura é mesmo da Microsoft? ──
  // Ela publica as chaves públicas e as rotaciona periodicamente; o 'kid'
  // do cabeçalho diz qual foi usada.
  const chaves = await buscarChaves();
  const chave  = chaves.find(k => k.kid === cabecalho.kid);
  if (!chave) throw new Error('chave de assinatura desconhecida');

  const publicKey = crypto.createPublicKey({ key: chave, format: 'jwk' });
  const assinaturaOk = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${cabecalhoB64}.${payloadB64}`),
    publicKey,
    Buffer.from(assinaturaB64, 'base64url'),
  );
  if (!assinaturaOk) throw new Error('assinatura não confere');

  // ── 2. O token é pra este app, deste tenant, e ainda vale? ──
  // Sem essas conferências, um token legítimo de OUTRO aplicativo
  // Microsoft seria aceito aqui.
  if (payload.aud !== CLIENT_ID) throw new Error('token emitido para outro aplicativo');
  if (payload.tid !== TENANT_ID) throw new Error('token de outro diretório');

  const agora = Math.floor(Date.now() / 1000);
  if (payload.exp && agora > payload.exp) throw new Error('token expirado');
  if (payload.nbf && agora < payload.nbf - 60) throw new Error('token ainda não válido');

  const emissorEsperado = `https://login.microsoftonline.com/${TENANT_ID}/v2.0`;
  if (payload.iss !== emissorEsperado) throw new Error('emissor inesperado');

  return payload;
}

async function buscarChaves() {
  if (cacheChaves.chaves && Date.now() < cacheChaves.expira) {
    return cacheChaves.chaves;
  }
  const r = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`
  );
  if (!r.ok) throw new Error('não consegui buscar as chaves da Microsoft');

  const { keys } = await r.json();
  cacheChaves = { chaves: keys, expira: Date.now() + 60 * 60 * 1000 };
  return keys;
}
