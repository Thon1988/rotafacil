import { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Platform,
  ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";

import { COLORS, RADIUS, SPACING, API } from "@/src/constants/theme";
import { DEFAULT_SETTINGS, loadSettings, RouteSettings, saveSettings } from "@/src/lib/route-settings";

export default function RouteSettingsScreen() {
  const router = useRouter();
  const [s, setS] = useState<RouteSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [geocoding, setGeocoding] = useState(false);

  useEffect(() => {
    loadSettings().then((x) => { setS(x); setLoading(false); });
  }, []);

  const update = <K extends keyof RouteSettings>(k: K, v: RouteSettings[K]) =>
    setS((p) => ({ ...p, [k]: v }));

  const useGPS = async () => {
    if (Platform.OS === "web") {
      Alert.alert("Indisponível", "GPS funciona no app mobile. Use endereço manual no preview.");
      return;
    }
    setGpsLoading(true);
    try {
      const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        if (!canAskAgain) {
          Alert.alert("Permissão negada", "Habilite a localização nas configurações.", [
            { text: "Cancelar", style: "cancel" },
            { text: "Abrir Configurações", onPress: () => Linking.openSettings() },
          ]);
        }
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      update("startMode", "gps");
      update("startLat", pos.coords.latitude);
      update("startLon", pos.coords.longitude);
      update("startAddress", `Localização atual (${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)})`);
    } catch {
      Alert.alert("Erro", "Não foi possível obter sua localização.");
    } finally {
      setGpsLoading(false);
    }
  };

  const geocodeManual = async () => {
    if (!s.startAddress.trim()) {
      Alert.alert("Atenção", "Digite um endereço para o ponto de saída.");
      return;
    }
    setGeocoding(true);
    try {
      const res = await fetch(`${API}/geocode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: s.startAddress }),
      });
      const data = await res.json();
      if (data.found) {
        update("startLat", data.lat);
        update("startLon", data.lon);
        Alert.alert("Endereço encontrado", data.display_name || s.startAddress);
      } else {
        Alert.alert("Não encontrado", "Tente um endereço mais específico (rua, número, cidade).");
      }
    } catch {
      Alert.alert("Erro", "Falha ao buscar endereço.");
    } finally {
      setGeocoding(false);
    }
  };

  const onSave = async () => {
    await saveSettings(s);
    router.back();
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>;
  }

  const packagesPerHour = Math.round(60 / Math.max(s.minutesPerStop, 0.5));

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]} testID="settings-screen">
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} testID="settings-back-button">
          <Ionicons name="chevron-back" size={28} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Configurar Rota</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: SPACING.md, paddingBottom: 100 }}>

          {/* Start point */}
          <Text style={styles.sectionTitle}>📍 Ponto de saída</Text>
          <Text style={styles.sectionDesc}>De onde você vai começar?</Text>

          <Option
            icon="locate"
            label="Minha localização atual (GPS)"
            desc={s.startMode === "gps" && s.startLat ? `${s.startLat.toFixed(5)}, ${s.startLon?.toFixed(5)}` : "Toque para usar GPS"}
            active={s.startMode === "gps"}
            onPress={useGPS}
            loading={gpsLoading}
            testID="opt-gps"
          />

          <Option
            icon="create"
            label="Endereço manual"
            desc={s.startMode === "manual" && s.startLat ? "Endereço definido ✓" : "Digite um endereço"}
            active={s.startMode === "manual"}
            onPress={() => update("startMode", "manual")}
            testID="opt-manual"
          />

          {s.startMode === "manual" && (
            <View style={styles.manualBox}>
              <TextInput
                style={styles.input}
                placeholder="Ex: Rua das Flores 100, São Paulo"
                placeholderTextColor={COLORS.textTertiary}
                value={s.startAddress}
                onChangeText={(v) => update("startAddress", v)}
                testID="start-address-input"
              />
              <TouchableOpacity
                style={[styles.searchBtn, geocoding && styles.disabled]}
                onPress={geocodeManual}
                disabled={geocoding}
                testID="geocode-start-button"
              >
                {geocoding ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="search" size={18} color="#fff" />
                    <Text style={styles.searchBtnText}>Buscar Endereço</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}

          <Option
            icon="map"
            label="Começar pela primeira parada"
            desc="Use a primeira encomenda como ponto inicial"
            active={s.startMode === "first_stop"}
            onPress={() => update("startMode", "first_stop")}
            testID="opt-first-stop"
          />

          {/* Return to start */}
          <View style={styles.divider} />
          <Text style={styles.sectionTitle}>🔄 Volta ao início</Text>

          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Voltar ao ponto de saída no final</Text>
              <Text style={styles.toggleDesc}>
                Inclui a viagem de retorno no cálculo de tempo e distância
              </Text>
            </View>
            <Switch
              value={s.returnToStart}
              onValueChange={(v) => update("returnToStart", v)}
              trackColor={{ false: COLORS.bgElevated, true: COLORS.primary }}
              testID="return-to-start-switch"
            />
          </View>

          {/* Pace */}
          <View style={styles.divider} />
          <Text style={styles.sectionTitle}>⏱️ Tempo por parada</Text>
          <Text style={styles.sectionDesc}>
            Quanto tempo você leva em média em cada entrega? Isso ajuda a estimar quando você termina.
          </Text>

          <View style={styles.paceCard}>
            <Text style={styles.paceValue}>{s.minutesPerStop} min</Text>
            <Text style={styles.paceLabel}>por parada</Text>
            <Text style={styles.paceCalc}>≈ {packagesPerHour} pacotes/hora</Text>
          </View>

          <View style={styles.paceBtns}>
            {[1, 2, 3, 4, 5, 7].map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.paceBtn, s.minutesPerStop === m && styles.paceBtnActive]}
                onPress={() => update("minutesPerStop", m)}
                testID={`pace-${m}`}
              >
                <Text style={[styles.paceBtnText, s.minutesPerStop === m && styles.paceBtnTextActive]}>
                  {m}m
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Avg speed */}
          <View style={styles.divider} />
          <Text style={styles.sectionTitle}>🚗 Velocidade média</Text>
          <Text style={styles.sectionDesc}>
            Velocidade média estimada para deslocamento entre paradas
          </Text>
          <View style={styles.paceBtns}>
            {[20, 30, 40, 50, 60].map((sp) => (
              <TouchableOpacity
                key={sp}
                style={[styles.paceBtn, s.avgSpeedKmh === sp && styles.paceBtnActive]}
                onPress={() => update("avgSpeedKmh", sp)}
                testID={`speed-${sp}`}
              >
                <Text style={[styles.paceBtnText, s.avgSpeedKmh === sp && styles.paceBtnTextActive]}>
                  {sp} km/h
                </Text>
              </TouchableOpacity>
            ))}
          </View>

        </ScrollView>
      </KeyboardAvoidingView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.saveBtn} onPress={onSave} testID="save-settings-button">
          <Text style={styles.saveBtnText}>Salvar e Voltar</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function Option({
  icon, label, desc, active, onPress, loading, testID,
}: {
  icon: any; label: string; desc: string; active?: boolean;
  onPress: () => void; loading?: boolean; testID?: string;
}) {
  return (
    <TouchableOpacity
      style={[styles.optionCard, active && styles.optionActive]}
      onPress={onPress}
      disabled={loading}
      testID={testID}
    >
      <View style={[styles.optionIcon, active && { backgroundColor: COLORS.primary }]}>
        {loading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Ionicons name={icon} size={20} color={active ? "#fff" : COLORS.primary} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.optionLabel, active && { color: COLORS.primary }]}>{label}</Text>
        <Text style={styles.optionDesc}>{desc}</Text>
      </View>
      {active && <Ionicons name="checkmark-circle" size={22} color={COLORS.primary} />}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgBase },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: COLORS.bgBase },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
  },
  backBtn: { width: 40, height: 40, justifyContent: "center" },
  headerTitle: { color: COLORS.textPrimary, fontSize: 20, fontWeight: "800" },

  sectionTitle: { color: COLORS.textPrimary, fontSize: 17, fontWeight: "800", marginTop: SPACING.md },
  sectionDesc: { color: COLORS.textSecondary, fontSize: 13, marginTop: 4, marginBottom: SPACING.sm },

  optionCard: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    backgroundColor: COLORS.bgSurface, borderRadius: RADIUS.lg,
    padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border,
    marginBottom: SPACING.sm,
  },
  optionActive: { borderColor: COLORS.primary, backgroundColor: "rgba(234,88,12,0.08)" },
  optionIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.bgElevated, justifyContent: "center", alignItems: "center",
  },
  optionLabel: { color: COLORS.textPrimary, fontWeight: "700", fontSize: 14 },
  optionDesc: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },

  manualBox: { gap: SPACING.sm, marginBottom: SPACING.sm },
  input: {
    backgroundColor: COLORS.bgBase, borderRadius: RADIUS.md,
    padding: SPACING.md, color: COLORS.textPrimary, fontSize: 14,
    borderWidth: 1, borderColor: COLORS.border,
  },
  searchBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACING.sm,
    backgroundColor: COLORS.primary, paddingVertical: 12, borderRadius: RADIUS.md,
  },
  searchBtnText: { color: "#fff", fontWeight: "700" },
  disabled: { opacity: 0.6 },

  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: SPACING.md },

  toggleRow: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    backgroundColor: COLORS.bgSurface, borderRadius: RADIUS.lg,
    padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border,
  },
  toggleLabel: { color: COLORS.textPrimary, fontWeight: "700", fontSize: 14 },
  toggleDesc: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },

  paceCard: {
    backgroundColor: COLORS.bgSurface, borderRadius: RADIUS.lg,
    padding: SPACING.md, alignItems: "center", borderWidth: 1,
    borderColor: COLORS.border, marginVertical: SPACING.sm,
  },
  paceValue: { color: COLORS.primary, fontSize: 36, fontWeight: "900" },
  paceLabel: { color: COLORS.textSecondary, fontSize: 12, marginTop: -4 },
  paceCalc: { color: COLORS.textPrimary, fontSize: 14, fontWeight: "700", marginTop: SPACING.sm },

  paceBtns: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm },
  paceBtn: {
    paddingVertical: 10, paddingHorizontal: SPACING.md, borderRadius: RADIUS.full,
    backgroundColor: COLORS.bgSurface, borderWidth: 1, borderColor: COLORS.border,
  },
  paceBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  paceBtnText: { color: COLORS.textSecondary, fontWeight: "700", fontSize: 13 },
  paceBtnTextActive: { color: "#fff" },

  footer: {
    padding: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.border,
    backgroundColor: COLORS.bgBase,
  },
  saveBtn: {
    backgroundColor: COLORS.primary, paddingVertical: 16,
    borderRadius: RADIUS.lg, alignItems: "center",
  },
  saveBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
