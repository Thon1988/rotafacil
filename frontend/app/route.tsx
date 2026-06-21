import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Linking,
  Modal,
  Platform,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { WebView } from "react-native-webview";
import * as Haptics from "expo-haptics";

import { COLORS, RADIUS, SPACING } from "@/src/constants/theme";
import { buildLeafletHTML } from "@/src/components/leaflet-map";
import { clearRoute, loadRoute, saveRoute } from "@/src/lib/route-store";
import { optimizeRoute } from "@/src/lib/api";
import { Stop } from "@/src/types/stop";

export default function RouteScreen() {
  const router = useRouter();
  const webviewRef = useRef<WebView>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualCode, setManualCode] = useState("");

  // Load stops on focus
  useFocusEffect(
    useCallback(() => {
      (async () => {
        const data = await loadRoute();
        if (data.length === 0) {
          router.replace("/upload");
          return;
        }
        setStops(data);
      })();
    }, [router])
  );

  // Build map HTML once with initial stops; updates sent via postMessage
  const initialHTML = useMemo(() => buildLeafletHTML(stops), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update map when stops change
  useEffect(() => {
    if (mapReady && webviewRef.current) {
      webviewRef.current.postMessage(JSON.stringify({ type: "update_stops", stops }));
    }
  }, [stops, mapReady]);

  const onWebMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === "map_ready") {
        setMapReady(true);
        webviewRef.current?.postMessage(JSON.stringify({ type: "update_stops", stops }));
      } else if (data.type === "stop_clicked") {
        activateStop(data.index);
      }
    } catch {}
  };

  const activateStop = (idx: number) => {
    setActiveIdx(idx);
    const s = stops[idx];
    if (s?.lat != null && s?.lon != null) {
      webviewRef.current?.postMessage(
        JSON.stringify({ type: "fly_to", lat: s.lat, lon: s.lon, zoom: 15 })
      );
    }
    if (Platform.OS !== "web") Haptics.selectionAsync();
  };

  const markStop = async (status: "entregue" | "falhou") => {
    if (activeIdx === null) {
      Alert.alert("Atenção", "Selecione uma parada primeiro.");
      return;
    }
    const updated = [...stops];
    updated[activeIdx] = {
      ...updated[activeIdx],
      status,
      timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    };
    setStops(updated);
    await saveRoute(updated);
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(
        status === "entregue"
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning
      );
    }
    setActiveIdx(null);
  };

  const navigateExternal = () => {
    if (activeIdx === null) {
      Alert.alert("Atenção", "Selecione uma parada primeiro.");
      return;
    }
    const s = stops[activeIdx];
    const q = encodeURIComponent(s.endereco);
    const url = `https://www.google.com/maps/search/?api=1&query=${q}`;
    Linking.openURL(url);
  };

  const optimizeTSP = async () => {
    setMenuOpen(false);
    if (stops.filter((s) => s.status === "pendente").length <= 2) {
      Alert.alert("Atenção", "Quantidade de paradas pendentes insuficiente.");
      return;
    }
    setOptimizing(true);
    try {
      const { stops: optimized } = await optimizeRoute(stops);
      setStops(optimized);
      await saveRoute(optimized);
      Alert.alert("Sucesso", "Rota otimizada via algoritmo TSP (vizinho mais próximo).");
    } catch {
      Alert.alert("Erro", "Falha ao otimizar a rota.");
    } finally {
      setOptimizing(false);
    }
  };

  const exportCSV = async () => {
    setMenuOpen(false);
    if (stops.length === 0) return;
    let csv = "\uFEFFID,Codigo,Endereco,Status,Horario\n";
    stops.forEach((p) => {
      csv += `"${p.id + 1}","${p.codigo}","${p.endereco.replace(/"/g, '""')}","${p.status.toUpperCase()}","${p.timestamp || "N/A"}"\n`;
    });
    try {
      await Share.share({ message: csv, title: "Relatório Rota Fácil" });
    } catch {
      Alert.alert("Erro", "Falha ao exportar.");
    }
  };

  const clearAll = () => {
    setMenuOpen(false);
    Alert.alert("Apagar Rota", "Deseja apagar a rota ativa?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Apagar",
        style: "destructive",
        onPress: async () => {
          await clearRoute();
          router.replace("/");
        },
      },
    ]);
  };

  const submitManualCode = () => {
    const code = manualCode.trim().toUpperCase();
    if (!code) return;
    const idx = stops.findIndex(
      (s) => s.codigo.toUpperCase().includes(code) || code.includes(s.codigo.toUpperCase())
    );
    if (idx === -1) {
      Alert.alert("Não encontrado", "Código não está nesta rota.");
      return;
    }
    setManualModalOpen(false);
    setManualCode("");
    activateStop(idx);
  };

  const openScanner = () => {
    setMenuOpen(false);
    router.push("/scanner");
  };

  const openManualEntry = () => {
    setMenuOpen(false);
    setManualModalOpen(true);
  };

  const pendingCount = stops.filter((s) => s.status === "pendente").length;
  const activeStop = activeIdx !== null ? stops[activeIdx] : null;

  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID="route-screen">
      {/* MAP - top half */}
      <View style={styles.mapContainer}>
        <WebView
          ref={webviewRef}
          originWhitelist={["*"]}
          source={{ html: initialHTML }}
          onMessage={onWebMessage}
          style={styles.webview}
          javaScriptEnabled
          domStorageEnabled
          androidLayerType="hardware"
          testID="route-map-webview"
        />

        {/* Menu button overlay */}
        <TouchableOpacity
          style={styles.menuBtn}
          onPress={() => setMenuOpen(true)}
          testID="open-menu-button"
        >
          <Ionicons name="menu" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.scannerBtn}
          onPress={openScanner}
          testID="open-scanner-button"
        >
          <Ionicons name="scan" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Floating active stop widget */}
      {activeStop && (
        <View style={styles.activeWidget} testID="active-stop-widget">
          <View style={styles.activeWidgetHeader}>
            <View style={styles.activeBadge}>
              <Text style={styles.activeBadgeText}>{String((activeIdx ?? 0) + 1).padStart(2, "0")}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.activeStreet} numberOfLines={1}>
                {activeStop.endereco.split(",")[0] || "Endereço"}
              </Text>
              <Text style={styles.activeSub} numberOfLines={1}>
                {activeStop.codigo}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setActiveIdx(null)} testID="close-widget-button">
              <Ionicons name="close" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* STOPS LIST */}
      <View style={styles.listContainer}>
        <View style={styles.listHeader}>
          <Text style={styles.listTitle}>Paradas</Text>
          <View style={styles.counterPill}>
            <Ionicons name="flash" size={12} color="#fff" />
            <Text style={styles.counterText} testID="pending-counter">
              {pendingCount} restantes
            </Text>
          </View>
        </View>

        <FlatList
          data={stops}
          keyExtractor={(item) => String(item.id)}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: SPACING.sm }}
          renderItem={({ item, index }) => (
            <TouchableOpacity
              style={[
                styles.stopRow,
                item.status !== "pendente" && styles.stopRowDone,
                activeIdx === index && styles.stopRowActive,
              ]}
              onPress={() => activateStop(index)}
              testID={`stop-row-${index}`}
            >
              <View style={[styles.stopNum, { backgroundColor: getStatusColor(item.status) }]}>
                <Text style={styles.stopNumText}>{index + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.stopCode} numberOfLines={1}>
                  {item.codigo}
                </Text>
                <Text style={styles.stopAddr} numberOfLines={2}>
                  {item.endereco}
                </Text>
                {item.status !== "pendente" && (
                  <Text style={[styles.stopStatus, { color: getStatusColor(item.status) }]}>
                    {item.status.toUpperCase()} • {item.timestamp}
                  </Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={16} color={COLORS.textTertiary} />
            </TouchableOpacity>
          )}
        />
      </View>

      {/* BOTTOM ACTION BAR */}
      <View style={styles.actionBar} testID="action-bar">
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.navBtn]}
            onPress={navigateExternal}
            testID="navigate-button"
          >
            <Ionicons name="navigate" size={20} color="#fff" />
            <Text style={styles.actionBtnText}>Navegar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.failBtn]}
            onPress={() => markStop("falhou")}
            testID="mark-failed-button"
          >
            <Ionicons name="close-circle" size={20} color="#fff" />
            <Text style={styles.actionBtnText}>Falhou</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.deliverBtn]}
            onPress={() => markStop("entregue")}
            testID="mark-delivered-button"
          >
            <Ionicons name="checkmark-circle" size={20} color="#fff" />
            <Text style={styles.actionBtnText}>Entregue</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* MENU MODAL */}
      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setMenuOpen(false)}
        >
          <View style={styles.menuCard}>
            <MenuItem
              icon="scan"
              label="Abrir Scanner"
              onPress={openScanner}
              testID="menu-scanner"
            />
            <MenuItem
              icon="create"
              label="Inserir Código Manual"
              onPress={openManualEntry}
              testID="menu-manual"
            />
            <MenuItem
              icon="flash"
              label={optimizing ? "Otimizando..." : "Otimizar Rota (TSP)"}
              onPress={optimizeTSP}
              testID="menu-optimize"
              disabled={optimizing}
            />
            <MenuItem
              icon="download"
              label="Exportar Relatório CSV"
              onPress={exportCSV}
              testID="menu-export"
            />
            <MenuItem
              icon="add-circle"
              label="Nova Rota"
              onPress={() => {
                setMenuOpen(false);
                router.push("/upload");
              }}
              testID="menu-new-route"
            />
            <MenuItem
              icon="trash"
              label="Apagar Rota Atual"
              onPress={clearAll}
              danger
              testID="menu-clear"
            />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* MANUAL CODE ENTRY MODAL */}
      <Modal
        visible={manualModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setManualModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.manualCard}>
            <Text style={styles.manualCardTitle}>Inserir Código</Text>
            <Text style={styles.manualCardDesc}>
              Digite ou cole o código da encomenda (Shopee BR…, MLB…, etc.)
            </Text>
            <TextInput
              autoFocus
              value={manualCode}
              onChangeText={setManualCode}
              placeholder="Ex: BR12345678901"
              placeholderTextColor={COLORS.textTertiary}
              style={styles.manualInput}
              autoCapitalize="characters"
              testID="manual-code-input"
            />
            <View style={styles.manualBtns}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnCancel]}
                onPress={() => {
                  setManualModalOpen(false);
                  setManualCode("");
                }}
                testID="manual-cancel-button"
              >
                <Text style={styles.modalBtnTextDark}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnPrimary]}
                onPress={submitManualCode}
                testID="manual-submit-button"
              >
                <Text style={styles.modalBtnText}>Localizar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function MenuItem({
  icon,
  label,
  onPress,
  danger,
  disabled,
  testID,
}: {
  icon: any;
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <TouchableOpacity
      style={[styles.menuItem, disabled && { opacity: 0.5 }]}
      onPress={onPress}
      disabled={disabled}
      testID={testID}
    >
      <Ionicons
        name={icon}
        size={20}
        color={danger ? COLORS.error : COLORS.primary}
      />
      <Text style={[styles.menuItemText, danger && { color: COLORS.error }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function getStatusColor(status: string): string {
  if (status === "entregue") return COLORS.success;
  if (status === "falhou") return COLORS.error;
  return COLORS.primary;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgBase },
  mapContainer: { height: "42%", backgroundColor: COLORS.bgSurface, position: "relative" },
  webview: { flex: 1, backgroundColor: COLORS.bgBase },
  menuBtn: {
    position: "absolute",
    top: SPACING.md,
    left: SPACING.md,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  scannerBtn: {
    position: "absolute",
    top: SPACING.md,
    right: SPACING.md,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    justifyContent: "center",
    alignItems: "center",
  },

  activeWidget: {
    position: "absolute",
    top: "42%",
    left: SPACING.md,
    right: SPACING.md,
    backgroundColor: COLORS.bgElevated,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginTop: -28,
    borderWidth: 1,
    borderColor: COLORS.primary,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 12,
    zIndex: 5,
  },
  activeWidgetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
  },
  activeBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  activeBadgeText: { color: "#fff", fontWeight: "900", fontSize: 14 },
  activeStreet: { color: COLORS.textPrimary, fontSize: 15, fontWeight: "800" },
  activeSub: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },

  listContainer: { flex: 1, paddingHorizontal: SPACING.md, paddingTop: SPACING.md },
  listHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: SPACING.sm,
  },
  listTitle: { color: COLORS.textPrimary, fontSize: 18, fontWeight: "800" },
  counterPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
  },
  counterText: { color: "#fff", fontSize: 12, fontWeight: "700" },

  stopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    backgroundColor: COLORS.bgSurface,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  stopRowDone: { opacity: 0.5 },
  stopRowActive: { borderColor: COLORS.primary, borderWidth: 2 },
  stopNum: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  stopNumText: { color: "#fff", fontWeight: "900", fontSize: 13 },
  stopCode: { color: COLORS.primary, fontSize: 13, fontWeight: "700" },
  stopAddr: { color: COLORS.textPrimary, fontSize: 13, marginTop: 2 },
  stopStatus: { fontSize: 11, fontWeight: "700", marginTop: 4 },

  actionBar: {
    backgroundColor: COLORS.bgSurface,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.lg,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  actionRow: { flexDirection: "row", gap: SPACING.sm },
  actionBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.xs,
  },
  navBtn: { backgroundColor: COLORS.bgElevated },
  failBtn: { backgroundColor: COLORS.error },
  deliverBtn: { backgroundColor: COLORS.success },
  actionBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: SPACING.lg,
  },
  menuCard: {
    backgroundColor: COLORS.bgSurface,
    borderRadius: RADIUS.xl,
    width: "100%",
    maxWidth: 360,
    paddingVertical: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
  menuItemText: { color: COLORS.textPrimary, fontSize: 15, fontWeight: "600" },

  manualCard: {
    backgroundColor: COLORS.bgSurface,
    borderRadius: RADIUS.xl,
    width: "100%",
    maxWidth: 400,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  manualCardTitle: { color: COLORS.textPrimary, fontSize: 18, fontWeight: "800" },
  manualCardDesc: { color: COLORS.textSecondary, fontSize: 13, marginTop: 4, marginBottom: SPACING.md },
  manualInput: {
    backgroundColor: COLORS.bgBase,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    color: COLORS.textPrimary,
    fontSize: 15,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.md,
  },
  manualBtns: { flexDirection: "row", gap: SPACING.sm },
  modalBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    alignItems: "center",
  },
  modalBtnPrimary: { backgroundColor: COLORS.primary },
  modalBtnCancel: { backgroundColor: COLORS.bgElevated },
  modalBtnText: { color: "#fff", fontWeight: "800" },
  modalBtnTextDark: { color: COLORS.textPrimary, fontWeight: "700" },
});
