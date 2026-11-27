import net from 'node:net';
import { assertSafeFetchUrl, isPrivateIp, sanitizeBookmarkUrl } from './security.ts';
import type { LinkCheckData, LinkCheckProbeResult, LinkOverallStatus } from './types.ts';

const MAX_REDIRECTS = 5;
const LOCAL_TIMEOUT_MS = 8500;
const EXTERNAL_API_TIMEOUT_MS = 8000;
const EXTERNAL_POLL_MAX_ATTEMPTS = 7;
const EXTERNAL_POLL_INTERVAL_MS = 850;
const GLOBALPING_API_BASE = 'https://api.globalping.io/v1/measurements';
const CHECKHOST_API_BASE = 'https://check-host.net';
const SAFE_MEASUREMENT_ID_RE = /^[A-Za-z0-9_-]{4,80}$/;

const BLOCKED_INTERNAL_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.lan',
  '.home',
  '.corp',
  '.home.arpa',
  '.localdomain',
];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Classifies an HTTP status code for link availability.
 * Auth/WAF/rate-limit codes (401/403/405/406/429) indicate the site is live & serving,
 * whereas 404/410/451/5xx indicate dead, removed, or geo-blocked pages.
 */
function classifyHttpStatus(code: number): { ok: boolean; label: string } {
  if (code >= 200 && code < 400) {
    return { ok: true, label: code >= 300 ? `Перенаправление (${code})` : 'Доступна' };
  }
  if (code === 401 || code === 403 || code === 405 || code === 406 || code === 429) {
    return { ok: true, label: `Доступна (защита/WAF ${code})` };
  }
  if (code === 404) {
    return { ok: false, label: 'Страница не найдена (404)' };
  }
  if (code === 410) {
    return { ok: false, label: 'Страница удалена (410)' };
  }
  if (code === 451) {
    return { ok: false, label: 'Недоступна по региону (451)' };
  }
  if (code >= 500) {
    return { ok: false, label: `Ошибка сервера (${code})` };
  }
  return { ok: false, label: `HTTP ${code}` };
}

/**
 * Static safety check that blocks non-HTTP(S) schemes, localhost/LAN/internal hostnames,
 * single-label Docker hostnames, and literal private IP addresses BEFORE sending any URL
 * to local fetch or third-party external probing APIs.
 */
function validatePublicTargetUrl(rawUrl: string): URL {
  const sanitized = sanitizeBookmarkUrl(rawUrl);
  if (!sanitized) {
    throw new Error('Некорректный URL. Поддерживаются только http:// и https://');
  }

  const parsed = new URL(sanitized);
  let host = parsed.hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  const normalizedHost = host.replace(/\.+$/, '');

  if (
    !normalizedHost ||
    normalizedHost === 'localhost' ||
    normalizedHost === 'metadata.google.internal' ||
    BLOCKED_INTERNAL_SUFFIXES.some((suffix) => normalizedHost.endsWith(suffix))
  ) {
    throw new Error('Проверка локальных и внутренних адресов запрещена');
  }

  const ipCandidate = normalizedHost.split('%')[0];
  if (net.isIP(ipCandidate)) {
    if (isPrivateIp(normalizedHost)) {
      throw new Error('Проверка приватных IP-адресов запрещена');
    }
    return parsed;
  }

  // Reject single-label hostnames (e.g. http://gotenberg or http://router)
  if (!normalizedHost.includes('.')) {
    throw new Error('Проверка внутренних сетевых имён запрещена');
  }

  return parsed;
}

function formatLocalFetchError(err: unknown): string {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  const code = e?.cause?.code || '';
  const msg = e?.message || '';

  if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || msg.includes('aborted')) {
    return 'Таймаут соединения';
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || msg.includes('ENOTFOUND')) {
    return 'Домен не найден (DNS)';
  }
  if (code === 'ECONNRESET' || msg.includes('ECONNRESET')) {
    return 'Соединение сброшено (DPI / блок)';
  }
  if (code === 'ECONNREFUSED') {
    return 'Соединение отклонено';
  }
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT') {
    return 'Таймаут ответа сервера';
  }
  if (code.startsWith('ERR_TLS') || code.includes('CERT') || msg.includes('TLS') || msg.includes('certificate')) {
    return 'Ошибка TLS / сертификата';
  }
  if (msg.includes('приватный') || msg.includes('локальным')) {
    return 'DNS вернул локальный/заблокированный IP';
  }
  return msg ? msg.slice(0, 120) : 'Нет ответа от сервера';
}

async function cancelBodySafely(res: Response): Promise<void> {
  try {
    if (res.body) {
      await res.body.cancel();
    }
  } catch {
    // ignore body cancellation errors
  }
}

