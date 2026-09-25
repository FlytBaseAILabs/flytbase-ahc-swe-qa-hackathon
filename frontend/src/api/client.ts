import { config } from '../config';

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
}

export async function apiFetch<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${config.apiUrl}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  let json: (T & { error?: string }) | undefined;
  try {
    json = (await res.json()) as T & { error?: string };
  } catch {
    json = undefined;
  }
  if (!res.ok) throw new Error(json?.error ?? `request failed (${res.status})`);
  return json as T;
}
