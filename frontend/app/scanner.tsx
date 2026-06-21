import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";

import { COLORS, RADIUS, SPACING } from "@/src/constants/theme";
import { loadRoute, saveRoute, clearRoute } from "@/src/lib/route-store";
import { Stop } from "@/src/types/stop";

/**
 * Pivot scanner screen:
 *  - Loads stops from PDF (already saved by /upload).
 *  - Camera is always on (full screen).
 *  - On scan -> finds the matching stop by code, marks as "entregue",
 *    speaks "Parada N" using expo-speech, shows X de Y counter.
 *  - The route order from the PDF is preserved (we never reorder).
 */
export default function ScannerScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [stops, setStops] = useState<Stop[]>([]);
  const [feedback, setFeedback] = useState<{
    msg: string;
    detail?: string;
    color: string;
  } | null>(null);
  const [torch, setTorch] = useState(false);
  const [lastScanned, setLastScanned] = useState<{
    sequence: number;
    code: string;
    address: string;
  } | null>(null);
  const lockRef = useRef(false);
  const recentRef = useRef<Map<string, number>>(new Map());

  // Load stops on focus
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const data = await loadRoute();
        if (cancelled) return;
        if (data.length === 0) {
          router.replace("/upload");
          return;
        }
        setStops(data);
      })();
      return () => {
        cancelled = true;
      };
    }, [router])
  );

  // Request permission once
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  // Cancel pending TTS on unmount
  useEffect(() => {
    return () => {
      try {
        Speech.stop();
      } catch {
        /* noop */
      }
    };
  }, []);

  const counts = useMemo(() => {
    const done = stops.filter((s) => s.status === "entregue").length;
    const failed = stops.filter((s) => s.status === "falhou").length;
    return { done, failed, total: stops.length, remaining: stops.length - done - failed };
  }, [stops]);

  const speakStop = useCallback((sequenceNumber: number) => {
    try {
      Speech.stop();
      Speech.speak(`Parada ${sequenceNumber}`, {
        language: "pt-BR",
        rate: Platform.OS === "ios" ? 0.5 : 1.0,
        pitch: 1.0,
      });
    } catch (e) {
      console.log("Speech error", e);
    }
  }, []);

  const handleScanned = useCallback(
    async ({ data }: { data: string }) => {
      if (lockRef.current) return;
      if (!data || data.length < 4) return;

      const token = data.trim().toUpperCase();

      // Debounce identical codes for 4s
      const now = Date.now();
      const lastTime = recentRef.current.get(token);
      if (lastTime && now - lastTime < 4000) return;
      recentRef.current.set(token, now);

      lockRef.current = true;

      // Match against route codes: bidirectional includes for robustness
      const idx = stops.findIndex((s) => {
        const c = (s.codigo || "").toUpperCase();
        if (!c || c.length < 4) return false;
        return token.includes(c) || c.includes(token);
      });

      if (idx !== -1) {
        const stop = stops[idx];
        const seq = idx + 1;
        const alreadyDelivered = stop.status === "entregue";

        // Update status & persist
        if (!alreadyDelivered) {
          const updated = stops.map((s, i) =>
            i === idx
              ? {
                  ...s,
                  status: "entregue" as const,
                  timestamp: new Date().toISOString(),
                }
              : s
          );
          setStops(updated);
          await saveRoute(updated);
        }

        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        speakStop(seq);
        setLastScanned({ sequence: seq, code: stop.codigo, address: stop.endereco });
        setFeedback({
          msg: alreadyDelivered ? `Parada ${seq} (já bipada)` : `✅ Parada ${seq}`,
          detail: stop.endereco,
          color: alreadyDelivered ? COLORS.textSecondary : COLORS.success,
        });

        setTimeout(() => {
          lockRef.current = false;
          setFeedback(null);
        }, 2200);
      } else {
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        }
        setFeedback({
          msg: "❌ Código não está nesta rota",
          detail: token.slice(0, 28),
          color: COLORS.error,
        });
        setTimeout(() => {
          lockRef.current = false;
          setFeedback(null);
        }, 1800);
      }
    },
    [stops, speakStop]
  );

  const resetRoute = useCallback(async () => {
    Speech.stop();
    await clearRoute();
    router.replace("/upload");
  }, [router]);

  // -------- Web fallback --------
  if (Platform.OS === "web") {
    return (
      <SafeAreaView style={styles.containerLight} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.headerBtnLight}
            onPress={() => router.back()}
            testID="scanner-close-button"
          >
            <Ionicons name="chevron-back" size={26} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitleLight}>Bipar Pacotes</Text>
          <View style={{ width: 44 }} />
        </View>
        <View style={styles.webNotice}>
          <Ionicons name="phone-portrait" size={64} color={COLORS.primary} />
          <Text style={styles.webNoticeTitle}>
            Scanner disponível no celular
          </Text>
          <Text style={styles.webNoticeDesc}>
            Para escanear códigos e ouvir a parada falada, abra o app no
            celular (iOS/Android) pelo QR code do Expo Go.
          </Text>
          <View style={styles.statsCardLight}>
            <Text style={styles.statsLightTitle}>Rota carregada</Text>
            <Text style={styles.statsLightValue}>{stops.length} paradas</Text>
          </View>
          <TouchableOpacity style={styles.btnSecondary} onPress={() => router.back()}>
            <Text style={styles.btnSecondaryText}>Voltar</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!permission) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.containerLight} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.headerBtnLight}
            onPress={() => router.back()}
            testID="scanner-close-button"
          >
            <Ionicons name="chevron-back" size={26} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitleLight}>Permissão</Text>
          <View style={{ width: 44 }} />
        </View>
        <View style={styles.permissionBox}>
          <Ionicons name="camera-outline" size={72} color={COLORS.primary} />
          <Text style={styles.permissionTitle}>Acesso à câmera</Text>
          <Text style={styles.permissionDesc}>
            Para escanear os códigos dos pacotes e ouvir o número da parada,
            o app precisa usar sua câmera.
          </Text>
          {permission.canAskAgain ? (
            <TouchableOpacity
              style={styles.permissionBtn}
              onPress={requestPermission}
              testID="grant-permission-button"
            >
              <Text style={styles.permissionBtnText}>Permitir Câmera</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.permissionBtn}
              onPress={() => Linking.openSettings()}
              testID="open-settings-button"
            >
              <Text style={styles.permissionBtnText}>Abrir Configurações</Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container} testID="scanner-screen">
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{
          barcodeTypes: [
            "code128",
            "code39",
            "code93",
            "ean13",
            "ean8",
            "qr",
            "pdf417",
            "upc_a",
            "upc_e",
            "itf14",
          ],
        }}
        onBarcodeScanned={handleScanned}
      />

      {/* Overlay */}
      <View style={styles.overlay} pointerEvents="box-none">
        <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1 }}>
          {/* Top bar */}
          <View style={styles.topBar}>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => router.back()}
              testID="scanner-back-button"
            >
              <Ionicons name="chevron-back" size={26} color="#fff" />
            </TouchableOpacity>
            <View style={styles.counterPill}>
              <Ionicons name="cube" size={16} color="#fff" />
              <Text style={styles.counterPillText}>
                {counts.done} de {counts.total}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => setTorch((t) => !t)}
              testID="torch-toggle-button"
            >
              <Ionicons
                name={torch ? "flashlight" : "flashlight-outline"}
                size={22}
                color="#fff"
              />
            </TouchableOpacity>
          </View>

          {/* Framing area */}
          <View style={styles.framingArea}>
            <View style={styles.scanFrame}>
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />
            </View>
            <Text style={styles.helperText}>
              Aponte para o código de barras do pacote
            </Text>
          </View>

          {/* Feedback / Last scanned */}
          {feedback ? (
            <View
              style={[styles.feedbackBox, { backgroundColor: feedback.color }]}
              testID="scanner-feedback"
            >
              <Text style={styles.feedbackText}>{feedback.msg}</Text>
              {feedback.detail ? (
                <Text style={styles.feedbackDetail} numberOfLines={2}>
                  {feedback.detail}
                </Text>
              ) : null}
            </View>
          ) : lastScanned ? (
            <View style={styles.lastBox}>
              <View style={styles.lastBadge}>
                <Text style={styles.lastBadgeText}>
                  Última: Parada {lastScanned.sequence}
                </Text>
              </View>
              <Text style={styles.lastAddress} numberOfLines={2}>
                {lastScanned.address}
              </Text>
            </View>
          ) : (
            <View style={styles.hintBox}>
              <Ionicons name="volume-high" size={16} color="#fff" />
              <Text style={styles.hintText}>
                A cada bipagem o app vai falar o número da parada.
              </Text>
            </View>
          )}

          {/* Bottom bar with stats */}
          <View style={styles.bottomBar}>
            <View style={styles.statTile}>
              <Text style={styles.statValue}>{counts.done}</Text>
              <Text style={styles.statLabel}>Bipados</Text>
            </View>
            <View style={[styles.statTile, styles.statTileMid]}>
              <Text style={[styles.statValue, { color: COLORS.primary }]}>
                {counts.remaining}
              </Text>
              <Text style={styles.statLabel}>Faltam</Text>
            </View>
            <View style={styles.statTile}>
              <Text style={styles.statValue}>{counts.total}</Text>
              <Text style={styles.statLabel}>Total</Text>
            </View>
            <TouchableOpacity
              style={styles.resetBtn}
              onPress={resetRoute}
              testID="reset-route-button"
            >
              <Ionicons name="refresh" size={18} color="#fff" />
              <Text style={styles.resetBtnText}>Nova rota</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    </View>
  );
}

