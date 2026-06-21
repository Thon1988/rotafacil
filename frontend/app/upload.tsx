import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";

import { COLORS, RADIUS, SPACING } from "@/src/constants/theme";
import { parseFile, parseText } from "@/src/lib/api";
import { saveRoute } from "@/src/lib/route-store";
import { Stop } from "@/src/types/stop";
import { storage } from "@/src/utils/storage";

const CIRCUIT_KEY = "rota_circuit_mode";

export default function UploadScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [manualText, setManualText] = useState("");
  const [mode, setMode] = useState<"file" | "manual">("file");

  const handlePickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "application/pdf",
          "application/vnd.ms-excel",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "text/csv",
          "text/plain",
        ],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      await processStops(() =>
        parseFile({
          uri: asset.uri,
          name: asset.name || "arquivo",
          type: asset.mimeType || "application/octet-stream",
        })
      );
    } catch {
      Alert.alert("Erro", "Falha ao ler o arquivo.");
    }
  };

  const handleManualSubmit = async () => {
    if (manualText.trim().length < 5) {
      Alert.alert("Atenção", "Cole ao menos um código + endereço.");
      return;
    }
    await processStops(() => parseText(manualText));
  };

  const processStops = async (fetcher: () => Promise<{ stops: Stop[]; total: number }>) => {
    try {
      setLoading(true);
      setLoadingStep("Lendo arquivo...");
      const { stops, total } = await fetcher();

      if (total === 0) {
        Alert.alert(
          "Nenhum código encontrado",
          "Não localizamos códigos Shopee (BR…), Mercado Livre (MLB…) ou Correios no arquivo."
        );
        setLoading(false);
        return;
      }

      // Circuit mode is always-on after the pivot: preserve PDF order.
      await storage.setItem(CIRCUIT_KEY, "1");

      // Save stops IMMEDIATELY without waiting for geocoding.
      // Background geocoding will fill in lat/lon on the route screen.
      const initial = stops.map((s) => ({ ...s, lat: null, lon: null }));
      await saveRoute(initial);

      setLoadingStep("Abrindo scanner...");
      router.replace("/scanner");
    } catch (e) {
      console.log("Process error:", e);
      Alert.alert("Erro", "Não foi possível processar a rota.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]} testID="upload-screen">
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          testID="upload-back-button"
        >
          <Ionicons name="chevron-back" size={28} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Carregar Rota</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, mode === "file" && styles.tabActive]}
          onPress={() => setMode("file")}
          testID="tab-file"
        >
          <Ionicons name="document-text" size={18} color={mode === "file" ? "#fff" : COLORS.textSecondary} />
          <Text style={[styles.tabText, mode === "file" && styles.tabTextActive]}>Arquivo</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, mode === "manual" && styles.tabActive]}
          onPress={() => setMode("manual")}
          testID="tab-manual"
        >
          <Ionicons name="create" size={18} color={mode === "manual" ? "#fff" : COLORS.textSecondary} />
          <Text style={[styles.tabText, mode === "manual" && styles.tabTextActive]}>Manual</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: SPACING.xl * 2 }}>
          {/* Pivot info card */}
          <View style={styles.circuitCard} testID="circuit-mode-card">
            <Ionicons name="checkmark-circle" size={22} color={COLORS.primary} />
            <View style={styles.circuitTextWrap}>
              <Text style={styles.circuitTitle}>🎯 Ordem do Circuit preservada</Text>
              <Text style={styles.circuitDesc}>
                O app mantém exatamente a sequência do PDF do Circuit. Ao bipar
                um pacote, ele fala &quot;Parada N&quot; para você.
              </Text>
            </View>
          </View>

          {mode === "file" ? (
            <View style={styles.uploadBox}>
              <Ionicons name="cloud-upload-outline" size={64} color={COLORS.primary} />
              <Text style={styles.uploadTitle}>Carregue sua lista</Text>
              <Text style={styles.uploadDesc}>
                PDF (Circuit, Shopee), Excel, CSV ou TXT
              </Text>
              <View style={styles.badgesRow}>
                <View style={styles.badge}><Text style={styles.badgeText}>PDF</Text></View>
                <View style={styles.badge}><Text style={styles.badgeText}>XLSX</Text></View>
                <View style={styles.badge}><Text style={styles.badgeText}>CSV</Text></View>
                <View style={styles.badge}><Text style={styles.badgeText}>TXT</Text></View>
              </View>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={handlePickFile}
                disabled={loading}
                testID="pick-file-button"
              >
                <Ionicons name="folder-open" size={20} color="#fff" />
                <Text style={styles.primaryBtnText}>Escolher Arquivo</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.manualBox}>
              <Text style={styles.manualTitle}>Cole sua lista</Text>
              <Text style={styles.manualDesc}>
                Cole o texto com códigos (BR…, MLB…) e endereços. Um por linha.
              </Text>
              <TextInput
                style={styles.textArea}
                placeholder={"Ex:\nBR12345678901 Rua das Flores, 100 - SP\nMLB1234567890 Av. Paulista, 1500 - SP"}
                placeholderTextColor={COLORS.textTertiary}
                multiline
                value={manualText}
                onChangeText={setManualText}
                textAlignVertical="top"
                testID="manual-text-input"
              />
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={handleManualSubmit}
                disabled={loading}
                testID="submit-manual-button"
              >
                <Ionicons name="play" size={20} color="#fff" />
                <Text style={styles.primaryBtnText}>Processar Rota</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.helpCard}>
            <Ionicons name="scan" size={20} color={COLORS.primary} />
            <Text style={styles.helpText}>
              Após processar o PDF do Circuit, o <Text style={{ fontWeight: "800" }}>Scanner</Text> abre
              automaticamente. Bipe cada pacote e o app vai falar o número da
              parada (ex: &quot;Parada 10&quot;).
            </Text>
          </View>

          <View style={[styles.helpCard, { borderColor: COLORS.primary }]}> 
            <Ionicons name="lock-closed" size={20} color={COLORS.primary} />
            <Text style={styles.helpText}>
              <Text style={{ fontWeight: "800" }}>Mapa, otimização de rota e edição de local</Text> serão
              liberados em breve. Por enquanto, foque em bipar e entregar.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {loading && (
        <View style={styles.loadingOverlay} testID="upload-loading-overlay">
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>{loadingStep}</Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgBase },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: SPACING.md,
  },
  backBtn: { width: 40, height: 40, justifyContent: "center" },
  headerTitle: { color: COLORS.textPrimary, fontSize: 18, fontWeight: "800" },
  tabs: {
    flexDirection: "row", marginHorizontal: SPACING.lg, marginVertical: SPACING.md,
    backgroundColor: COLORS.bgSurface, borderRadius: RADIUS.full, padding: 4,
  },
  tab: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: SPACING.xs, paddingVertical: 10, borderRadius: RADIUS.full,
  },
  tabActive: { backgroundColor: COLORS.primary },
  tabText: { color: COLORS.textSecondary, fontWeight: "600", fontSize: 14 },
  tabTextActive: { color: "#fff" },
  body: { paddingHorizontal: SPACING.lg, flex: 1 },

  circuitCard: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    backgroundColor: COLORS.bgSurface, borderRadius: RADIUS.lg,
    padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border,
    marginBottom: SPACING.md,
  },
  circuitTextWrap: { flex: 1 },
  circuitTitle: { color: COLORS.textPrimary, fontWeight: "800", fontSize: 14 },
  circuitDesc: { color: COLORS.textSecondary, fontSize: 12, marginTop: 4, lineHeight: 16 },

  uploadBox: {
    backgroundColor: COLORS.bgSurface, borderRadius: RADIUS.xl, padding: SPACING.lg,
    borderWidth: 2, borderStyle: "dashed", borderColor: COLORS.primary,
    alignItems: "center", gap: SPACING.sm,
  },
  uploadTitle: { color: COLORS.textPrimary, fontSize: 20, fontWeight: "800", marginTop: SPACING.sm },
  uploadDesc: {
    color: COLORS.textSecondary, fontSize: 13, textAlign: "center",
    marginBottom: SPACING.sm, lineHeight: 18,
  },
  badgesRow: { flexDirection: "row", gap: SPACING.sm, marginVertical: SPACING.sm },
  badge: {
    backgroundColor: COLORS.bgElevated, paddingHorizontal: SPACING.md,
    paddingVertical: 6, borderRadius: RADIUS.full,
  },
  badgeText: { color: COLORS.textSecondary, fontSize: 11, fontWeight: "700" },
  primaryBtn: {
    backgroundColor: COLORS.primary, paddingVertical: 16, paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.lg, flexDirection: "row", alignItems: "center",
    gap: SPACING.sm, width: "100%", justifyContent: "center", marginTop: SPACING.md,
  },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },

  manualBox: {
    backgroundColor: COLORS.bgSurface, borderRadius: RADIUS.xl, padding: SPACING.lg,
    borderWidth: 1, borderColor: COLORS.border,
  },
  manualTitle: { color: COLORS.textPrimary, fontSize: 20, fontWeight: "800" },
  manualDesc: {
    color: COLORS.textSecondary, fontSize: 13, marginTop: 4, marginBottom: SPACING.md,
  },
  textArea: {
    backgroundColor: COLORS.bgBase, borderRadius: RADIUS.md, padding: SPACING.md,
    minHeight: 200, color: COLORS.textPrimary, fontSize: 14,
    borderWidth: 1, borderColor: COLORS.border,
  },

  helpCard: {
    flexDirection: "row", backgroundColor: COLORS.bgSurface, borderRadius: RADIUS.md,
    padding: SPACING.md, gap: SPACING.sm, marginTop: SPACING.lg,
    borderWidth: 1, borderColor: COLORS.border,
  },
  helpText: { color: COLORS.textSecondary, fontSize: 12, flex: 1, lineHeight: 17 },

  loadingOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.85)", justifyContent: "center", alignItems: "center",
  },
  loadingCard: {
    backgroundColor: COLORS.bgSurface, padding: SPACING.lg, borderRadius: RADIUS.xl,
    alignItems: "center", gap: SPACING.sm, minWidth: 240,
  },
  loadingText: { color: COLORS.textPrimary, fontWeight: "700", fontSize: 15, marginTop: SPACING.sm },
});
