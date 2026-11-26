import crypto from 'node:crypto';

export const ADMIN_EMAIL = 'paedros@gmail.com';
export const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://johtqemdlprtbpohdkgu.supabase.co';

export function setCorsHeaders(res: any, methods = 'GET, POST, PUT, DELETE, OPTIONS') {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export async function verifyAdminToken(
  authHeader: string | undefined
): Promise<{ ok: boolean; email?: string; error?: string }> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false, error: 'Missing Bearer token' };
  }
  const token = authHeader.slice(7).trim();
  if (!token) return { ok: false, error: 'Empty token' };

  try {
    const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!resp.ok) {
      return { ok: false, error: `OAuth verification failed (${resp.status})` };
    }
    const profile = (await resp.json()) as { email?: string; email_verified?: boolean };
    const normalized = (profile.email || '').toLowerCase().trim();
    if (normalized !== ADMIN_EMAIL || profile.email_verified === false) {
      return { ok: false, error: 'Forbidden: admin only' };
    }
    return { ok: true, email: normalized };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'OAuth verification error' };
  }
}

export interface SessionClaims {
  userId: string;
  provider: string;
  exp: number;
}

function getSessionSecret(): string {
  return process.env.AUTH_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

export function signUserSessionToken(userId: string, provider: string, ttlSeconds = 60 * 60 * 24 * 30): string | null {
  const secret = getSessionSecret();
  if (!secret) return null;
  const payload: SessionClaims = {
    userId,
    provider,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionFromRequest(req: any): { ok: boolean; claims?: SessionClaims; error?: string } {
  const authHeader = typeof req?.headers?.authorization === 'string'
    ? req.headers.authorization
    : typeof req?.headers?.Authorization === 'string'
      ? req.headers.Authorization
      : undefined;
  return verifyUserSessionToken(authHeader);
}

export function verifyUserSessionToken(authHeader: string | undefined): { ok: boolean; claims?: SessionClaims; error?: string } {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false, error: 'Missing Bearer token' };
  }
  const token = authHeader.slice(7).trim();
  const parts = token.split('.');
  if (parts.length !== 2) {
    return { ok: false, error: 'Invalid session token format' };
  }
  const secret = getSessionSecret();
  if (!secret) {
    return { ok: false, error: 'Server session secret not configured' };
  }
  const [encoded, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, error: 'Invalid session signature' };
  }
  try {
    const claims = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionClaims;
    if (!claims.userId || !claims.exp || claims.exp < Math.floor(Date.now() / 1000)) {
      return { ok: false, error: 'Session expired' };
    }
    return { ok: true, claims };
  } catch {
    return { ok: false, error: 'Malformed session payload' };
  }
}
