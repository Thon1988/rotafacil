import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";

import { COLORS, RADIUS, SPACING } from "@/src/constants/theme";
import { loadRoute, saveRoute } from "@/src/lib/route-store";
import { Stop } from "@/src/types/stop";

export default function ScannerScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [stops, setStops] = useState<Stop[]>([]);
  const [feedback, setFeedback] = useState<{ msg: string; color: string } | null>(null);
  const [torch, setTorch] = useState(false);
  const lockRef = useRef(false);

  useEffect(() => {
    loadRoute().then(setStops);
  }, []);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  const handleScanned = async ({ data }: { data: string }) => {
    if (lockRef.current) return;
    if (!data || data.length < 4) return;

    lockRef.current = true;
    const token = data.trim().toUpperCase();
    const idx = stops.findIndex(
      (s) => token.includes(s.codigo.toUpperCase()) || s.codigo.toUpperCase().includes(token)
    );

    if (idx !== -1) {
      const s = stops[idx];
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setFeedback({
        msg: `✅ Parada #${idx + 1} • ${s.codigo}`,
        color: COLORS.success,
      });

      // Reset lock after 2s
      setTimeout(() => {
        lockRef.current = false;
        setFeedback(null);
      }, 2500);
    } else {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setFeedback({ msg: `❌ Código não está nesta rota`, color: COLORS.error });
      setTimeout(() => {
        lockRef.current = false;
        setFeedback(null);
      }, 1800);
    }
  };

  // Web fallback: camera APIs differ; show graceful message
  if (Platform.OS === "web") {
    return (
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()} testID="scanner-close-button">
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Scanner</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.webNotice}>
          <Ionicons name="phone-portrait" size={64} color={COLORS.primary} />
          <Text style={styles.webNoticeTitle}>Scanner disponível no celular</Text>
          <Text style={styles.webNoticeDesc}>
            Para escanear códigos de barras, abra o app no seu dispositivo móvel
            (iOS/Android). Use a entrada manual no menu enquanto isso.
          </Text>
          <TouchableOpacity
            style={styles.closeBtnSecondary}
            onPress={() => router.back()}
          >
            <Text style={styles.closeBtnText}>Voltar</Text>
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
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()} testID="scanner-close-button">
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
        </View>
        <View style={styles.permissionBox}>
          <Ionicons name="camera-outline" size={64} color={COLORS.primary} />
          <Text style={styles.permissionTitle}>Acesso à câmera</Text>
          <Text style={styles.permissionDesc}>
            Permita o uso da câmera para escanear códigos de barras de
            encomendas Shopee e Mercado Livre.
          </Text>
          {permission.canAskAgain ? (
            <TouchableOpacity
              style={styles.permissionBtn}
              onPress={requestPermission}
              testID="grant-permission-button"
            >
              <Text style={styles.permissionBtnText}>Conceder Permissão</Text>
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
          barcodeTypes: ["code128", "code39", "code93", "ean13", "ean8", "qr", "pdf417", "upc_a", "upc_e", "itf14"],
        }}
        onBarcodeScanned={handleScanned}
      />

      {/* Overlay */}
      <View style={styles.overlay} pointerEvents="box-none">
        <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1 }}>
          <View style={styles.headerTransparent}>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={() => router.back()}
              testID="scanner-close-button"
            >
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Escanear Código</Text>
            <TouchableOpacity
              style={styles.torchBtn}
              onPress={() => setTorch((t) => !t)}
              testID="torch-toggle-button"
            >
              <Ionicons name={torch ? "flashlight" : "flashlight-outline"} size={24} color="#fff" />
            </TouchableOpacity>
          </View>

          <View style={styles.framingArea}>
            <View style={styles.scanFrame}>
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />
            </View>
            <Text style={styles.helperText}>
              Aponte para o código de barras da encomenda
            </Text>
          </View>

          {feedback && (
            <View style={[styles.feedbackBox, { backgroundColor: feedback.color }]} testID="scanner-feedback">
              <Text style={styles.feedbackText}>{feedback.msg}</Text>
            </View>
          )}

          <View style={styles.footerBar}>
            <Text style={styles.footerText}>
              {stops.length} parada(s) nesta rota
            </Text>
          </View>
        </SafeAreaView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  center: { justifyContent: "center", alignItems: "center" },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.35)" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  headerTransparent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  torchBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: { color: "#fff", fontWeight: "800", fontSize: 16 },

  framingArea: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: SPACING.lg,
  },
  scanFrame: {
    width: 280,
    height: 180,
    position: "relative",
  },
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
  feedbackText: { color: "#fff", fontWeight: "800", fontSize: 15 },

  footerBar: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
    alignItems: "center",
  },
  footerText: { color: COLORS.textSecondary, fontSize: 13 },

  permissionBox: {
    flex: 1,
    padding: SPACING.lg,
    justifyContent: "center",
    alignItems: "center",
    gap: SPACING.md,
  },
  permissionTitle: { color: COLORS.textPrimary, fontSize: 22, fontWeight: "800" },
  permissionDesc: { color: COLORS.textSecondary, textAlign: "center", lineHeight: 22 },
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
  closeBtnSecondary: {
    backgroundColor: COLORS.bgElevated,
    paddingVertical: 14,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.md,
    marginTop: SPACING.md,
  },
  closeBtnText: { color: "#fff", fontWeight: "700" },
});

// Keep saveRoute import referenced (used implicitly when route is preserved)
void saveRoute;
