/**
 * Typed HTTP client — the single place that talks to the backend.
 *
 * Every screen/service goes through `request()`, which attaches the base URL,
 * JSON headers, an optional bearer token, and turns non-2xx responses into a
 * typed `ApiError`. Swapping fetch for something else later happens only here.
 */
import { config } from "../config";
import { logger } from "../logger";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string | null;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, token } = options;
  const url = `${config.apiUrl}${path}`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  logger.info(method, path);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check that the API is running and the URL is correct.");
  }

  const raw = await response.text();
  const data: unknown = raw ? JSON.parse(raw) : null;

  if (!response.ok) {
    const detail =
      data && typeof data === "object" && "detail" in data
        ? (data as { detail: unknown }).detail
        : response.statusText;
    throw new ApiError(response.status, typeof detail === "string" ? detail : "Request failed");
  }

  return data as T;
}
