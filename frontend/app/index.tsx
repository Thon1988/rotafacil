import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { COLORS, RADIUS, SPACING } from "@/src/constants/theme";
import { loadRoute } from "@/src/lib/route-store";
import { useAuth } from "@/src/lib/auth";

export default function Index() {
  const router = useRouter();
  const { user, hasAccess, signOut, refresh } = useAuth();
  const [hasRoute, setHasRoute] = useState(false);
  const [routeCount, setRouteCount] = useState(0);

  const refreshRoute = useCallback(async () => {
    const route = await loadRoute();
    setHasRoute(route.length > 0);
    setRouteCount(route.length);
  }, []);

  useEffect(() => {
    refreshRoute();
  }, [refreshRoute]);

  useFocusEffect(
    useCallback(() => {
      refreshRoute();
      refresh();
      const sub = AppState.addEventListener("change", (s) => {
        if (s === "active") {
          refresh();
          refreshRoute();
        }
      });
      return () => sub.remove();
    }, [refresh, refreshRoute])
  );

  const confirmSignOut = () => {
    Alert.alert("Sair", "Deseja sair da sua conta?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Sair", style: "destructive", onPress: () => signOut() },
    ]);
  };

  if (!user) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  // Device blocked from trial — must pay PIX
  if (user.is_blocked_device && !user.subscription_active) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        <View style={styles.heroSection}>
          <View style={[styles.logoCircle, { backgroundColor: COLORS.error }]}>
            <Ionicons name="warning" size={48} color="#fff" />
          </View>
          <Text style={styles.title}>Aparelho já usou o trial</Text>
          <Text style={styles.subtitle}>
            Detectamos que este celular já fez o teste grátis com outra conta.
            Para continuar usando o app, faça o pagamento de R$ 20/mês via PIX.
          </Text>
        </View>
        <View style={styles.ctaSection}>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => router.push("/paywall")}
            testID="landing-pay-blocked-button"
          >
            <Text style={styles.primaryButtonText}>Assinar por R$ 20/mês</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={confirmSignOut} style={styles.signOutBtn}>
            <Ionicons name="log-out" size={14} color={COLORS.textSecondary} />
            <Text style={styles.signOutText}>Sair ({user.email})</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]} testID="landing-screen">
      <View style={styles.topRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.greeting}>Olá,</Text>
          <Text style={styles.userName} numberOfLines={1}>
            {user.name?.split(" ")[0] || user.email}
          </Text>
        </View>
        <TouchableOpacity onPress={confirmSignOut} style={styles.iconBtn} testID="signout-icon">
          <Ionicons name="log-out-outline" size={22} color={COLORS.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={styles.heroSection}>
        <View style={styles.logoCircle}>
          <Ionicons name="navigate" size={44} color="#fff" />
        </View>
        <Text style={styles.title}>Rota+Rápida</Text>
        <Text style={styles.subtitle}>Bipe, ouça a parada e entregue.</Text>

        {user.subscription_active ? (
          <View style={styles.activeBadge}>
            <Ionicons name="shield-checkmark" size={14} color={COLORS.success} />
            <Text style={styles.activeBadgeText}>Assinatura ativa</Text>
          </View>
        ) : user.trial_active ? (
          <View style={styles.trialBadge}>
            <Ionicons name="gift" size={14} color={COLORS.primary} />
            <Text style={styles.trialBadgeText}>
              Trial: {user.trial_days_remaining}d restantes
            </Text>
          </View>
        ) : (
          <View style={styles.expiredBadge}>
            <Ionicons name="time" size={14} color={COLORS.error} />
            <Text style={styles.expiredBadgeText}>Trial expirado</Text>
          </View>
        )}
      </View>

      {hasRoute && (
        <View style={styles.routeLoadedBanner} testID="route-loaded-banner">
          <Ionicons name="checkmark-circle" size={18} color={COLORS.success} />
          <Text style={styles.routeLoadedText}>
            Rota carregada • {routeCount} paradas
          </Text>
        </View>
      )}

      <View style={styles.featuresGrid}>
        <ActionCard
          icon="cloud-upload"
          title="Carregar rota"
          desc="Excel / PDF"
          onPress={() => router.push("/upload")}
          testID="landing-action-load"
        />
        <ActionCard
          icon="document-text"
          title="Salvar em PDF"
          desc={hasRoute ? "Exportar rota" : "Carregue uma rota"}
          disabled={!hasRoute}
          onPress={() => router.push("/route?export=1")}
          testID="landing-action-save-pdf"
        />
        <ActionCard
          icon="map"
          title="Mapa"
          desc={hasRoute ? "Ver paradas" : "Carregue uma rota"}
          disabled={!hasRoute}
          onPress={() => router.push("/route")}
          testID="landing-action-map"
        />
        <ActionCard
          icon="flash"
          title="Otimização"
          desc={hasRoute ? "Roteirizar TSP" : "Carregue uma rota"}
          disabled={!hasRoute}
          onPress={() => router.push("/route?optimize=1")}
          testID="landing-action-optimize"
        />
      </View>

      <View style={styles.ctaSection}>
        {hasAccess ? (
          <>
            {hasRoute ? (
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() => router.push("/scanner")}
                testID="landing-continue-route-button"
              >
                <Ionicons name="camera" size={22} color="#fff" />
                <Text style={styles.primaryButtonText}>
                  Bipar pacotes • {routeCount}
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() => router.push("/upload")}
                testID="landing-start-route-button"
              >
                <Ionicons name="cloud-upload" size={20} color="#fff" />
                <Text style={styles.primaryButtonText}>Carregar rota</Text>
              </TouchableOpacity>
            )}

            <View style={styles.secondaryRow}>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => router.push("/history")}
                testID="landing-history-button"
              >
                <Ionicons name="time-outline" size={18} color={COLORS.textPrimary} />
                <Text style={styles.secondaryButtonText}>Histórico</Text>
              </TouchableOpacity>
            </View>
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
              💡 Trial encerrado. Reative pagando o PIX (menos de{" "}
              <Text style={styles.bold}>R$ 1/dia</Text>).
            </Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

