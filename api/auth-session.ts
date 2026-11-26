import { setCorsHeaders, signUserSessionToken } from './_lib/auth.js';

type OAuthProvider = 'google' | 'kakao' | 'naver';

async function verifyOAuthProviderToken(
  provider: OAuthProvider,
  accessToken: string
): Promise<{ ok: boolean; userId?: string; error?: string }> {
  try {
    if (provider === 'google') {
      const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) return { ok: false, error: `Google OAuth verification failed (${resp.status})` };
      const profile = (await resp.json()) as { sub?: string };
      if (!profile.sub) return { ok: false, error: 'Missing Google sub' };
      return { ok: true, userId: `google_${profile.sub}` };
    }

    if (provider === 'kakao') {
      const resp = await fetch('https://kapi.kakao.com/v2/user/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) return { ok: false, error: `Kakao OAuth verification failed (${resp.status})` };
      const profile = (await resp.json()) as { id?: string | number };
      if (!profile.id) return { ok: false, error: 'Missing Kakao id' };
      return { ok: true, userId: `kakao_${String(profile.id)}` };
    }

    if (provider === 'naver') {
      const resp = await fetch('https://openapi.naver.com/v1/nid/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) return { ok: false, error: `Naver OAuth verification failed (${resp.status})` };
      const data = (await resp.json()) as { response?: { id?: string } };
      const naverId = data?.response?.id;
      if (!naverId) return { ok: false, error: 'Missing Naver id' };
      return { ok: true, userId: `naver_${naverId}` };
    }

    return { ok: false, error: 'Unsupported provider' };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'OAuth verification request failed' };
  }
}

export default async function handler(req: any, res: any) {
  setCorsHeaders(res, 'POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const provider = String(body.provider || '').trim() as OAuthProvider;
  const accessToken = String(body.accessToken || '').trim();

  if (!['google', 'kakao', 'naver'].includes(provider)) {
    return res.status(400).json({ error: 'Invalid provider' });
  }
  if (!accessToken) {
    return res.status(401).json({ error: 'Missing provider accessToken' });
  }

  const verified = await verifyOAuthProviderToken(provider, accessToken);
  if (!verified.ok || !verified.userId) {
    return res.status(401).json({ error: verified.error || 'OAuth verification failed' });
  }

  const token = signUserSessionToken(verified.userId, provider);
  if (!token) {
    return res.status(500).json({ error: 'Session signing not configured on server' });
  }
  return res.status(200).json({ token, userId: verified.userId });
}
