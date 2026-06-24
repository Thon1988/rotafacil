import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { COLORS } from "@/src/constants/theme";
import { useAuth } from "@/src/lib/auth";

/**
 * Deep link landing route. Google Auth redirects the browser to
 * `frontend://auth?session_id=...`. The AuthProvider's Linking listener
 * already picks that up and exchanges the token, so this screen just shows
 * a loading state and then bounces to "/" once the user is set.
 */
export default function AuthCallback() {
  const router = useRouter();
  const { user, signingIn, loading } = useAuth();

  useEffect(() => {
    if (loading || signingIn) return;
    // Whenever we land here, redirect to root (login if not authed, home if authed)
    const t = setTimeout(() => {
      router.replace("/");
    }, 500);
    return () => clearTimeout(t);
  }, [loading, signingIn, user, router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={COLORS.primary} />
      <Text style={styles.text}>Concluindo login...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgBase,
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
  },
  text: { color: COLORS.textSecondary, fontWeight: "600" },
});
