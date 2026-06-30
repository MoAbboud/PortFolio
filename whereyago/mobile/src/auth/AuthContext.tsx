/**
 * Auth state for the whole app.
 *
 * The JWT is kept in the device's secure keychain (expo-secure-store), never in
 * plain storage. On launch we restore the session; screens read `token`/`user`
 * and call `signIn`/`signUp`/`signOut`.
 */
import * as SecureStore from "expo-secure-store";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { authApi } from "../api/auth";
import { logger } from "../logger";
import type { User } from "../types";

const TOKEN_KEY = "wyg_token";

interface AuthState {
  token: string | null;
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    email: string,
    username: string,
    password: string,
    displayName?: string,
  ) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore a saved session on launch.
  useEffect(() => {
    void (async () => {
      try {
        const saved = await SecureStore.getItemAsync(TOKEN_KEY);
        if (saved) {
          setToken(saved);
          setUser(await authApi.me(saved));
        }
      } catch (error) {
        logger.warn("session restore failed", error);
        await SecureStore.deleteItemAsync(TOKEN_KEY);
        setToken(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function persistSession(newToken: string): Promise<void> {
    await SecureStore.setItemAsync(TOKEN_KEY, newToken);
    setToken(newToken);
    setUser(await authApi.me(newToken));
  }

  const value = useMemo<AuthState>(
    () => ({
      token,
      user,
      loading,
      signIn: async (email, password) => {
        const res = await authApi.login(email, password);
        await persistSession(res.access_token);
      },
      signUp: async (email, username, password, displayName) => {
        await authApi.register(email, username, password, displayName);
        const res = await authApi.login(email, password);
        await persistSession(res.access_token);
      },
      signOut: async () => {
        await SecureStore.deleteItemAsync(TOKEN_KEY);
        setToken(null);
        setUser(null);
      },
    }),
    [token, user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an <AuthProvider>");
  return ctx;
}
