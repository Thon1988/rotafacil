import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, AppState, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { COLORS, RADIUS, SPACING } from "@/src/constants/theme";
import { getOrCreateUserId } from "@/src/lib/user";
import { getSubscription } from "@/src/lib/api";
import { loadRoute } from "@/src/lib/route-store";

type SubState = "loading" | "active" | "pending" | "none";

export default function Index() {
  const router = useRouter();
  const [state, setState] = useState<SubState>("loading");
  const [daysRemaining, setDaysRemaining] = useState(0);

  const checkSubscription = useCallback(async (autoRedirect = false) => {
    try {
      const userId = await getOrCreateUserId();
      const sub = await getSubscription(userId);
      if (sub.active) {
        setState("active");
        setDaysRemaining(sub.days_remaining);
        if (autoRedirect) {
          const route = await loadRoute();
          if (route.length > 0) {
            router.replace("/route");
          }
        }
      } else if (sub.pending) {
        setState("pending");
      } else {
        setState("none");
      }
    } catch {
      setState("none");
    }
  }, [router]);

  useEffect(() => {
    checkSubscription(true);
  }, [checkSubscription]);

  // Poll while pending (every 8s) so user sees activation soon
  useFocusEffect(
    useCallback(() => {
      let interval: any;
      if (state === "pending") {
        // Poll every 30s (was 8s) to reduce backend load
        interval = setInterval(() => checkSubscription(false), 30000);
      }
      const sub = AppState.addEventListener("change", (s) => {
        if (s === "active") checkSubscription(false);
      });
      return () => {
        if (interval) clearInterval(interval);
        sub.remove();
      };
    }, [state, checkSubscription])
  );

  if (state === "loading") {
    return (
      <View style={styles.loadingContainer} testID="landing-loading">
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]} testID="landing-screen">
      <View style={styles.heroSection}>
        <View style={styles.logoCircle}>
          <Ionicons name="navigate" size={48} color="#fff" />
        </View>
        <Text style={styles.title} testID="landing-title">Rota+Rápida App</Text>
        <Text style={styles.subtitle}>
          Roteirização inteligente para entregadores
        </Text>

        {state === "active" && (
          <View style={styles.activeBadge}>
            <Ionicons name="shield-checkmark" size={14} color={COLORS.success} />
            <Text style={styles.activeBadgeText}>
              Assinatura ativa • {daysRemaining}d
            </Text>
          </View>
        )}

        {state === "pending" && (
          <View style={styles.pendingBadge}>
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text style={styles.pendingBadgeText}>
              Aguardando aprovação do pagamento
            </Text>
          </View>
        )}
      </View>

      <View style={styles.featuresGrid}>
        <FeatureCard icon="map" title="Mapa" desc="Rota otimizada visual" />
        <FeatureCard icon="scan" title="Scanner" desc="Shopee & Mercado Livre" />
        <FeatureCard icon="stats-chart" title="Stats" desc="Histórico e badges" />
        <FeatureCard icon="document-text" title="Importar" desc="PDF, Excel, CSV" />
      </View>

      <View style={styles.ctaSection}>
        {state === "active" ? (
          <>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => router.push("/upload")}
              testID="landing-start-route-button"
            >
              <Ionicons name="rocket" size={20} color="#fff" />
              <Text style={styles.primaryButtonText}>Iniciar Nova Rota</Text>
            </TouchableOpacity>
            <View style={styles.secondaryRow}>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => router.push("/history")}
                testID="landing-history-button"
              >
                <Ionicons name="time" size={18} color={COLORS.textPrimary} />
                <Text style={styles.secondaryButtonText}>Histórico</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => router.push("/stats")}
                testID="landing-stats-button"
              >
                <Ionicons name="trophy" size={18} color={COLORS.textPrimary} />
                <Text style={styles.secondaryButtonText}>Estatísticas</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : state === "pending" ? (
          <>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: COLORS.bgElevated }]}
              onPress={() => checkSubscription(false)}
              testID="landing-refresh-button"
            >
              <Ionicons name="refresh" size={20} color="#fff" />
              <Text style={styles.primaryButtonText}>Verificar Aprovação</Text>
            </TouchableOpacity>
            <Text style={styles.pricingNote}>
              Você receberá acesso assim que o admin aprovar seu pagamento
            </Text>
          </>
        ) : (
          <>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => router.push("/paywall")}
              testID="landing-subscribe-button"
            >
              <Text style={styles.primaryButtonText}>Assinar por R$ 20/mês</Text>
            </TouchableOpacity>
            <Text style={styles.pricingNote} testID="pricing-note">
              💡 Menos de <Text style={styles.bold}>R$ 1 por dia</Text>
            </Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