// keep ScrollView referenced for future use without lint warnings
void ScrollView;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  containerLight: { flex: 1, backgroundColor: COLORS.bgBase },
  center: { justifyContent: "center", alignItems: "center" },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.30)" },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  headerBtnLight: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "flex-start",
  },
  headerTitleLight: {
    color: COLORS.textPrimary,
    fontWeight: "800",
    fontSize: 18,
  },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  counterPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: 8,
    borderRadius: RADIUS.full,
  },
  counterPillText: { color: "#fff", fontWeight: "800", fontSize: 14 },

  framingArea: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: SPACING.lg,
  },
  scanFrame: { width: 280, height: 180, position: "relative" },
  corner: {
    position: "absolute",
    width: 40,
    height: 40,
    borderColor: COLORS.primary,
    borderWidth: 4,
  },
  cornerTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0 },
  cornerTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0 },
  cornerBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0 },
  cornerBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0 },
  helperText: {
    color: "#fff",
    marginTop: SPACING.lg,
    fontWeight: "600",
    textAlign: "center",
  },

  feedbackBox: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    alignItems: "center",
  },
  feedbackText: { color: "#fff", fontWeight: "800", fontSize: 18 },
  feedbackDetail: {
    color: "rgba(255,255,255,0.92)",
    fontWeight: "600",
    fontSize: 13,
    marginTop: 4,
    textAlign: "center",
  },
  lastBox: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
  },
  lastBadge: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: 4,
    borderRadius: RADIUS.full,
    marginBottom: 6,
  },
  lastBadgeText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  lastAddress: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
  hintBox: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    backgroundColor: "rgba(0,0,0,0.55)",
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
  },
  hintText: { color: "#fff", fontSize: 12, fontWeight: "600", flex: 1 },

  bottomBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.sm,
    gap: SPACING.sm,
  },
  statTile: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.sm,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  statTileMid: { borderColor: COLORS.primary },
  statValue: { color: "#fff", fontSize: 20, fontWeight: "900" },
  statLabel: { color: "rgba(255,255,255,0.75)", fontSize: 11, fontWeight: "600" },
  resetBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.bgElevated,
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  resetBtnText: { color: "#fff", fontWeight: "800", fontSize: 12 },

  permissionBox: {
    flex: 1,
    padding: SPACING.lg,
    justifyContent: "center",
    alignItems: "center",
    gap: SPACING.md,
  },
  permissionTitle: { color: COLORS.textPrimary, fontSize: 22, fontWeight: "800" },
  permissionDesc: {
    color: COLORS.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
  permissionBtn: {
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.lg,
    marginTop: SPACING.md,
  },
  permissionBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },

  webNotice: {
    flex: 1,
    padding: SPACING.lg,
    justifyContent: "center",
    alignItems: "center",
    gap: SPACING.md,
  },
  webNoticeTitle: { color: COLORS.textPrimary, fontSize: 20, fontWeight: "800" },
  webNoticeDesc: {
    color: COLORS.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
  statsCardLight: {
    backgroundColor: COLORS.bgSurface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
    minWidth: 200,
  },
  statsLightTitle: { color: COLORS.textSecondary, fontSize: 12, fontWeight: "700" },
  statsLightValue: {
    color: COLORS.primary,
    fontSize: 22,
    fontWeight: "900",
    marginTop: 4,
  },
  btnSecondary: {
    backgroundColor: COLORS.bgElevated,
    paddingVertical: 12,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.md,
  },
  btnSecondaryText: { color: COLORS.textPrimary, fontWeight: "700" },
});
