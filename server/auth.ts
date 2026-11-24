import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { getSetting, setSetting, deleteSetting } from './db.ts';

const SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
    ? process.env.SESSION_SECRET
    : crypto.randomBytes(32).toString('hex');

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function hashPasswordScrypt(password: string, salt?: string): string {
  const actualSalt = salt ?? crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, actualSalt, 64).toString('hex');
  return `${actualSalt}:${derived}`;
}

function verifyPasswordScrypt(password: string, stored: string): boolean {
  const [salt, expectedHex] = stored.split(':');
  if (!salt || !expectedHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function constantTimeEquals(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

export function getAuthConfig(): { enabled: boolean; source: 'env' | 'db' | 'none' } {
  if (process.env.APP_PASSWORD && process.env.APP_PASSWORD.trim().length > 0) {
    return { enabled: true, source: 'env' };
  }
  const dbHash = getSetting('password_hash');
  if (dbHash) {
    return { enabled: true, source: 'db' };
  }
  return { enabled: false, source: 'none' };
}

export function verifyMasterPassword(candidate: string): boolean {
  if (typeof candidate !== 'string' || !candidate) return false;
  const envPass = process.env.APP_PASSWORD?.trim();
  if (envPass) {
    return constantTimeEquals(candidate, envPass);
  }
  const dbHash = getSetting('password_hash');
  if (dbHash) {
    return verifyPasswordScrypt(candidate, dbHash);
  }
  return false;
}

export function setDbPassword(newPassword: string): void {
  const hashed = hashPasswordScrypt(newPassword);
  setSetting('password_hash', hashed);
}

export function clearDbPassword(): void {
  deleteSetting('password_hash');
}

export const SESSION_COOKIE_NAME = 'dropkeep_session';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function getPasswordFingerprint(): string {
  const envPass = process.env.APP_PASSWORD?.trim();
  if (envPass) {
    return crypto.createHash('sha256').update(`env:${envPass}`).digest('hex').slice(0, 16);
  }
  const dbHash = getSetting('password_hash');
  if (dbHash) {
    return crypto.createHash('sha256').update(`db:${dbHash}`).digest('hex').slice(0, 16);
  }
  return '';
}

function isHttpsRequest(req: Request): boolean {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (req.secure || forwardedProto === 'https') return true;

  const origin = String(req.headers.origin || '').trim().toLowerCase();
  if (origin.startsWith('https://')) return true;

  const referer = String(req.headers.referer || '').trim().toLowerCase();
  if (referer.startsWith('https://')) return true;

  const appUrl = String(process.env.APP_URL || '').trim().toLowerCase();
  if (appUrl.startsWith('https://')) return true;

  return false;
}

export function getSessionCookie(req: Request): string {
  const raw = req.headers.cookie;
  if (!raw || typeof raw !== 'string') return '';
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    if (name === SESSION_COOKIE_NAME) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return part.slice(idx + 1).trim();
      }
    }
  }
  return '';
}

export function setSessionCookie(req: Request, res: Response, token: string): void {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
  ];
  if (isHttpsRequest(req)) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  // Omit Max-Age / Expires so the browser stores this as a session cookie
  // (survives page reloads & tabs, clears automatically on browser restart).
  res.append('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(req: Request, res: Response): void {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (isHttpsRequest(req)) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.append('Set-Cookie', parts.join('; '));
}

export function createSessionToken(): string {
  const payload = JSON.stringify({
    iat: Date.now(),
    exp: Date.now() + TOKEN_TTL_MS,
    pf: getPasswordFingerprint(),
    nonce: crypto.randomBytes(8).toString('hex'),
  });
  const encoded = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string): boolean {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [encoded, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return false;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
      exp?: number;
      pf?: string;
    };
    if (typeof parsed.exp !== 'number' || parsed.exp <= Date.now()) {
      return false;
    }
    const activeFp = getPasswordFingerprint();
    if (activeFp && parsed.pf !== activeFp) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function extractAuthFromRequest(req: Request): { token: string; via: 'bearer' | 'cookie' | 'none' } {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return { token: bearer, via: 'bearer' };
  }
  const cookieToken = getSessionCookie(req);
  if (cookieToken) {
    return { token: cookieToken, via: 'cookie' };
  }
  return { token: '', via: 'none' };
}

function isValidCookieMutationRequest(req: Request): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return true;

  const allowedHosts = new Set<string>();
  for (const candidate of [req.headers['x-forwarded-host'], req.headers.host]) {
    const host = String(candidate || '').split(',')[0].trim().toLowerCase();
    if (host) allowedHosts.add(host);
  }
  if (process.env.APP_URL) {
    try {
      allowedHosts.add(new URL(process.env.APP_URL).host.toLowerCase());
    } catch {
      // ignore invalid APP_URL
    }
  }

  const originHeader = req.headers.origin;
  let originMatches = false;
  if (typeof originHeader === 'string' && originHeader) {
    try {
      const originHost = new URL(originHeader).host.toLowerCase();
      if (allowedHosts.has(originHost)) {
        originMatches = true;
      } else {
        return false;
      }
    } catch {
      return false;
    }
  }

  const xrw = String(req.headers['x-requested-with'] || '').trim().toLowerCase();
  return originMatches || xrw === 'dropkeep' || xrw === 'xmlhttprequest';
}

export function requireAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const config = getAuthConfig();
  if (!config.enabled) {
    next();
    return;
  }

  const { token, via } = extractAuthFromRequest(req);
  if (!token || !verifySessionToken(token)) {
    res.status(401).json({ error: 'Сессия истекла или недействительна', authRequired: true });
    return;
  }

  if (via === 'cookie' && !isValidCookieMutationRequest(req)) {
    res.status(403).json({ error: 'Запрос отклонён проверкой источника' });
    return;
  }

  next();
}
