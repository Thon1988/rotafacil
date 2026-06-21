import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, AppState, StyleSheet, Text, TouchableOpacity, View } from "react-native";
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
  const [hasRoute, setHasRoute] = useState(false);
  const [routeCount, setRouteCount] = useState(0);

  const checkSubscription = useCallback(async () => {
    try {
      const userId = await getOrCreateUserId();
      const sub = await getSubscription(userId);
      if (sub.active) {
        setState("active");
        setDaysRemaining(sub.days_remaining);
      } else if (sub.pending) {
        setState("pending");
      } else {
        setState("none");
      }
    } catch {
      setState("none");
    }
  }, []);

  const refreshRoute = useCallback(async () => {
    const route = await loadRoute();
    setHasRoute(route.length > 0);
    setRouteCount(route.length);
  }, []);

  useEffect(() => {
    checkSubscription();
    refreshRoute();
  }, [checkSubscription, refreshRoute]);

  // Poll while pending (every 30s)
  useFocusEffect(
    useCallback(() => {
      let interval: any;
      refreshRoute();
      if (state === "pending") {
        interval = setInterval(() => checkSubscription(), 30000);
      }
      const sub = AppState.addEventListener("change", (s) => {
        if (s === "active") {
          checkSubscription();
          refreshRoute();
        }
      });
      return () => {
        if (interval) clearInterval(interval);
        sub.remove();
      };
    }, [state, checkSubscription, refreshRoute])
  );

  const showComingSoon = (feature: string) => {
    Alert.alert(
      `${feature} — Em breve`,
      "Esta funcionalidade está sendo finalizada e será liberada em uma próxima atualização. Por enquanto, foque em bipar e entregar os pacotes.",
      [{ text: "Ok" }]
    );
  };

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
          Bipe, ouça a parada e entregue.
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
        <FeatureCard icon="document-text" title="PDF Circuit" desc="Ordem do Circuit preservada" />
        <FeatureCard icon="scan" title="Scanner" desc="Bipe e ouça a parada" />
        <FeatureCard icon="map" title="Mapa" desc="Em breve" locked />
        <FeatureCard icon="flash" title="Otimização" desc="Em breve" locked />
      </View>

      <View style={styles.ctaSection}>
        {state === "active" ? (
          <>
            {hasRoute ? (
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() => router.push("/scanner")}
                testID="landing-continue-route-button"
              >
                <Ionicons name="scan" size={20} color="#fff" />
                <Text style={styles.primaryButtonText}>
                  Continuar Rota • {routeCount} paradas
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() => router.push("/upload")}
                testID="landing-start-route-button"
              >
                <Ionicons name="cloud-upload" size={20} color="#fff" />
                <Text style={styles.primaryButtonText}>Carregar PDF do Circuit</Text>
              </TouchableOpacity>
            )}

            <View style={styles.secondaryRow}>
              {hasRoute && (
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => router.push("/upload")}
                  testID="landing-new-route-button"
                >
                  <Ionicons name="cloud-upload-outline" size={18} color={COLORS.textPrimary} />
                  <Text style={styles.secondaryButtonText}>Nova rota</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.secondaryButton, styles.lockedSecondary]}
                onPress={() => showComingSoon("Histórico")}
                testID="landing-history-locked"
              >
                <Ionicons name="lock-closed" size={16} color={COLORS.textSecondary} />
                <Text style={styles.secondaryButtonText}>Histórico</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.secondaryButton, styles.lockedSecondary]}
                onPress={() => showComingSoon("Estatísticas")}
                testID="landing-stats-locked"
              >
                <Ionicons name="lock-closed" size={16} color={COLORS.textSecondary} />
                <Text style={styles.secondaryButtonText}>Stats</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : state === "pending" ? (
          <>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: COLORS.bgElevated }]}
              onPress={() => checkSubscription()}
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

function FeatureCard({
  icon,
  title,
  desc,
  locked,
}: {
  icon: any;
  title: string;
  desc: string;
  locked?: boolean;
}) {
  return (
    <View style={[styles.featureCard, locked && styles.featureCardLocked]}>
      <View style={styles.featureIconRow}>
        <Ionicons name={icon} size={26} color={locked ? COLORS.textSecondary : COLORS.primary} />
        {locked && (
          <View style={styles.lockBadge}>
            <Text style={styles.lockBadgeText}>EM BREVE</Text>
          </View>
        )}
      </View>
      <Text style={[styles.featureTitle, locked && { color: COLORS.textSecondary }]}>{title}</Text>
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
  title: { fontSize: 34, fontWeight: "900", color: COLORS.textPrimary, letterSpacing: -1 },
  subtitle: { fontSize: 15, color: COLORS.textSecondary, marginTop: SPACING.sm, textAlign: "center" },
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
  featureCardLocked: {
    opacity: 0.65,
    borderStyle: "dashed",
  },
  featureIconRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  lockBadge: {
    backgroundColor: COLORS.bgElevated,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
  },
  lockBadgeText: { color: COLORS.textSecondary, fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  featureTitle: { color: COLORS.textPrimary, fontWeight: "700", fontSize: 15 },
  featureDesc: { color: COLORS.textSecondary, fontSize: 12 },
  ctaSection: { gap: SPACING.md },
  primaryButton: {
    backgroundColor: COLORS.primary, paddingVertical: 18,
    borderRadius: RADIUS.lg, flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: SPACING.sm,
  },
  primaryButtonText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  secondaryRow: { flexDirection: "row", gap: SPACING.sm },
  secondaryButton: {
    flex: 1, backgroundColor: COLORS.bgSurface, paddingVertical: 14,
    borderRadius: RADIUS.lg, flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: SPACING.xs, borderWidth: 1, borderColor: COLORS.border,
  },
  lockedSecondary: { opacity: 0.55, borderStyle: "dashed" },
  secondaryButtonText: { color: COLORS.textPrimary, fontWeight: "700", fontSize: 13 },
  pricingNote: { color: COLORS.textSecondary, fontSize: 14, textAlign: "center" },
  bold: { color: COLORS.primary, fontWeight: "800" },
});
