/**
 * App configuration. Values come from EXPO_PUBLIC_* env vars (see .env.example),
 * never hard-coded. The API URL is not a secret.
 */
const DEFAULT_API_URL = "http://localhost:8000/api/v1";

export const config = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL,
} as const;