async function performLocalRequest(
  initialUrl: URL,
  method: 'HEAD' | 'GET'
): Promise<{ status: number; statusText: string }> {
  let currentUrl = initialUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // Re-validate DNS and IP on every hop to prevent redirect-based SSRF
    const safeUrl = await assertSafeFetchUrl(currentUrl.toString());

    const res = await fetch(safeUrl.toString(), {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(LOCAL_TIMEOUT_MS),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; DropkeepLinkChecker/1.0; +https://github.com/dimap/Dropkeep)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    await cancelBodySafely(res);

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) {
        return { status: res.status, statusText: res.statusText || '' };
      }
      currentUrl = new URL(location, safeUrl);
      continue;
    }

    return { status: res.status, statusText: res.statusText || '' };
  }

  throw new Error('Слишком много перенаправлений');
}

/**
 * Probe 1: Checks link availability directly from the server where Dropkeep is running.
 */
export async function checkFromLocalServer(rawUrl: string): Promise<LinkCheckProbeResult> {
  const start = Date.now();
  try {
    const publicUrl = validatePublicTargetUrl(rawUrl);

    let result = await performLocalRequest(publicUrl, 'HEAD');
    // Many servers disallow HEAD (405/501/400) or return 403 only to HEAD; retry with headers-only GET
    if (
      result.status === 405 ||
      result.status === 501 ||
      result.status === 400 ||
      result.status === 403
    ) {
      try {
        result = await performLocalRequest(publicUrl, 'GET');
      } catch {
        // Keep original HEAD status if fallback GET fails
      }
    }

    const latencyMs = Date.now() - start;
    const verdict = classifyHttpStatus(result.status);
    return {
      ok: verdict.ok,
      statusCode: result.status,
      statusText: result.statusText || verdict.label,
      latencyMs,
      provider: 'local',
      location: 'Сервер Dropkeep',
      error: verdict.ok ? '' : verdict.label,
    };
  } catch (err) {
    return {
      ok: false,
      statusCode: null,
      statusText: '',
      latencyMs: Date.now() - start,
      provider: 'local',
      location: 'Сервер Dropkeep',
      error: formatLocalFetchError(err),
    };
  }
}

interface GlobalpingResultItem {
  probe?: {
    country?: string;
    city?: string;
  };
  result?: {
    status?: string;
    statusCode?: number | null;
    statusCodeName?: string;
    rawOutput?: string;
    timings?: {
      total?: number | null;
    };
  };
}

interface GlobalpingMeasurementResponse {
  id?: string;
  status?: string;
  results?: GlobalpingResultItem[];
}

function formatExternalFailureReason(rawOutput: string): string {
  const text = (rawOutput || '').trim();
  if (!text) return 'Нет ответа от узла';
  if (/ENOTFOUND|EAI_AGAIN/i.test(text)) return 'Домен не найден (DNS)';
  if (/ECONNREFUSED/i.test(text)) return 'Соединение отклонено';
  if (/ECONNRESET/i.test(text)) return 'Соединение сброшено';
  if (/ETIMEDOUT|timeout/i.test(text)) return 'Таймаут соединения';
  if (/CERT|TLS|SSL/i.test(text)) return 'Ошибка TLS / сертификата';
  return text.split('\n')[0].slice(0, 110);
}

