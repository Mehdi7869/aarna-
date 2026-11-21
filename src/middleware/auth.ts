import type { Request, Response, NextFunction } from 'express';
import {
  getSupabaseAuthClient,
  getSupabaseConfigStatus,
  runWithSupabaseAccessToken,
} from '../lib/supabase.ts';

export interface AuthUser {
  id: string; // Supabase Auth UUID
  email: string;
  displayName: string | null;
}

export interface AuthRequest extends Request {
  authUser?: AuthUser;
  accessToken?: string;
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const config = getSupabaseConfigStatus();
  if (!config.configured) {
    res.status(422).json({
      error: `Supabase is not configured. Add ${config.missingKeys.join(' and ')} in AI Studio Secrets.`,
      missingKeys: config.missingKeys,
    });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({ error: 'Authentication token is missing.' });
    return;
  }

  try {
    const authClient = getSupabaseAuthClient();
    const { data, error } = await authClient.auth.getUser(token);

    if (error || !data.user) {
      res
        .status(401)
        .json({ error: 'Invalid or expired authentication session.' });
      return;
    }

    const meta = data.user.user_metadata || {};
    const displayName =
      typeof meta.full_name === 'string' && meta.full_name.trim()
        ? meta.full_name.trim()
        : typeof meta.name === 'string' && meta.name.trim()
          ? meta.name.trim()
          : null;

    req.authUser = {
      id: data.user.id,
      email: data.user.email || '',
      displayName,
    };
    req.accessToken = token;

    runWithSupabaseAccessToken(token, () => {
      next();
    });
  } catch (error) {
    console.error('Supabase token verification error:', error);
    res
      .status(401)
      .json({ error: 'Invalid or expired authentication session.' });
  }
};
