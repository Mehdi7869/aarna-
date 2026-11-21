import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

interface RequestSupabaseContext {
  accessToken: string;
  client: SupabaseClient | null;
}

const requestContextStorage = new AsyncLocalStorage<RequestSupabaseContext>();

let cachedServiceAdminClient: SupabaseClient | null = null;
let cachedAuthClient: SupabaseClient | null = null;
let cachedConfigFingerprint = '';
let bucketVerified = false;

export interface SupabaseConfigStatus {
  configured: boolean;
  missingKeys: string[];
  bucket: string;
  mode: 'rls-publishable' | 'service-role' | 'unconfigured';
}

const VALID_BUCKET_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/i;

export function getStorageBucketName(): string {
  const configured = process.env.SUPABASE_STORAGE_BUCKET?.trim() || '';
  if (configured && VALID_BUCKET_NAME_RE.test(configured)) {
    return configured;
  }
  return 'excel-workbooks';
}

const DEFAULT_PUBLIC_SUPABASE_URL = 'https://skxgejnquhqrlqjynfkv.supabase.co';
const DEFAULT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
  'sb_publishable_-U6EEkrWGvhFYPpdNXILMQ_Il4cmf9l';

function resolveSupabaseUrl(): string | null {
  const value =
    process.env.SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    process.env.VITE_SUPABASE_URL?.trim() ||
    DEFAULT_PUBLIC_SUPABASE_URL;
  return value || null;
}

function resolvePublishableOrAnonKey(): string | null {
  const value =
    process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    process.env.VITE_SUPABASE_ANON_KEY?.trim() ||
    DEFAULT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return value || null;
}

function resolveServiceRoleKey(): string | null {
  const value =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    '';
  return value || null;
}

export function getSupabaseConfigStatus(): SupabaseConfigStatus {
  const missingKeys: string[] = [];
  const url = resolveSupabaseUrl();
  const publishableKey = resolvePublishableOrAnonKey();
  const serviceKey = resolveServiceRoleKey();

  if (!url) missingKeys.push('SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)');
  if (!publishableKey) {
    missingKeys.push(
      'SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)'
    );
  }

  return {
    configured: missingKeys.length === 0,
    missingKeys,
    bucket: getStorageBucketName(),
    mode:
      missingKeys.length > 0
        ? 'unconfigured'
        : serviceKey
          ? 'service-role'
          : 'rls-publishable',
  };
}

function assertValidSupabaseUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('SUPABASE_URL is not a valid URL.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('SUPABASE_URL must use https:// or http://.');
  }
  if (parsed.hostname === 'supabase.com' || parsed.hostname === 'www.supabase.com') {
    throw new Error(
      'SUPABASE_URL is set to a Supabase dashboard page instead of your Project API URL (https://<project-ref>.supabase.co).'
    );
  }
  return parsed.origin;
}

function getFingerprint(): string {
  return `${resolveSupabaseUrl() || ''}|${resolvePublishableOrAnonKey() || ''}|${resolveServiceRoleKey() || ''}`;
}

/**
 * Runs an Express request handler with the verified user's Supabase JWT bound
 * to AsyncLocalStorage so all database and storage calls execute under strict
 * Supabase Row Level Security (RLS) using the Publishable/Anon key.
 */
export function runWithSupabaseAccessToken<T>(
  accessToken: string,
  fn: () => T
): T {
  return requestContextStorage.run({ accessToken, client: null }, fn);
}

export function getSupabaseAuthClient(): SupabaseClient {
  const status = getSupabaseConfigStatus();
  if (!status.configured) {
    throw new Error(
      `Supabase is not configured yet. Add ${status.missingKeys.join(' and ')} in your Environment Variables (Vercel or AI Studio Secrets).`
    );
  }

  const fp = getFingerprint();
  if (!cachedAuthClient || cachedConfigFingerprint !== fp) {
    const url = assertValidSupabaseUrl(resolveSupabaseUrl()!);
    const publishableKey = resolvePublishableOrAnonKey()!;
    cachedAuthClient = createClient(url, publishableKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    cachedServiceAdminClient = null;
    cachedConfigFingerprint = fp;
    bucketVerified = false;
  }
  return cachedAuthClient;
}

function getServiceRoleClientIfAvailable(): SupabaseClient | null {
  const serviceKey = resolveServiceRoleKey();
  const url = resolveSupabaseUrl();
  if (!serviceKey || !url) return null;

  const fp = getFingerprint();
  if (!cachedServiceAdminClient || cachedConfigFingerprint !== fp) {
    cachedServiceAdminClient = createClient(
      assertValidSupabaseUrl(url),
      serviceKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );
    cachedConfigFingerprint = fp;
    bucketVerified = false;
  }
  return cachedServiceAdminClient;
}

/**
 * Returns a per-request RLS-authenticated Supabase client using the signed-in
 * user's Bearer JWT + Publishable/Anon key (preferred & strictly enforces RLS).
 * Falls back to optional Service Role client only outside a user request context.
 */
export function getSupabaseAdmin(): SupabaseClient {
  const status = getSupabaseConfigStatus();
  if (!status.configured) {
    throw new Error(
      `Supabase is not configured yet. Add ${status.missingKeys.join(' and ')} in your Environment Variables (Vercel or AI Studio Secrets).`
    );
  }

  const reqCtx = requestContextStorage.getStore();
  if (reqCtx?.accessToken) {
    if (!reqCtx.client) {
      const url = assertValidSupabaseUrl(resolveSupabaseUrl()!);
      const publishableKey = resolvePublishableOrAnonKey()!;
      reqCtx.client = createClient(url, publishableKey, {
        global: {
          headers: {
            Authorization: `Bearer ${reqCtx.accessToken}`,
          },
        },
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      });
    }
    return reqCtx.client;
  }

  const serviceClient = getServiceRoleClientIfAvailable();
  if (serviceClient) {
    return serviceClient;
  }

  throw new Error('Authentication required for Supabase database access.');
}

export async function ensureStorageBucketExists(): Promise<string> {
  const bucket = getStorageBucketName();
  if (bucketVerified) return bucket;

  // Auto-creation of storage buckets requires a service-role/secret key.
  // When using the Publishable Key + RLS, the bucket is provisioned once via supabase/schema.sql.
  const serviceClient = getServiceRoleClientIfAvailable();
  if (!serviceClient) {
    return bucket;
  }

  const { data: existing, error: getErr } =
    await serviceClient.storage.getBucket(bucket);

  if (!getErr && existing) {
    bucketVerified = true;
    return bucket;
  }

  const { error: createErr } = await serviceClient.storage.createBucket(bucket, {
    public: false,
    fileSizeLimit: 26214400, // 25 MB
  });

  if (
    createErr &&
    !createErr.message.toLowerCase().includes('already exists')
  ) {
    console.error('Supabase Storage bucket creation error:', createErr);
    throw new Error(
      `Unable to initialize Supabase Storage bucket "${bucket}". Run supabase/schema.sql in your Supabase SQL Editor.`
    );
  }

  bucketVerified = true;
  return bucket;
}