async function probeViaGlobalping(
  targetUrl: URL,
  method: 'HEAD' | 'GET' = 'HEAD'
): Promise<LinkCheckProbeResult> {
  const protocol = targetUrl.protocol === 'http:' ? 'HTTP' : 'HTTPS';
  const defaultPort = protocol === 'HTTP' ? 80 : 443;
  const port = targetUrl.port ? Number(targetUrl.port) : defaultPort;
  const pathStr = targetUrl.pathname || '/';
  const queryStr = targetUrl.search ? targetUrl.search.slice(1) : undefined;

  const createRes = await fetch(GLOBALPING_API_BASE, {
    method: 'POST',
    signal: AbortSignal.timeout(EXTERNAL_API_TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'DropkeepLinkChecker/1.0 (+https://github.com/dimap/Dropkeep)',
    },
    body: JSON.stringify({
      type: 'http',
      target: targetUrl.hostname,
      locations: [{ country: 'DE' }, { country: 'NL' }, { country: 'US' }],
      limit: 1,
      measurementOptions: {
        protocol,
        port,
        request: {
          method,
          path: pathStr,
          ...(queryStr ? { query: queryStr } : {}),
        },
      },
    }),
  });

  if (!createRes.ok) {
    throw new Error(`Globalping HTTP ${createRes.status}`);
  }

  const created = (await createRes.json()) as { id?: string };
  const measurementId = typeof created?.id === 'string' ? created.id : '';
  if (!SAFE_MEASUREMENT_ID_RE.test(measurementId)) {
    throw new Error('Globalping вернул некорректный ID проверки');
  }

  let data: GlobalpingMeasurementResponse | null = null;
  for (let attempt = 0; attempt < EXTERNAL_POLL_MAX_ATTEMPTS; attempt++) {
    await delay(attempt === 0 ? 700 : EXTERNAL_POLL_INTERVAL_MS);
    const pollRes = await fetch(`${GLOBALPING_API_BASE}/${encodeURIComponent(measurementId)}`, {
      signal: AbortSignal.timeout(EXTERNAL_API_TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        'User-Agent': 'DropkeepLinkChecker/1.0 (+https://github.com/dimap/Dropkeep)',
      },
    });
    if (!pollRes.ok) {
      throw new Error(`Globalping poll HTTP ${pollRes.status}`);
    }
    data = (await pollRes.json()) as GlobalpingMeasurementResponse;
    if (data.status === 'finished') {
      break;
    }
  }

  const first = data?.results?.[0];
  if (!first || !first.result) {
    throw new Error('Globalping не вернул результат узла');
  }

  const country = first.probe?.country || 'EU';
  const city = first.probe?.city || '';
  const location = city ? `${country} (${city})` : country;
  const statusCode =
    typeof first.result.statusCode === 'number' && Number.isFinite(first.result.statusCode)
      ? first.result.statusCode
      : null;
  const latencyMs =
    typeof first.result.timings?.total === 'number' && Number.isFinite(first.result.timings.total)
      ? Math.round(first.result.timings.total)
      : null;

  if (statusCode !== null) {
    // If HEAD returned 405/501/400, retry once with GET
    if (method === 'HEAD' && (statusCode === 405 || statusCode === 501 || statusCode === 400)) {
      return probeViaGlobalping(targetUrl, 'GET');
    }
    const verdict = classifyHttpStatus(statusCode);
    return {
      ok: verdict.ok,
      statusCode,
      statusText: first.result.statusCodeName || verdict.label,
      latencyMs,
      provider: 'Globalping',
      location,
      error: verdict.ok ? '' : verdict.label,
    };
  }

  return {
    ok: false,
    statusCode: null,
    statusText: '',
    latencyMs,
    provider: 'Globalping',
    location,
    error: formatExternalFailureReason(first.result.rawOutput || ''),
  };
}