function FeatureCard({ icon, title, desc }: { icon: any; title: string; desc: string }) {
  return (
    <View style={styles.featureCard}>
      <Ionicons name={icon} size={28} color={COLORS.primary} />
      <Text style={styles.featureTitle}>{title}</Text>
      <Text style={styles.featureDesc}>{desc}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, backgroundColor: COLORS.bgBase, justifyContent: "center", alignItems: "center" },
  container: { flex: 1, backgroundColor: COLORS.bgBase, paddingHorizontal: SPACING.lg, justifyContent: "space-between" },
  heroSection: { alignItems: "center", marginTop: SPACING.xl },
  logoCircle: {
    width: 90, height: 90, borderRadius: 45, backgroundColor: COLORS.primary,
    justifyContent: "center", alignItems: "center", marginBottom: SPACING.lg,
    shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4, shadowRadius: 16,
  },
  title: { fontSize: 36, fontWeight: "900", color: COLORS.textPrimary, letterSpacing: -1 },
  subtitle: { fontSize: 16, color: COLORS.textSecondary, marginTop: SPACING.sm, textAlign: "center" },
  activeBadge: {
    marginTop: SPACING.md, flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(22,163,74,0.15)", paddingHorizontal: SPACING.md,
    paddingVertical: 6, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.success,
  },
  activeBadgeText: { color: COLORS.success, fontWeight: "700", fontSize: 12 },
  pendingBadge: {
    marginTop: SPACING.md, flexDirection: "row", alignItems: "center", gap: SPACING.sm,
    backgroundColor: "rgba(234,88,12,0.15)", paddingHorizontal: SPACING.md,
    paddingVertical: 8, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.primary,
  },
  pendingBadgeText: { color: COLORS.primary, fontWeight: "700", fontSize: 12 },
  featuresGrid: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.md, justifyContent: "space-between" },
  featureCard: {
    width: "47%", backgroundColor: COLORS.bgSurface, borderRadius: RADIUS.lg,
    padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, gap: SPACING.sm,
  },
  featureTitle: { color: COLORS.textPrimary, fontWeight: "700", fontSize: 15 },
  featureDesc: { color: COLORS.textSecondary, fontSize: 12 },
  ctaSection: { gap: SPACING.md },
  primaryButton: {
    backgroundColor: COLORS.primary, paddingVertical: 18,
    borderRadius: RADIUS.lg, flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: SPACING.sm,
  },
  primaryButtonText: { color: "#fff", fontSize: 17, fontWeight: "800" },
  secondaryRow: { flexDirection: "row", gap: SPACING.sm },
  secondaryButton: {
    flex: 1, backgroundColor: COLORS.bgSurface, paddingVertical: 14,
    borderRadius: RADIUS.lg, flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: SPACING.sm, borderWidth: 1, borderColor: COLORS.border,
  },
  secondaryButtonText: { color: COLORS.textPrimary, fontWeight: "700", fontSize: 14 },
  pricingNote: { color: COLORS.textSecondary, fontSize: 14, textAlign: "center" },
  bold: { color: COLORS.primary, fontWeight: "800" },
});
