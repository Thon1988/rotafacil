import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { COLORS, RADIUS, SPACING } from "@/src/constants/theme";
import { getStats, StatsResponse } from "@/src/lib/api";
import { getOrCreateUserId } from "@/src/lib/user";

export default function StatsScreen() {
  const router = useRouter();
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    try {
      const userId = await getOrCreateUserId();
      const s = await getStats(userId);
      setStats(s);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]} testID="stats-screen">
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} testID="stats-back-button">
          <Ionicons name="chevron-back" size={28} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Estatísticas</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading || !stats ? (
        <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.badgeCard}>
            <Text style={styles.badgeLabel}>Seu rank esta semana</Text>
            <Text style={styles.badgeText}>{stats.badge}</Text>
          </View>

          <Text style={styles.section}>Esta semana</Text>
          <View style={styles.row}>
            <Card label="Paradas" value={stats.week.total_stops} icon="cube" />
            <Card label="Entregues" value={stats.week.delivered} icon="checkmark-circle" color={COLORS.success} />
          </View>
          <View style={styles.row}>
            <Card label="Falhas" value={stats.week.failed} icon="close-circle" color={COLORS.error} />
            <Card label="Sucesso" value={`${stats.week.success_rate}%`} icon="trending-up" color={COLORS.primary} />
          </View>

          <Text style={styles.section}>Últimos 30 dias</Text>
          <View style={styles.row}>
            <Card label="Rotas" value={stats.month.routes} icon="map" />
            <Card label="Paradas" value={stats.month.total_stops} icon="cube" />
          </View>
          <View style={styles.row}>
            <Card label="Entregues" value={stats.month.delivered} icon="checkmark-done" color={COLORS.success} />
            <Card label="Sucesso" value={`${stats.month.success_rate}%`} icon="trending-up" color={COLORS.primary} />
          </View>

          {stats.best_day && (
            <View style={styles.bestDayCard}>
              <Ionicons name="trophy" size={28} color="#fbbf24" />
              <View style={{ flex: 1 }}>
                <Text style={styles.bestDayLabel}>Seu melhor dia</Text>
                <Text style={styles.bestDayValue}>
                  {stats.best_day.delivered} entregas em {new Date(stats.best_day.date).toLocaleDateString("pt-BR")}
                </Text>
              </View>
            </View>
          )}

          <Text style={styles.section}>Tudo</Text>
          <View style={styles.row}>
            <Card label="Rotas totais" value={stats.all_time.routes} icon="archive" />
            <Card label="Entregas" value={stats.all_time.delivered} icon="checkmark-circle" color={COLORS.success} />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Card({ label, value, icon, color = COLORS.textPrimary }: { label: string; value: number | string; icon: any; color?: string }) {
  return (
    <View style={styles.card}>
      <Ionicons name={icon} size={20} color={color} />
      <Text style={[styles.cardValue, { color }]}>{value}</Text>
      <Text style={styles.cardLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgBase },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
  },
  backBtn: { width: 40, height: 40, justifyContent: "center" },
  headerTitle: { color: COLORS.textPrimary, fontSize: 20, fontWeight: "800" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  scroll: { padding: SPACING.md, paddingBottom: SPACING.xl },

  badgeCard: {
    backgroundColor: COLORS.bgSurface, borderRadius: RADIUS.xl,
    padding: SPACING.lg, alignItems: "center", borderWidth: 1, borderColor: COLORS.primary,
    marginBottom: SPACING.lg,
  },
  badgeLabel: { color: COLORS.textSecondary, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 },
  badgeText: { color: COLORS.textPrimary, fontSize: 28, fontWeight: "900", marginTop: SPACING.sm },

  section: {
    color: COLORS.textPrimary, fontWeight: "800", fontSize: 16,
    marginTop: SPACING.md, marginBottom: SPACING.sm,
  },
  row: { flexDirection: "row", gap: SPACING.sm, marginBottom: SPACING.sm },
  card: {
    flex: 1, backgroundColor: COLORS.bgSurface, borderRadius: RADIUS.lg,
    padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, gap: SPACING.xs,
  },
  cardValue: { fontSize: 28, fontWeight: "900" },
  cardLabel: { color: COLORS.textSecondary, fontSize: 12 },

  bestDayCard: {
    flexDirection: "row", gap: SPACING.md, alignItems: "center",
    backgroundColor: "rgba(251,191,36,0.1)", borderRadius: RADIUS.lg,
    padding: SPACING.md, borderWidth: 1, borderColor: "#fbbf24",
    marginVertical: SPACING.md,
  },
  bestDayLabel: { color: "#fbbf24", fontWeight: "700", fontSize: 12, textTransform: "uppercase", letterSpacing: 1 },
  bestDayValue: { color: COLORS.textPrimary, fontWeight: "800", fontSize: 16, marginTop: 4 },
});