function ActionCard({
  icon,
  title,
  desc,
  onPress,
  disabled,
  testID,
}: {
  icon: any;
  title: string;
  desc: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <TouchableOpacity
      style={[styles.featureCard, disabled && styles.featureCardLocked]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.75}
      testID={testID}
    >
      <View style={styles.featureIconRow}>
        <Ionicons name={icon} size={26} color={disabled ? COLORS.textSecondary : COLORS.primary} />
      </View>
      <Text style={[styles.featureTitle, disabled && { color: COLORS.textSecondary }]}>{title}</Text>
      <Text style={styles.featureDesc}>{desc}</Text>
    </TouchableOpacity>
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
  topRow: { flexDirection: "row", alignItems: "center", paddingTop: SPACING.sm, marginBottom: -SPACING.md },
  greeting: { color: COLORS.textTertiary, fontSize: 12, fontWeight: "600" },
  userName: { color: COLORS.textPrimary, fontSize: 16, fontWeight: "800" },
  iconBtn: { padding: 10, borderRadius: RADIUS.full, backgroundColor: COLORS.bgSurface },
  heroSection: { alignItems: "center", marginTop: SPACING.lg },
  logoCircle: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: COLORS.primary,
    justifyContent: "center", alignItems: "center", marginBottom: SPACING.md,
    shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4, shadowRadius: 16,
  },
  title: { fontSize: 28, fontWeight: "900", color: COLORS.textPrimary, letterSpacing: -1 },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, marginTop: SPACING.xs, textAlign: "center" },
  activeBadge: {
    marginTop: SPACING.md, flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(22,163,74,0.15)", paddingHorizontal: SPACING.md,
    paddingVertical: 6, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.success,
  },
  activeBadgeText: { color: COLORS.success, fontWeight: "700", fontSize: 12 },
  trialBadge: {
    marginTop: SPACING.md, flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(234,88,12,0.15)", paddingHorizontal: SPACING.md,
    paddingVertical: 6, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.primary,
  },
  trialBadgeText: { color: COLORS.primary, fontWeight: "800", fontSize: 12 },
  expiredBadge: {
    marginTop: SPACING.md, flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(220,38,38,0.15)", paddingHorizontal: SPACING.md,
    paddingVertical: 6, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.error,
  },
  expiredBadgeText: { color: COLORS.error, fontWeight: "800", fontSize: 12 },
  featuresGrid: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.md, justifyContent: "space-between" },
  routeLoadedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(34,197,94,0.12)",
    borderColor: COLORS.success,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: SPACING.sm,
    alignSelf: "center",
  },
  routeLoadedText: { color: COLORS.success, fontWeight: "800", fontSize: 13 },
  featureCard: {
    width: "47%", backgroundColor: COLORS.bgSurface, borderRadius: RADIUS.lg,
    padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, gap: SPACING.sm,
  },
  featureCardLocked: { opacity: 0.65, borderStyle: "dashed" },
  featureIconRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  lockBadge: { backgroundColor: COLORS.bgElevated, paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.full },
  lockBadgeText: { color: COLORS.textSecondary, fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  featureTitle: { color: COLORS.textPrimary, fontWeight: "700", fontSize: 15 },
  featureDesc: { color: COLORS.textSecondary, fontSize: 12 },
  ctaSection: { gap: SPACING.md, paddingBottom: SPACING.md },
  primaryButton: {
    backgroundColor: COLORS.primary, paddingVertical: 18, borderRadius: RADIUS.lg,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACING.sm,
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
  signOutBtn: { flexDirection: "row", gap: 6, justifyContent: "center", paddingVertical: 8 },
  signOutText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: "600" },
});
