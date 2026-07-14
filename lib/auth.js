// lib/auth.js
// Funções compartilhadas de autenticação, usadas por api/login.js e api/pipedrive.js.
// Não é uma rota — fica fora da pasta /api de propósito.

import crypto from 'crypto';

// Gera o hash SHA-256 de uma senha (usado pra comparar com o que está
// guardado na env var DASHBOARD_USERS, sem nunca guardar senha em texto puro)
export function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Gera um token de sessão assinado, válido por 12h por padrão.
// Formato: base64(usuario:validade) + "." + assinatura HMAC
export function signToken(username, secret, ttlMs = 12 * 60 * 60 * 1000) {
  const expiry = Date.now() + ttlMs;
  const payload = `${username}:${expiry}`;
  const payloadB64 = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payloadB64}.${sig}`;
}

// Valida um token: confere a assinatura E se ainda não expirou.
// Retorna o username se for válido, ou null se for inválido/expirado.
export function verifyToken(token, secret) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadB64, sig] = token.split('.');
  let payload;
  try {
    payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  if (sig !== expectedSig) return null;

  const [username, expiryStr] = payload.split(':');
  const expiry = Number(expiryStr);
  if (!expiry || Date.now() > expiry) return null;
  return username;
}
