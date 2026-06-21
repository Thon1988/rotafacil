import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform,
  RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { COLORS, RADIUS, SPACING } from "@/src/constants/theme";
import { adminApprove, adminLogin, adminPending, adminReject, adminStats } from "@/src/lib/api";
import { storage } from "@/src/utils/storage";

const TOKEN_KEY = "rota_admin_token";

interface PendingItem {
  txid: string;
  user_id: string;
  amount: number;
  customer_name?: string;
  customer_contact?: string;
  created_at?: string;
  user_submitted_at?: string;
}

export default function AdminScreen() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  // login form state
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [logginIn, setLoggingIn] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // data
  const [items, setItems] = useState<PendingItem[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    (async () => {
      const saved = await storage.getItem<string>(TOKEN_KEY, "");
      if (saved) setToken(saved);
      setChecking(false);
    })();
  }, []);

  const loadData = useCallback(async (t: string) => {
    setLoading(true);
    try {
      const [pending, s] = await Promise.all([
        adminPending(t),
        adminStats(t),
      ]);
      setItems(pending.items || []);
      setStats(s);
    } catch (e: any) {
      // Invalid token → log out
      if (String(e?.message || "").includes("401")) {
        await storage.removeItem(TOKEN_KEY);
        setToken(null);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (token) loadData(token);
  }, [token, loadData]);

  const onLogin = async () => {
    setLoggingIn(true);
    setErrorMsg("");
    try {
      const { access_token } = await adminLogin(username, password);
      await storage.setItem(TOKEN_KEY, access_token);
      setToken(access_token);
    } catch (e: any) {
      if (e?.message === "rate_limited") {
        setErrorMsg("Muitas tentativas. Aguarde alguns minutos.");
      } else {
        setErrorMsg("Credenciais inválidas");
      }
    } finally {
      setLoggingIn(false);
    }
  };

  const onLogout = async () => {
    await storage.removeItem(TOKEN_KEY);
    setToken(null);
    setItems([]);
    setStats(null);
  };

  const onApprove = async (txid: string) => {
    if (!token) return;
    try {
      await adminApprove(token, txid);
      setItems((prev) => prev.filter((i) => i.txid !== txid));
      Alert.alert("Aprovado", "Assinatura de 30 dias ativada!");
      loadData(token);
    } catch {
      Alert.alert("Erro", "Falha ao aprovar.");
    }
  };

  const onReject = async (txid: string) => {
    if (!token) return;
    try {
      await adminReject(token, txid);
      setItems((prev) => prev.filter((i) => i.txid !== txid));
    } catch {
      Alert.alert("Erro", "Falha ao rejeitar.");
    }
  };

  if (checking) {
    return <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>;
  }

  // ============ LOGIN ============
  if (!token) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "bottom"]} testID="admin-login-screen">
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View style={styles.loginWrap}>
            <TouchableOpacity style={styles.backBtnAbs} onPress={() => router.replace("/")}>
              <Ionicons name="chevron-back" size={28} color={COLORS.textPrimary} />
            </TouchableOpacity>

            <View style={styles.loginIcon}>
              <Ionicons name="shield-checkmark" size={48} color={COLORS.primary} />
            </View>
            <Text style={styles.loginTitle}>Painel Admin</Text>
            <Text style={styles.loginDesc}>Acesso restrito</Text>

            <TextInput
              style={styles.input}
              placeholder="Usuário"
              placeholderTextColor={COLORS.textTertiary}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              testID="admin-username-input"
            />
            <TextInput
              style={styles.input}
              placeholder="Senha"
              placeholderTextColor={COLORS.textTertiary}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              testID="admin-password-input"
            />

            {errorMsg ? (
              <Text style={styles.errorText} testID="admin-error">{errorMsg}</Text>
            ) : null}

            <TouchableOpacity
              style={[styles.loginBtn, logginIn && styles.disabled]}
              onPress={onLogin}
              disabled={logginIn}
              testID="admin-login-button"
            >
              {logginIn ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.loginBtnText}>Entrar</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ============ DASHBOARD ============
  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]} testID="admin-dashboard-screen">
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Painel Admin</Text>
        <TouchableOpacity style={styles.logoutBtn} onPress={onLogout} testID="admin-logout-button">
          <Ionicons name="log-out-outline" size={20} color={COLORS.error} />
          <Text style={styles.logoutText}>Sair</Text>
        </TouchableOpacity>
      </View>

      {stats && (
        <View style={styles.statsRow}>
          <StatCard label="Ativas" value={stats.active_subs} color={COLORS.success} />
          <StatCard label="Pendentes" value={stats.pending} color={COLORS.primary} />
          <StatCard label="R$ mês" value={`R$ ${Number(stats.revenue_month).toFixed(0)}`} color={COLORS.textPrimary} />
        </View>
      )}

      <View style={styles.listHeader}>
        <Text style={styles.listTitle}>Pagamentos pendentes</Text>
        <Text style={styles.listCount}>{items.length}</Text>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      ) : items.length === 0 ? (
        <View style={styles.empty} testID="admin-empty">
          <Ionicons name="checkmark-done-circle" size={64} color={COLORS.success} />
          <Text style={styles.emptyTitle}>Sem pendências</Text>
          <Text style={styles.emptyDesc}>Todas as solicitações foram processadas.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.txid}
          contentContainerStyle={{ padding: SPACING.md, gap: SPACING.sm }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); loadData(token); }}
              tintColor={COLORS.primary}
            />
          }
          renderItem={({ item }) => (
            <View style={styles.itemCard} testID={`pending-${item.txid}`}>
              <View style={styles.itemTop}>
                <Text style={styles.itemName}>{item.customer_name || "Sem nome"}</Text>
                <Text style={styles.itemAmount}>R$ {item.amount.toFixed(2)}</Text>
              </View>
              {item.customer_contact && (
                <Text style={styles.itemContact}>📱 {item.customer_contact}</Text>
              )}
              <Text style={styles.itemLogin}>🔑 Login: {item.user_id}</Text>
              <Text style={styles.itemTxid}>🧾 {item.txid}</Text>
              <Text style={styles.itemDate}>
                Enviado: {item.user_submitted_at ? new Date(item.user_submitted_at).toLocaleString("pt-BR") : "agora"}
              </Text>

              <View style={styles.itemActions}>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.rejectBtn]}
                  onPress={() => onReject(item.txid)}
                  testID={`reject-${item.txid}`}
                >
                  <Ionicons name="close" size={18} color="#fff" />
                  <Text style={styles.actionBtnText}>Rejeitar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.approveBtn]}
                  onPress={() => onApprove(item.txid)}
                  testID={`approve-${item.txid}`}
                >
                  <Ionicons name="checkmark" size={18} color="#fff" />
                  <Text style={styles.actionBtnText}>Aprovar</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function StatCard({ label, value, color }: { label: string; value: any; color: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgBase },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: COLORS.bgBase },

  loginWrap: { flex: 1, padding: SPACING.lg, justifyContent: "center", gap: SPACING.md },
  backBtnAbs: { position: "absolute", top: SPACING.md, left: SPACING.md, width: 40, height: 40, justifyContent: "center" },
  loginIcon: {
    width: 100, height: 100, borderRadius: 50, backgroundColor: COLORS.bgSurface,
    justifyContent: "center", alignItems: "center", alignSelf: "center",
    borderWidth: 1, borderColor: COLORS.border,
  },
  loginTitle: { color: COLORS.textPrimary, fontSize: 24, fontWeight: "800", textAlign: "center" },
  loginDesc: { color: COLORS.textSecondary, textAlign: "center", marginBottom: SPACING.md },
  input: {
    backgroundColor: COLORS.bgSurface, borderRadius: RADIUS.md,
    padding: SPACING.md, color: COLORS.textPrimary, fontSize: 16,
    borderWidth: 1, borderColor: COLORS.border,
  },
  errorText: { color: COLORS.error, textAlign: "center", fontSize: 13 },
  loginBtn: {
    backgroundColor: COLORS.primary, paddingVertical: 16,
    borderRadius: RADIUS.md, alignItems: "center", marginTop: SPACING.sm,
  },
  loginBtnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  disabled: { opacity: 0.6 },

  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  headerTitle: { color: COLORS.textPrimary, fontSize: 20, fontWeight: "800" },
  logoutBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  logoutText: { color: COLORS.error, fontWeight: "700", fontSize: 13 },

  statsRow: {
    flexDirection: "row", gap: SPACING.sm, padding: SPACING.md,
  },
  statCard: {
    flex: 1, backgroundColor: COLORS.bgSurface, borderRadius: RADIUS.md,
    padding: SPACING.md, alignItems: "center", borderWidth: 1, borderColor: COLORS.border,
  },
  statValue: { fontSize: 22, fontWeight: "900" },
  statLabel: { color: COLORS.textSecondary, fontSize: 11, marginTop: 4 },

  listHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: SPACING.md, paddingTop: SPACING.sm,
  },
  listTitle: { color: COLORS.textPrimary, fontWeight: "800", fontSize: 16 },
  listCount: {
    color: "#fff", backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.sm, paddingVertical: 2, borderRadius: RADIUS.full,
    fontSize: 13, fontWeight: "700",
  },

  empty: { flex: 1, justifyContent: "center", alignItems: "center", padding: SPACING.xl, gap: SPACING.md },
  emptyTitle: { color: COLORS.textPrimary, fontSize: 18, fontWeight: "800" },
  emptyDesc: { color: COLORS.textSecondary, textAlign: "center" },

  itemCard: {
    backgroundColor: COLORS.bgSurface, borderRadius: RADIUS.lg,
    padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border,
  },
  itemTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  itemName: { color: COLORS.textPrimary, fontWeight: "800", fontSize: 16 },
  itemAmount: { color: COLORS.success, fontWeight: "800", fontSize: 16 },
  itemContact: { color: COLORS.textSecondary, fontSize: 13, marginTop: 4 },
  itemLogin: { color: COLORS.primary, fontSize: 12, fontWeight: "700", marginTop: 4, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  itemTxid: { color: COLORS.textTertiary, fontSize: 11, marginTop: 2, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  itemDate: { color: COLORS.textTertiary, fontSize: 11, marginTop: 2 },
  itemActions: { flexDirection: "row", gap: SPACING.sm, marginTop: SPACING.md },
  actionBtn: {
    flex: 1, flexDirection: "row", justifyContent: "center", alignItems: "center",
    gap: 4, paddingVertical: 12, borderRadius: RADIUS.md,
  },
  approveBtn: { backgroundColor: COLORS.success },
  rejectBtn: { backgroundColor: COLORS.error },
  actionBtnText: { color: "#fff", fontWeight: "800", fontSize: 14 },
});
