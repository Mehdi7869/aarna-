const HEALTH_POLL_DELAYS_MS = [800, 1200, 1500, 2000, 2500, 3000, 3500, 4000, 4500];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function extractHtmlTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1]?.trim() || '';
}

export function looksLikeHtmlResponse(
  rawText: string,
  contentType: string
): boolean {
  const trimmed = rawText.trim();
  return (
    contentType.toLowerCase().includes('text/html') ||
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<html')
  );
}

function isRetryableWarmupHtml(
  status: number,
  rawText: string,
  contentType: string
): boolean {
  if (!looksLikeHtmlResponse(rawText, contentType)) return false;
  if (status === 502 || status === 503 || status === 504) return true;
  const title = extractHtmlTitle(rawText).toLowerCase();
  const bodyLower = rawText.slice(0, 2000).toLowerCase();
  return (
    title.includes('starting server') ||
    title.includes('waking up') ||
    title.includes('loading') ||
    bodyLower.includes('starting server')
  );
}

/**
 * Waits for the backend Express server to finish waking up by polling the
 * lightweight /api/health endpoint with cache: 'no-store' so large POST bodies
 * are never repeatedly resent while the proxy displays "Starting Server...".
 */
async function waitForServerReady(): Promise<boolean> {
  for (const delay of HEALTH_POLL_DELAYS_MS) {
    await sleep(delay);
    try {
      const res = await fetch(`/api/health?_t=${Date.now()}`, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'Cache-Control': 'no-cache' },
      });
      const text = await res.text();
      const ct = res.headers.get('content-type') || '';
      if (res.ok && !looksLikeHtmlResponse(text, ct)) {
        try {
          const parsed = JSON.parse(text);
          if (parsed && parsed.ok === true) {
            return true;
          }
        } catch {
          // Keep polling
        }
      }
    } catch {
      // Keep polling while server restarts
    }
  }
  return false;
}

export interface JsonFetchResult {
  res: Response;
  rawText: string;
  contentType: string;
  looksLikeHtml: boolean;
  parsedBody: unknown;
}

/**
 * Fetches an API JSON endpoint with cache: 'no-store' and automatically waits
 * for /api/health before retrying whenever the hosting proxy returns a
 * "Starting Server..." HTML splash page or transient 502/503/504.
 */
export async function fetchApiJsonWithRetry(
  url: string,
  init?: RequestInit
): Promise<JsonFetchResult> {
  const fetchInit: RequestInit = {
    ...init,
    cache: 'no-store',
    credentials: 'same-origin',
  };

  let lastError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, fetchInit);
      const rawText = await res.text();
      const contentType = res.headers.get('content-type') || '';
      const isHtml = looksLikeHtmlResponse(rawText, contentType);

      if (isRetryableWarmupHtml(res.status, rawText, contentType) && attempt < 2) {
        await waitForServerReady();
        continue;
      }

      let parsedBody: unknown = null;
      const trimmed = rawText.trim();
      if (trimmed && !isHtml) {
        try {
          parsedBody = JSON.parse(rawText);
        } catch {
          parsedBody = null;
        }
      }

      return {
        res,
        rawText,
        contentType,
        looksLikeHtml: isHtml,
        parsedBody,
      };
    } catch (err) {
      lastError = err;
      if (attempt < 2) {
        await waitForServerReady();
        continue;
      }
      throw err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Unable to reach server. Please retry.');
}

/**
 * Fetches a binary API endpoint (such as Excel workbook downloads) with
 * cache: 'no-store' and waits for server wakeup if the proxy returns HTML.
 */
export async function fetchApiBinaryWithRetry(
  url: string,
  init?: RequestInit
): Promise<Response> {
  const fetchInit: RequestInit = {
    ...init,
    cache: 'no-store',
    credentials: 'same-origin',
  };

  let lastError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, fetchInit);
      const contentType = (res.headers.get('content-type') || '').toLowerCase();

      if (
        (contentType.includes('text/html') ||
          res.status === 502 ||
          res.status === 503 ||
          res.status === 504) &&
        attempt < 2
      ) {
        const previewText = await res.clone().text().catch(() => '');
        if (isRetryableWarmupHtml(res.status, previewText, contentType)) {
          await waitForServerReady();
          continue;
        }
      }

      return res;
    } catch (err) {
      lastError = err;
      if (attempt < 2) {
        await waitForServerReady();
        continue;
      }
      throw err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Unable to reach server for download. Please retry.');
}
