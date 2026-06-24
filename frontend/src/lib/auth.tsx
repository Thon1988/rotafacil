import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";

import { API } from "@/src/constants/theme";
import { secureStore } from "@/src/lib/secure-store";
import { getDeviceFingerprint, getDeviceInfo } from "@/src/lib/device";

const TOKEN_KEY = "rota_session_token";
const EMERGENT_AUTH_BASE = "https://auth.emergentagent.com/";

export interface AuthUser {
  user_id: string;
  email: string;
  name?: string | null;
  picture?: string | null;
  trial_started_at?: string | null;
  trial_expires_at?: string | null;
  trial_active: boolean;
  trial_days_remaining: number;
  subscription_active: boolean;
  subscription_expires_at?: string | null;
  is_blocked_device: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  signingIn: boolean;
  hasAccess: boolean; // trial_active OR subscription_active
  signInWithGoogle: () => Promise<
    { ok: true } | { ok: false; reason: string }
  >;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthCtx = createContext<AuthContextValue | undefined>(undefined);

async function fetchMe(token: string): Promise<AuthUser | null> {
  try {
    const res = await fetch(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) return null;
    if (!res.ok) return null;
    return (await res.json()) as AuthUser;
  } catch {
    return null;
  }
}

async function exchangeEmergentSession(emergentSessionId: string) {
  // Send the raw session_id straight to our backend, which calls Emergent's
  // session-data endpoint server-side to get the user profile. This avoids
  // CORS issues on web and mismatches between session_id vs session_token.
  const fingerprint = await getDeviceFingerprint();
  const info = getDeviceInfo();
  const back = await fetch(`${API}/auth/google-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: emergentSessionId,
      device_fingerprint: fingerprint,
      device_info: info,
    }),
  });
  if (!back.ok) {
    let msg = `google-session ${back.status}`;
    try {
      const j = await back.json();
      if (j?.detail) msg = j.detail;
    } catch {
      /* noop */
    }
    throw new Error(msg);
  }
  const result = (await back.json()) as {
    session_token: string;
    user: AuthUser;
  };
  return result;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const tokenRef = useRef<string | null>(null);

  const persistToken = useCallback(async (token: string | null) => {
    tokenRef.current = token;
    if (token) await secureStore.set(TOKEN_KEY, token);
    else await secureStore.delete(TOKEN_KEY);
  }, []);

  const refresh = useCallback(async () => {
    const token = tokenRef.current || (await secureStore.get(TOKEN_KEY));
    if (!token) {
      setUser(null);
      return;
    }
    tokenRef.current = token;
    const me = await fetchMe(token);
    if (!me) {
      await persistToken(null);
      setUser(null);
      return;
    }
    setUser(me);
  }, [persistToken]);

  // Bootstrap: existing token? web URL with session_id?
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // WEB: detect ?session_id= or #session_id= in URL on mount
        if (Platform.OS === "web" && typeof window !== "undefined") {
          const sid = extractSessionIdFromUrl(window.location.href);
          if (sid) {
            try {
              const result = await exchangeEmergentSession(sid);
              await persistToken(result.session_token);
              if (mounted) setUser(result.user);
            } catch (e) {
              console.log("web session exchange failed", e);
            }
            // Clean URL
            try {
              window.history.replaceState(
                null,
                "",
                window.location.pathname,
              );
            } catch {
              /* noop */
            }
          }
        }

        // Mobile cold-start deep link with session_id
        if (Platform.OS !== "web") {
          try {
            const initialUrl = await Linking.getInitialURL();
            if (initialUrl) {
              const sid = extractSessionIdFromUrl(initialUrl);
              if (sid) {
                try {
                  const result = await exchangeEmergentSession(sid);
                  await persistToken(result.session_token);
                  if (mounted) setUser(result.user);
                } catch (e) {
                  console.log("mobile cold deep-link exchange failed", e);
                }
              }
            }
          } catch {
            /* noop */
          }
        }

        // Otherwise restore existing token
        if (!tokenRef.current) {
          await refresh();
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    // Listen for runtime deep links (warm-start: app already open when redirect fires)
    const linkSub = Linking.addEventListener("url", async (event) => {
      const sid = extractSessionIdFromUrl(event.url);
      if (!sid) return;
      try {
        setSigningIn(true);
        const result = await exchangeEmergentSession(sid);
        await persistToken(result.session_token);
        if (mounted) setUser(result.user);
      } catch (e) {
        console.log("warm deep-link exchange failed", e);
      } finally {
        if (mounted) setSigningIn(false);
      }
    });

    return () => {
      mounted = false;
      try {
        linkSub.remove();
      } catch {
        /* noop */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signInWithGoogle = useCallback(async (): Promise<
    { ok: true } | { ok: false; reason: string }
  > => {
    setSigningIn(true);
    try {
      let redirectUrl: string;
      if (Platform.OS === "web") {
        redirectUrl =
          typeof window !== "undefined"
            ? `${window.location.origin}/`
            : "https://localhost/";
      } else {
        redirectUrl = Linking.createURL("auth");
      }
      const authUrl = `${EMERGENT_AUTH_BASE}?redirect=${encodeURIComponent(
        redirectUrl,
      )}`;

      if (Platform.OS === "web") {
        if (typeof window !== "undefined") {
          window.location.href = authUrl;
        }
        // On web, this is a full-page redirect — the result is handled on next mount
        return { ok: true };
      }

      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
      if (result.type !== "success" || !result.url) {
        return { ok: false, reason: "cancelled" };
      }
      const sid = extractSessionIdFromUrl(result.url);
      if (!sid) return { ok: false, reason: "no_session_id" };
      const data = await exchangeEmergentSession(sid);
      await persistToken(data.session_token);
      setUser(data.user);
      return { ok: true };
    } catch (e: any) {
      console.log("signInWithGoogle err", e);
      return { ok: false, reason: String(e?.message || e) };
    } finally {
      setSigningIn(false);
    }
  }, [persistToken]);

  const signOut = useCallback(async () => {
    const token = tokenRef.current;
    if (token) {
      try {
        await fetch(`${API}/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        /* noop */
      }
    }
    await persistToken(null);
    setUser(null);
  }, [persistToken]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      signingIn,
      hasAccess: !!user && (user.trial_active || user.subscription_active),
      signInWithGoogle,
      signOut,
      refresh,
    }),
    [user, loading, signingIn, signInWithGoogle, signOut, refresh],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

function extractSessionIdFromUrl(url: string): string | null {
  if (!url) return null;
  // Try hash first
  const hashIdx = url.indexOf("#");
  if (hashIdx !== -1) {
    const hash = url.slice(hashIdx + 1);
    const params = new URLSearchParams(hash);
    const sid = params.get("session_id");
    if (sid) return sid;
  }
  // Try query
  const qIdx = url.indexOf("?");
  if (qIdx !== -1) {
    const query = url.slice(qIdx + 1).split("#")[0];
    const params = new URLSearchParams(query);
    const sid = params.get("session_id");
    if (sid) return sid;
  }
  return null;
}

export async function getAuthToken(): Promise<string | null> {
  return secureStore.get(TOKEN_KEY);
}