async function probeViaCheckHost(targetUrl: URL): Promise<LinkCheckProbeResult> {
  const qs = new URLSearchParams();
  qs.set('host', targetUrl.toString());
  qs.append('node', 'de4.node.check-host.net');
  qs.append('node', 'nl1.node.check-host.net');
  qs.append('node', 'us1.node.check-host.net');

  let initRes = await fetch(`${CHECKHOST_API_BASE}/check-http?${qs.toString()}`, {
    signal: AbortSignal.timeout(EXTERNAL_API_TIMEOUT_MS),
    headers: { Accept: 'application/json' },
  });

  if (!initRes.ok) {
    throw new Error(`Check-Host HTTP ${initRes.status}`);
  }

  let initData = (await initRes.json()) as {
    ok?: number;
    request_id?: string;
    nodes?: Record<string, [string, string, string, string, string]>;
  };

  // Fallback to automatic node selection if pinned nodes were not returned
  if (!initData?.request_id || !initData.nodes || Object.keys(initData.nodes).length === 0) {
    const fallbackQs = new URLSearchParams({ host: targetUrl.toString(), max_nodes: '2' });
    initRes = await fetch(`${CHECKHOST_API_BASE}/check-http?${fallbackQs.toString()}`, {
      signal: AbortSignal.timeout(EXTERNAL_API_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });
    if (!initRes.ok) {
      throw new Error(`Check-Host fallback HTTP ${initRes.status}`);
    }
    initData = (await initRes.json()) as typeof initData;
  }

  const requestId = typeof initData?.request_id === 'string' ? initData.request_id : '';
  if (!SAFE_MEASUREMENT_ID_RE.test(requestId)) {
    throw new Error('Check-Host вернул некорректный ID запроса');
  }

  const nodesMeta = initData.nodes || {};
  let finalResults: Record<string, unknown> | null = null;

  for (let attempt = 0; attempt < EXTERNAL_POLL_MAX_ATTEMPTS; attempt++) {
    await delay(attempt === 0 ? 900 : EXTERNAL_POLL_INTERVAL_MS);
    const pollRes = await fetch(
      `${CHECKHOST_API_BASE}/check-result/${encodeURIComponent(requestId)}`,
      {
        signal: AbortSignal.timeout(EXTERNAL_API_TIMEOUT_MS),
        headers: { Accept: 'application/json' },
      }
    );
    if (!pollRes.ok) {
      throw new Error(`Check-Host poll HTTP ${pollRes.status}`);
    }
    const payload = (await pollRes.json()) as Record<string, unknown>;
    const readyEntries = Object.entries(payload).filter(
      ([nodeName, val]) => !nodeName.startsWith('ru') && Array.isArray(val) && val.length > 0
    );
    if (readyEntries.length > 0) {
      finalResults = payload;
      break;
    }
    const anyReady = Object.values(payload).some((val) => Array.isArray(val) && val.length > 0);
    if (anyReady) {
      finalResults = payload;
    }
  }

  if (!finalResults) {
    throw new Error('Check-Host не вернул результат вовремя');
  }

  const entries = Object.entries(finalResults).filter(
    ([, val]) => Array.isArray(val) && Array.isArray((val as unknown[])[0])
  );
  // Prefer non-RU node when available
  entries.sort(([a], [b]) => {
    const aRu = a.startsWith('ru') ? 1 : 0;
    const bRu = b.startsWith('ru') ? 1 : 0;
    return aRu - bRu;
  });

  if (entries.length === 0) {
    throw new Error('Check-Host не вернул данных от узлов');
  }

  const [nodeName, rawArr] = entries[0];
  const entry = (rawArr as unknown[][])[0];
  const successFlag = Number(entry[0]);
  const latencySec = typeof entry[1] === 'number' ? entry[1] : null;
  const message = typeof entry[2] === 'string' ? entry[2] : '';
  const rawCode = entry[3] !== null && entry[3] !== undefined ? Number(entry[3]) : null;
  const statusCode = rawCode !== null && Number.isFinite(rawCode) && rawCode > 0 ? rawCode : null;

  const meta = nodesMeta[nodeName];
  const countryCode = meta?.[0]?.toUpperCase() || nodeName.slice(0, 2).toUpperCase();
  const city = meta?.[2] || '';
  const location = city ? `${countryCode} (${city})` : countryCode;
  const latencyMs = latencySec !== null ? Math.round(latencySec * 1000) : null;

  if (statusCode !== null) {
    const verdict = classifyHttpStatus(statusCode);
    return {
      ok: verdict.ok,
      statusCode,
      statusText: message || verdict.label,
      latencyMs,
      provider: 'Check-Host',
      location,
      error: verdict.ok ? '' : verdict.label,
    };
  }

  return {
    ok: successFlag === 1,
    statusCode: null,
    statusText: message,
    latencyMs,
    provider: 'Check-Host',
    location,
    error: successFlag === 1 ? '' : message || 'Нет ответа от узла',
  };
}

/**
 * Probe 2: Checks link availability via an external third-party availability service
 * (Globalping EU/US nodes primary, Check-Host.net fallback).
 */
export async function checkFromExternalService(rawUrl: string): Promise<LinkCheckProbeResult> {
  const targetUrl = validatePublicTargetUrl(rawUrl);

  try {
    return await probeViaGlobalping(targetUrl, 'HEAD');
  } catch {
    try {
      return await probeViaCheckHost(targetUrl);
    } catch {
      return {
        ok: false,
        statusCode: null,
        statusText: '',
        latencyMs: null,
        provider: 'Внешний сервис',
        location: 'EU / US',
        error: 'Внешний сервис проверки временно недоступен (лимит или таймаут)',
        serviceUnavailable: true,
      };
    }
  }
}

function computeOverallStatus(
  local: LinkCheckProbeResult,
  external: LinkCheckProbeResult
): LinkOverallStatus {
  if (local.ok && external.ok) {
    return 'ok';
  }
  if (!local.ok && external.ok) {
    return 'local_blocked';
  }
  if (local.ok && !external.ok) {
    return external.serviceUnavailable ? 'ok' : 'local_only';
  }
  // Both failed: if external service itself was unavailable/rate-limited,
  // avoid falsely marking a potentially ISP-blocked site as broken unless local got explicit 404/410.
  if (external.serviceUnavailable) {
    if (local.statusCode === 404 || local.statusCode === 410) {
      return 'broken';
    }
    return '';
  }
  return 'broken';
}

/**
 * Runs both local server availability check and external third-party availability check in parallel.
 */
export async function checkBookmarkAvailability(rawUrl: string): Promise<LinkCheckData> {
  // Validate public HTTP(S) target once upfront before invoking either probe
  const publicUrl = validatePublicTargetUrl(rawUrl);
  const urlString = publicUrl.toString();

  const [local, external] = await Promise.all([
    checkFromLocalServer(urlString),
    checkFromExternalService(urlString),
  ]);

  const overall = computeOverallStatus(local, external);

  return {
    overall,
    checked_at: new Date().toISOString(),
    local,
    external,
  };
}
