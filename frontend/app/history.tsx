import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { COLORS, RADIUS, SPACING } from "@/src/constants/theme";
import { getHistory, SavedRoute } from "@/src/lib/api";
import { getOrCreateUserId } from "@/src/lib/user";

export default function HistoryScreen() {
  const router = useRouter();
  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetch = useCallback(async () => {
    try {
      const userId = await getOrCreateUserId();
      const { routes } = await getHistory(userId);
      setRoutes(routes || []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const onRefresh = () => {
    setRefreshing(true);
    fetch();
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]} testID="history-screen">
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} testID="history-back-button">
          <Ionicons name="chevron-back" size={28} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Histórico</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      ) : routes.length === 0 ? (
        <View style={styles.empty} testID="history-empty">
          <Ionicons name="archive-outline" size={64} color={COLORS.textTertiary} />
          <Text style={styles.emptyTitle}>Nenhuma rota concluída</Text>
          <Text style={styles.emptyDesc}>
            Suas rotas finalizadas aparecerão aqui com estatísticas.
          </Text>
        </View>
      ) : (
        <FlatList
          data={routes}
          keyExtractor={(item) => item.route_id}
          contentContainerStyle={{ padding: SPACING.md, gap: SPACING.sm }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
          renderItem={({ item }) => {
            const successRate = item.total_stops > 0 ? Math.round((item.delivered / item.total_stops) * 100) : 0;
            const date = new Date(item.started_at).toLocaleDateString("pt-BR");
            const time = new Date(item.started_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
            return (
              <View style={styles.card} testID={`history-card-${item.route_id}`}>
                <View style={styles.cardTop}>
                  <View style={styles.cardIcon}>
                    <Ionicons name="map" size={20} color={COLORS.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardDate}>{date} • {time}</Text>
                    <Text style={styles.cardStops}>{item.total_stops} paradas</Text>
                  </View>
                  <View style={[styles.ratePill, { backgroundColor: successRate >= 80 ? COLORS.success : successRate >= 50 ? COLORS.pending : COLORS.error }]}>
                    <Text style={styles.ratePillText}>{successRate}%</Text>
                  </View>
                </View>
                <View style={styles.cardStats}>
                  <Stat icon="checkmark-circle" value={item.delivered} label="Entregues" color={COLORS.success} />
                  <Stat icon="close-circle" value={item.failed} label="Falhas" color={COLORS.error} />
                  <Stat icon="hourglass" value={item.total_stops - item.delivered - item.failed} label="Pendentes" color={COLORS.textSecondary} />
                </View>
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

function Stat({ icon, value, label, color }: { icon: any; value: number; label: string; color: string }) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={14} color={color} />
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
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
  empty: { flex: 1, justifyContent: "center", alignItems: "center", padding: SPACING.xl, gap: SPACING.md },
  emptyTitle: { color: COLORS.textPrimary, fontSize: 18, fontWeight: "800" },
  emptyDesc: { color: COLORS.textSecondary, textAlign: "center" },
  card: {
    backgroundColor: COLORS.bgSurface, borderRadius: RADIUS.lg,
    padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  cardIcon: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.bgElevated,
    justifyContent: "center", alignItems: "center",
  },
  cardDate: { color: COLORS.textPrimary, fontSize: 14, fontWeight: "700" },
  cardStops: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  ratePill: { paddingHorizontal: SPACING.md, paddingVertical: 4, borderRadius: RADIUS.full },
  ratePillText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  cardStats: {
    flexDirection: "row", justifyContent: "space-around",
    marginTop: SPACING.md, paddingTop: SPACING.sm,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  stat: { alignItems: "center", gap: 2 },
  statValue: { fontSize: 18, fontWeight: "800" },
  statLabel: { color: COLORS.textTertiary, fontSize: 11 },
});
