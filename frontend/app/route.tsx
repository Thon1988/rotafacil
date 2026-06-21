import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  ActivityIndicator,
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
import * as Haptics from "expo-haptics";

import { COLORS, RADIUS, SPACING, API } from "@/src/constants/theme";
import RouteMap, { MapHandle, MapMessage } from "@/src/components/route-map";
import { clearRoute, loadRoute, saveRoute } from "@/src/lib/route-store";
import { computeMetrics, geocodeBatch, optimizeRoute, RouteMetrics, saveHistory } from "@/src/lib/api";
import { Stop } from "@/src/types/stop";
import { getOrCreateUserId } from "@/src/lib/user";
import { loadSettings } from "@/src/lib/route-settings";
import { storage } from "@/src/utils/storage";

export default function RouteScreen() {
  const router = useRouter();
  const mapRef = useRef<MapHandle>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [metrics, setMetrics] = useState<RouteMetrics | null>(null);
  const [geoProgress, setGeoProgress] = useState<{ done: number; total: number } | null>(null);
  const [editLocationIdx, setEditLocationIdx] = useState<number | null>(null);
  const [editAddress, setEditAddress] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [circuitMode, setCircuitMode] = useState(false);
  const lastStopTimeRef = useRef<number>(Date.now());

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
        const cm = await storage.getItem<string>("rota_circuit_mode", "");
        setCircuitMode(cm === "1");

        // Trigger background geocoding for any stop without coords
        const missingIdx = data
          .map((s, i) => ({ s, i }))
          .filter(({ s }) => s.lat == null || s.lon == null);
        if (missingIdx.length > 0) {
          backgroundGeocode(data, missingIdx.map((m) => m.i));
        }
      })();
    }, [router])
  );

  const backgroundGeocode = useCallback(async (current: Stop[], indices: number[]) => {
    setGeoProgress({ done: 0, total: indices.length });
    try {
      const addresses = indices.map((i) => current[i].endereco);
      const { results } = await geocodeBatch(addresses);
      const updated = [...current];
      results.forEach((r: any, k: number) => {
        const idx = indices[k];
        if (r?.found) {
          updated[idx] = { ...updated[idx], lat: r.lat, lon: r.lon };
        } else {
          // Fallback fake coords near São Paulo so map renders something
          updated[idx] = {
            ...updated[idx],
            lat: -23.55 + (Math.random() - 0.5) * 0.1,
            lon: -46.63 + (Math.random() - 0.5) * 0.1,
          };
        }
      });
      setStops(updated);
      await saveRoute(updated);
    } catch (e) {
      console.log("bg geocode error", e);
    } finally {
      setGeoProgress(null);
    }
  }, []);

  // Initial stops for map (snapshot). Live updates via postMessage.
  const initialStops = useMemo(() => stops, [stops.length === 0 ? 0 : 1]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update map when stops change
  useEffect(() => {
    if (mapReady && mapRef.current) {
      mapRef.current.updateStops(stops);
    }
  }, [stops, mapReady]);

  const onMapMessage = useCallback((data: MapMessage) => {
    if (data.type === "map_ready") {
      setMapReady(true);
    } else if (data.type === "stop_clicked") {
      activateStop(data.index);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops]);

  const activateStop = (idx: number) => {
    setActiveIdx(idx);
    const s = stops[idx];
    if (s?.lat != null && s?.lon != null) {
      mapRef.current?.flyTo(s.lat, s.lon, 15);
    }
    if (Platform.OS !== "web") Haptics.selectionAsync();
  };

  const markStop = async (status: "entregue" | "falhou") => {
    if (activeIdx === null) {
      Alert.alert("Atenção", "Selecione uma parada primeiro.");
      return;
    }
    const now = Date.now();
    const elapsed = Math.round((now - lastStopTimeRef.current) / 1000);
    const updated = [...stops];
    updated[activeIdx] = {
      ...updated[activeIdx],
      status,
      timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      duration_seconds: elapsed,
    };
    setStops(updated);
    await saveRoute(updated);
    lastStopTimeRef.current = now;
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
    if (circuitMode) {
      Alert.alert(
        "Modo Circuit ativo",
        "A ordem da rota já está mantida do PDF. Para reotimizar, desative o modo Circuit na tela de upload.",
      );
      return;
    }
    if (stops.filter((s) => s.status === "pendente").length <= 1) {
      Alert.alert("Atenção", "Quantidade de paradas pendentes insuficiente.");
      return;
    }
    // Require all pending stops to have coordinates
    const missing = stops.filter((s) => s.status === "pendente" && (s.lat == null || s.lon == null));
    if (missing.length > 0) {
      Alert.alert("Aguarde", `Ainda localizando ${missing.length} endereço(s)…`);
      return;
    }
    setOptimizing(true);
    try {
      const settings = await loadSettings();
      const { stops: optimized, metrics: m } = await optimizeRoute(stops, {
        start_lat: settings.startLat,
        start_lon: settings.startLon,
        return_to_start: settings.returnToStart,
        minutes_per_stop: settings.minutesPerStop,
        avg_speed_kmh: settings.avgSpeedKmh,
      });
      setStops(optimized);
      await saveRoute(optimized);
      setMetrics(m);
      if (m) {
        const h = Math.floor(m.estimated_minutes / 60);
        const min = Math.round(m.estimated_minutes % 60);
        const timeStr = h > 0 ? `${h}h ${min}min` : `${min}min`;
        Alert.alert("Rota Otimizada ⚡", `${m.total_distance_km.toFixed(1)} km • ~${timeStr}`);
      }
    } catch {
      Alert.alert("Erro", "Falha ao otimizar a rota.");
    } finally {
      setOptimizing(false);
    }
  };

  // Compute metrics without reordering (for Circuit mode)
  useEffect(() => {
    if (!circuitMode) return;
    const pending = stops.filter((s) => s.status === "pendente" && s.lat != null && s.lon != null);
    if (pending.length === 0) return;
    (async () => {
      try {
        const settings = await loadSettings();
        const m = await computeMetrics(stops, {
          start_lat: settings.startLat,
          start_lon: settings.startLon,
          return_to_start: settings.returnToStart,
          minutes_per_stop: settings.minutesPerStop,
          avg_speed_kmh: settings.avgSpeedKmh,
        });
        setMetrics(m);
      } catch {}
    })();
  }, [circuitMode, stops]);

  const openEditLocation = (idx: number) => {
    setEditLocationIdx(idx);
    setEditAddress(stops[idx].endereco);
  };

  const useCurrentLocationForStop = async () => {
    if (editLocationIdx === null) return;
    if (Platform.OS === "web") {
      Alert.alert("Indisponível", "GPS só funciona no app mobile.");
      return;
    }
    setEditLoading(true);
    try {
      const Location = await import("expo-location");
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permissão negada");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({});
      const updated = [...stops];
      updated[editLocationIdx] = {
        ...updated[editLocationIdx],
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
      };
      setStops(updated);
      await saveRoute(updated);
      setEditLocationIdx(null);
    } catch {
      Alert.alert("Erro", "Falha ao obter localização.");
    } finally {
      setEditLoading(false);
    }
  };

  const geocodeEdited = async () => {
    if (editLocationIdx === null || !editAddress.trim()) return;
    setEditLoading(true);
    try {
      const res = await fetch(`${API}/geocode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: editAddress }),
      });
      const data = await res.json();
      if (data.found) {
        const updated = [...stops];
        updated[editLocationIdx] = {
          ...updated[editLocationIdx],
          endereco: editAddress,
          lat: data.lat,
          lon: data.lon,
        };
        setStops(updated);
        await saveRoute(updated);
        setEditLocationIdx(null);
      } else {
        Alert.alert("Não encontrado", "Tente um endereço mais específico.");
      }
    } catch {
      Alert.alert("Erro", "Falha ao buscar endereço.");
    } finally {
      setEditLoading(false);
    }
  };

  const invertRoute = async () => {
    setMenuOpen(false);
    const pending = stops.filter((s) => s.status === "pendente");
    const done = stops.filter((s) => s.status !== "pendente");
    if (pending.length < 2) {
      Alert.alert("Atenção", "Precisa de pelo menos 2 paradas pendentes para inverter.");
      return;
    }
    const reversed = [...pending].reverse();
    const combined = [...done, ...reversed].map((s, i) => ({ ...s, id: i }));
    setStops(combined);
    await saveRoute(combined);
    Alert.alert("Rota invertida", "A ordem das paradas pendentes foi invertida.");
  };

  const openSummary = () => {
    setMenuOpen(false);
    router.push("/summary");
  };

  const openSettings = () => {
    setMenuOpen(false);
    router.push("/route-settings");
  };

  const exportCSV = async () => {
    setMenuOpen(false);
    if (stops.length === 0) return;
    let csv = "\uFEFFID,Codigo,Endereco,Status,Horario\n";
    stops.forEach((p) => {
      csv += `"${p.id + 1}","${p.codigo}","${p.endereco.replace(/"/g, '""')}","${p.status.toUpperCase()}","${p.timestamp || "N/A"}"\n`;
    });
    try {
      await Share.share({ message: csv, title: "Relatório Rota+Rápida" });
    } catch {
      Alert.alert("Erro", "Falha ao exportar.");
    }
  };

  const clearAll = () => {
    setMenuOpen(false);
    Alert.alert("Encerrar rota", "Deseja encerrar e salvar a rota no histórico?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Encerrar",
        style: "destructive",
        onPress: async () => {
          // Save to history first
          const delivered = stops.filter((s) => s.status === "entregue").length;
          const failed = stops.filter((s) => s.status === "falhou").length;
          if (stops.length > 0) {
            try {
              const userId = await getOrCreateUserId();
              await saveHistory({
                user_id: userId,
                route_id: `r_${Date.now()}`,
                started_at: new Date().toISOString(),
                ended_at: new Date().toISOString(),
                total_stops: stops.length,
                delivered,
                failed,
                stops: stops.map((s) => ({ codigo: s.codigo, status: s.status, timestamp: s.timestamp })),
              });
            } catch {}
          }
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
        <RouteMap
          ref={mapRef}
          initialStops={initialStops}
          onMessage={onMapMessage}
        />

        {/* Geocoding progress banner */}
        {geoProgress && (
          <View style={styles.geoBanner} testID="geocoding-banner">
            <ActivityIndicator size="small" color="#fff" />
            <Text style={styles.geoBannerText}>
              Localizando endereços no mapa…
            </Text>
          </View>
        )}

        {/* Circuit mode badge */}
        {circuitMode && (
          <View style={styles.circuitBadge}>
            <Ionicons name="lock-closed" size={11} color="#fff" />
            <Text style={styles.circuitBadgeText}>Circuit</Text>
          </View>
        )}

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

        {metrics && (
          <View style={styles.metricsBar} testID="metrics-bar">
            <View style={styles.metricsItem}>
              <Ionicons name="navigate" size={14} color={COLORS.primary} />
              <Text style={styles.metricsValue}>{metrics.total_distance_km.toFixed(1)} km</Text>
            </View>
            <View style={styles.metricsDivider} />
            <View style={styles.metricsItem}>
              <Ionicons name="time" size={14} color={COLORS.primary} />
              <Text style={styles.metricsValue}>
                {metrics.estimated_minutes >= 60
                  ? `${Math.floor(metrics.estimated_minutes / 60)}h ${Math.round(metrics.estimated_minutes % 60)}min`
                  : `${Math.round(metrics.estimated_minutes)}min`}
              </Text>
            </View>
            <View style={styles.metricsDivider} />
            <View style={styles.metricsItem}>
              <Ionicons name="cube" size={14} color={COLORS.primary} />
              <Text style={styles.metricsValue}>{pendingCount}</Text>
            </View>
          </View>
        )}

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
              onLongPress={() => openEditLocation(index)}
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
                {(item.lat == null || item.lon == null) && (
                  <Text style={styles.stopWarn}>📍 Sem localização — toque ✏️ para corrigir</Text>
                )}
                {item.status !== "pendente" && (
                  <Text style={[styles.stopStatus, { color: getStatusColor(item.status) }]}>
                    {item.status.toUpperCase()} • {item.timestamp}
                  </Text>
                )}
              </View>
              <TouchableOpacity
                onPress={() => openEditLocation(index)}
                style={styles.editIcon}
                testID={`edit-location-${index}`}
              >
                <Ionicons name="create-outline" size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
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
              icon="options"
              label="Configurar Rota (saída, ritmo)"
              onPress={openSettings}
              testID="menu-settings"
            />
            <MenuItem
              icon="flash"
              label={optimizing ? "Otimizando..." : "Otimizar Rota (TSP)"}
              onPress={optimizeTSP}
              testID="menu-optimize"
              disabled={optimizing}
            />
            <MenuItem
              icon="swap-vertical"
              label="Inverter Ordem"
              onPress={invertRoute}
              testID="menu-invert"
            />
            <MenuItem
              icon="stats-chart"
              label="Ver Resumo"
              onPress={openSummary}
              testID="menu-summary"
            />
            <MenuItem
              icon="download"
              label="Exportar CSV"
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
              icon="checkmark-done"
              label="Encerrar e Salvar Rota"
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

      {/* EDIT LOCATION MODAL */}
      <Modal
        visible={editLocationIdx !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setEditLocationIdx(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.manualCard} testID="edit-location-modal">
            <Text style={styles.manualCardTitle}>📍 Corrigir Localização</Text>
            <Text style={styles.manualCardDesc}>
              Ajuste o endereço ou use sua localização atual como ponto desta parada.
            </Text>
            <TextInput
              value={editAddress}
              onChangeText={setEditAddress}
              placeholder="Endereço completo (rua, número, cidade)"
              placeholderTextColor={COLORS.textTertiary}
              style={styles.manualInput}
              multiline
              testID="edit-address-input"
            />
            <TouchableOpacity
              style={[styles.modalBtn, styles.modalBtnPrimary, editLoading && { opacity: 0.6 }]}
              onPress={geocodeEdited}
              disabled={editLoading}
              testID="geocode-edit-button"
            >
              {editLoading ? <ActivityIndicator color="#fff" /> : (
                <Text style={styles.modalBtnText}>🔍 Buscar Endereço</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalBtn, { backgroundColor: COLORS.bgElevated, marginTop: SPACING.sm }]}
              onPress={useCurrentLocationForStop}
              disabled={editLoading}
              testID="use-gps-button"
            >
              <Text style={styles.modalBtnText}>📡 Usar Minha Localização Atual</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalBtn, styles.modalBtnCancel, { marginTop: SPACING.sm }]}
              onPress={() => setEditLocationIdx(null)}
              testID="edit-cancel-button"
            >
              <Text style={styles.modalBtnTextDark}>Cancelar</Text>
            </TouchableOpacity>
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

  metricsBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-around",
    backgroundColor: COLORS.bgSurface, borderRadius: RADIUS.md,
    paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
    marginBottom: SPACING.sm, borderWidth: 1, borderColor: COLORS.primary,
  },
  metricsItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  metricsValue: { color: COLORS.textPrimary, fontWeight: "800", fontSize: 13 },
  metricsDivider: { width: 1, height: 18, backgroundColor: COLORS.border },

  geoBanner: {
    position: "absolute", top: SPACING.md, left: 70, right: 70,
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: SPACING.sm, backgroundColor: "rgba(234,88,12,0.95)",
    paddingVertical: 8, paddingHorizontal: SPACING.md, borderRadius: RADIUS.full,
    zIndex: 10,
  },
  geoBannerText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  circuitBadge: {
    position: "absolute", bottom: SPACING.sm, left: SPACING.sm,
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(22,163,74,0.9)", paddingHorizontal: SPACING.sm,
    paddingVertical: 4, borderRadius: RADIUS.full, zIndex: 5,
  },
  circuitBadgeText: { color: "#fff", fontWeight: "800", fontSize: 11 },

  stopWarn: { color: COLORS.error, fontSize: 11, fontWeight: "700", marginTop: 4 },
  editIcon: {
    width: 32, height: 32, justifyContent: "center", alignItems: "center",
    borderRadius: RADIUS.full, backgroundColor: COLORS.bgElevated,
  },

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
