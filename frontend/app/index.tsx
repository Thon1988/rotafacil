import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { COLORS, RADIUS, SPACING } from "@/src/constants/theme";
import { getOrCreateUserId } from "@/src/lib/user";
import { getSubscription } from "@/src/lib/api";
import { loadRoute } from "@/src/lib/route-store";

export default function Index() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [hasSubscription, setHasSubscription] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const userId = await getOrCreateUserId();
        const sub = await getSubscription(userId);
        setHasSubscription(sub.active);

        // If has active subscription and route already exists, go straight to route screen
        if (sub.active) {
          const route = await loadRoute();
          if (route.length > 0) {
            router.replace("/route");
            return;
          }
        }
      } catch (e) {
        console.log("Erro ao verificar assinatura:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  if (loading) {
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
        <Text style={styles.title} testID="landing-title">Rota Fácil</Text>
        <Text style={styles.subtitle}>
          Roteirização inteligente para entregadores
        </Text>
      </View>

      <View style={styles.featuresGrid}>
        <FeatureCard icon="map" title="Mapa" desc="Rota otimizada visual" />
        <FeatureCard icon="scan" title="Scanner" desc="Shopee & Mercado Livre" />
        <FeatureCard icon="flash" title="TSP" desc="Algoritmo de proximidade" />
        <FeatureCard icon="document-text" title="Importar" desc="PDF, Excel, CSV" />
      </View>

      <View style={styles.ctaSection}>
        {hasSubscription ? (
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => router.push("/upload")}
            testID="landing-start-route-button"
          >
            <Ionicons name="rocket" size={20} color="#fff" />
            <Text style={styles.primaryButtonText}>Iniciar Nova Rota</Text>
          </TouchableOpacity>
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
  loadingContainer: {
    flex: 1,
    backgroundColor: COLORS.bgBase,
    justifyContent: "center",
    alignItems: "center",
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.bgBase,
    paddingHorizontal: SPACING.lg,
    justifyContent: "space-between",
  },
  heroSection: {
    alignItems: "center",
    marginTop: SPACING.xl,
  },
  logoCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
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
    fontSize: 36,
    fontWeight: "900",
    color: COLORS.textPrimary,
    letterSpacing: -1,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textSecondary,
    marginTop: SPACING.sm,
    textAlign: "center",
  },
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
  },
  featureTitle: {
    color: COLORS.textPrimary,
    fontWeight: "700",
    fontSize: 15,
  },
  featureDesc: {
    color: COLORS.textSecondary,
    fontSize: 12,
  },
  ctaSection: {
    gap: SPACING.md,
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 18,
    borderRadius: RADIUS.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.sm,
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "800",
  },
  pricingNote: {
    color: COLORS.textSecondary,
    fontSize: 14,
    textAlign: "center",
  },
  bold: {
    color: COLORS.primary,
    fontWeight: "800",
  },
});
