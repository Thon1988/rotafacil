import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { COLORS, RADIUS, SPACING } from "@/src/constants/theme";
import { useAuth } from "@/src/lib/auth";

export default function LoginScreen() {
  const { signInWithGoogle, signingIn } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const handleGoogle = async () => {
    setError(null);
    const r = await signInWithGoogle();
    if (!r.ok) {
      if (r.reason === "cancelled") return;
      Alert.alert("Erro no login", `Não foi possível entrar. (${r.reason})`);
      setError(r.reason);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]} testID="login-screen">
      <View style={styles.heroSection}>
        <View style={styles.logoCircle}>
          <Ionicons name="navigate" size={56} color="#fff" />
        </View>
        <Text style={styles.title}>Rota+Rápida App</Text>
        <Text style={styles.subtitle}>
          Bipe, ouça a parada e entregue mais rápido.
        </Text>

        <View style={styles.trialPill}>
          <Ionicons name="gift" size={14} color={COLORS.primary} />
          <Text style={styles.trialPillText}>14 dias grátis para testar</Text>
        </View>
      </View>

      <View style={styles.featuresGrid}>
        <Feature icon="document-text" title="Lê PDF do Circuit" />
        <Feature icon="scan" title="Scanner com voz" />
        <Feature icon="map" title="Mapa + Otimização" />
        <Feature icon="cash" title="R$ 20/mês após o trial" />
      </View>

      <View style={styles.bottom}>
        <TouchableOpacity
          style={[styles.googleButton, signingIn && { opacity: 0.6 }]}
          onPress={handleGoogle}
          disabled={signingIn}
          testID="google-signin-button"
        >
          {signingIn ? (
            <ActivityIndicator color="#1f1f1f" />
          ) : (
            <>
              <Image
                source={{
                  uri: "https://upload.wikimedia.org/wikipedia/commons/c/c1/Google_%22G%22_logo.svg",
                }}
                style={styles.googleLogo}
              />
              <Text style={styles.googleButtonText}>Entrar com Google</Text>
            </>
          )}
        </TouchableOpacity>

        {error ? (
          <Text style={styles.errorText} numberOfLines={2}>
            {error}
          </Text>
        ) : (
          <Text style={styles.legal}>
            Ao continuar você concorda com o uso do app para entregas.
            Identificamos o dispositivo para evitar abuso do trial.
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
}

function Feature({ icon, title }: { icon: any; title: string }) {
  return (
    <View style={styles.featureCard}>
      <Ionicons name={icon} size={22} color={COLORS.primary} />
      <Text style={styles.featureText}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgBase,
    paddingHorizontal: SPACING.lg,
    justifyContent: "space-between",
  },
  heroSection: { alignItems: "center", marginTop: SPACING.xl },
  logoCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: COLORS.primary,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: SPACING.lg,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: "900",
    color: COLORS.textPrimary,
    letterSpacing: -1,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: SPACING.sm,
    textAlign: "center",
  },
  trialPill: {
    marginTop: SPACING.md,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(234,88,12,0.15)",
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  trialPillText: { color: COLORS.primary, fontWeight: "800", fontSize: 13 },
  featuresGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACING.md,
    justifyContent: "space-between",
  },
  featureCard: {
    width: "47%",
    backgroundColor: COLORS.bgSurface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: SPACING.sm,
    flexDirection: "row",
    alignItems: "center",
  },
  featureText: {
    color: COLORS.textPrimary,
    fontWeight: "700",
    fontSize: 13,
    flex: 1,
  },
  bottom: { gap: SPACING.md, paddingBottom: SPACING.lg },
  googleButton: {
    backgroundColor: "#FFFFFF",
    paddingVertical: 16,
    borderRadius: RADIUS.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.sm,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  googleLogo: { width: 22, height: 22 },
  googleButtonText: { color: "#1f1f1f", fontWeight: "800", fontSize: 16 },
  errorText: {
    color: COLORS.error,
    textAlign: "center",
    fontSize: 12,
  },
  legal: {
    color: COLORS.textTertiary,
    fontSize: 11,
    textAlign: "center",
    lineHeight: 16,
  },
});
