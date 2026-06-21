import { useEffect, useState } from "react";
import { ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { COLORS, RADIUS, SPACING } from "@/src/constants/theme";
import { loadRoute } from "@/src/lib/route-store";
import { Stop } from "@/src/types/stop";

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export default function SummaryScreen() {
  const router = useRouter();
  const [stops, setStops] = useState<Stop[]>([]);

  useEffect(() => { loadRoute().then(setStops); }, []);

  const delivered = stops.filter((s) => s.status === "entregue");
  const failed = stops.filter((s) => s.status === "falhou");
  const pending = stops.filter((s) => s.status === "pendente");
  const durations = stops.map((s) => s.duration_seconds || 0).filter((d) => d > 0);
  const totalDuration = durations.reduce((a, b) => a + b, 0);
  const avgDuration = durations.length > 0 ? totalDuration / durations.length : 0;

  const exportCSV = async () => {
    let csv = "\uFEFFOrdem,Codigo,Endereco,Status,Horario,Tempo_desde_anterior\n";
    stops.forEach((s, i) => {
      csv += `"${i + 1}","${s.codigo}","${s.endereco.replace(/"/g, '""')}","${s.status.toUpperCase()}","${s.timestamp || ""}","${formatDuration(s.duration_seconds)}"\n`;
    });
    await Share.share({ message: csv, title: "Resumo Rota+Rápida" });
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]} testID="summary-screen">
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} testID="summary-back-button">
          <Ionicons name="chevron-back" size={28} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Resumo da Rota</Text>
        <TouchableOpacity style={styles.shareBtn} onPress={exportCSV} testID="export-summary-button">
          <Ionicons name="share-outline" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xl }}>
        {/* Top stats */}
        <View style={styles.metricRow}>
          <Metric value={delivered.length} label="Entregues" color={COLORS.success} icon="checkmark-circle" />
          <Metric value={failed.length} label="Falhas" color={COLORS.error} icon="close-circle" />
          <Metric value={pending.length} label="Pendentes" color={COLORS.primary} icon="hourglass" />
        </View>

        {durations.length > 0 && (
          <View style={styles.timeCard}>
            <View style={styles.timeRow}>
              <Ionicons name="time" size={20} color={COLORS.primary} />
              <Text style={styles.timeLabel}>Tempo médio por parada</Text>
              <Text style={styles.timeValue}>{formatDuration(avgDuration)}</Text>
            </View>
            <View style={styles.timeRow}>
              <Ionicons name="hourglass" size={20} color={COLORS.primary} />
              <Text style={styles.timeLabel}>Tempo total na rota</Text>
              <Text style={styles.timeValue}>{formatDuration(totalDuration)}</Text>
            </View>
          </View>
        )}

        {/* Entregues */}
        {delivered.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>
              <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />  Entregas concluídas ({delivered.length})
            </Text>
            {delivered.map((s, idx) => (
              <StopCard key={`d-${s.codigo}-${idx}`} stop={s} index={stops.indexOf(s)} statusColor={COLORS.success} />
            ))}
          </>
        )}

        {/* Falhas */}
        {failed.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>
              <Ionicons name="close-circle" size={16} color={COLORS.error} />  Não entregues ({failed.length})
            </Text>
            {failed.map((s, idx) => (
              <StopCard key={`f-${s.codigo}-${idx}`} stop={s} index={stops.indexOf(s)} statusColor={COLORS.error} />
            ))}
          </>
        )}

        {/* Pendentes */}
        {pending.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>
              <Ionicons name="hourglass" size={16} color={COLORS.primary} />  Pendentes ({pending.length})
            </Text>
            {pending.map((s, idx) => (
              <StopCard key={`p-${s.codigo}-${idx}`} stop={s} index={stops.indexOf(s)} statusColor={COLORS.primary} />
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StopCard({ stop, index, statusColor }: { stop: Stop; index: number; statusColor: string }) {
  return (
    <View style={[styles.stopCard, { borderLeftColor: statusColor }]} testID={`summary-stop-${index}`}>
      <View style={styles.stopHeader}>
        <Text style={styles.stopCodigo}>#{index + 1} • {stop.codigo}</Text>
        {stop.timestamp && <Text style={styles.stopTime}>{stop.timestamp}</Text>}
      </View>
      <Text style={styles.stopAddr} numberOfLines={2}>{stop.endereco}</Text>
      {stop.duration_seconds && stop.duration_seconds > 0 && (
        <View style={styles.durBadge}>
          <Ionicons name="walk" size={12} color={COLORS.textSecondary} />
          <Text style={styles.durText}>{formatDuration(stop.duration_seconds)} desde a anterior</Text>
        </View>
      )}
    </View>
  );
}

function Metric({ value, label, color, icon }: { value: number; label: string; color: string; icon: any }) {
  return (
    <View style={styles.metricCard}>
      <Ionicons name={icon} size={20} color={color} />
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
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
  shareBtn: { width: 40, height: 40, justifyContent: "center", alignItems: "flex-end" },
  headerTitle: { color: COLORS.textPrimary, fontSize: 20, fontWeight: "800" },

  metricRow: { flexDirection: "row", gap: SPACING.sm, marginBottom: SPACING.md },
  metricCard: {
    flex: 1, backgroundColor: COLORS.bgSurface, borderRadius: RADIUS.lg,
    padding: SPACING.md, alignItems: "center", borderWidth: 1, borderColor: COLORS.border, gap: 4,
  },
  metricValue: { fontSize: 28, fontWeight: "900" },
  metricLabel: { color: COLORS.textSecondary, fontSize: 11 },

  timeCard: {
    backgroundColor: COLORS.bgSurface, borderRadius: RADIUS.lg,
    padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, gap: SPACING.sm,
  },
  timeRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  timeLabel: { color: COLORS.textPrimary, fontSize: 14, flex: 1 },
  timeValue: { color: COLORS.primary, fontWeight: "800" },

  sectionTitle: {
    color: COLORS.textPrimary, fontWeight: "800", fontSize: 15,
    marginTop: SPACING.lg, marginBottom: SPACING.sm,
  },
  stopCard: {
    backgroundColor: COLORS.bgSurface, borderRadius: RADIUS.md,
    padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border,
    borderLeftWidth: 4, marginBottom: SPACING.sm,
  },
  stopHeader: { flexDirection: "row", justifyContent: "space-between" },
  stopCodigo: { color: COLORS.primary, fontWeight: "700", fontSize: 13 },
  stopTime: { color: COLORS.textTertiary, fontSize: 11 },
  stopAddr: { color: COLORS.textPrimary, fontSize: 13, marginTop: 4 },
  durBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    marginTop: SPACING.sm, paddingTop: SPACING.sm,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  durText: { color: COLORS.textSecondary, fontSize: 11 },
});
