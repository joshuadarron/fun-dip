/**
 * Minimal typed fetcher for REST-style `/api/*` endpoints.
 * Throws a typed `FetcherError` on non-2xx so callers can distinguish
 * "not available yet" (404) from real failures.
 */
export class FetcherError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "FetcherError";
    this.status = status;
    this.body = body;
  }
}

export interface FetcherOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export async function fetcher<T>(url: string, options: FetcherOptions = {}): Promise<T> {
  const { method = "GET", body, signal, headers = {} } = options;

  const init: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...headers,
    },
    signal,
  };

  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  const response = await fetch(url, init);
  const text = await response.text();
  const parsed: unknown = text ? safeJson(text) : null;

  if (!response.ok) {
    throw new FetcherError(
      `Request to ${url} failed with ${response.status}`,
      response.status,
      parsed,
    );
  }

  return parsed as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
