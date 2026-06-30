/** Auth endpoints. */
import type { User } from "../types";
import { request } from "./client";

export interface TokenResponse {
  access_token: string;
  token_type: string;
}

export const authApi = {
  register: (email: string, username: string, password: string, displayName?: string) =>
    request<User>("/auth/register", {
      method: "POST",
      body: { email, username, password, display_name: displayName ?? null },
    }),

  login: (email: string, password: string) =>
    request<TokenResponse>("/auth/login", {
      method: "POST",
      body: { email, password },
    }),

  me: (token: string) => request<User>("/auth/me", { token }),
};
