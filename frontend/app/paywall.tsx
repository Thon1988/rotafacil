import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
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
import QRCode from "react-native-qrcode-svg";
import * as Clipboard from "expo-clipboard";

import { COLORS, RADIUS, SPACING } from "@/src/constants/theme";
import { generatePix, PixData, submitPayment } from "@/src/lib/api";
import { getOrCreateUserId } from "@/src/lib/user";

export default function Paywall() {
  const router = useRouter();
  const [pixData, setPixData] = useState<PixData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [userId, setUserId] = useState<string>("");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");

  const fetchPix = useCallback(async () => {
    try {
      setLoading(true);
      const uid = await getOrCreateUserId();
      setUserId(uid);
      const data = await generatePix(uid);
      setPixData(data);
    } catch {
      Alert.alert("Erro", "Não foi possível gerar o PIX. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPix();
  }, [fetchPix]);

  const copyPix = async () => {
    if (!pixData) return;
    await Clipboard.setStringAsync(pixData.pix_string);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleSubmitPayment = async () => {
    if (!pixData || !userId) return;
    if (!name.trim()) {
      Alert.alert("Atenção", "Informe seu nome para identificarmos seu pagamento.");
      return;
    }
    setConfirming(true);
    try {
      await submitPayment(userId, pixData.txid, name.trim(), contact.trim() || undefined);
      setSubmitted(true);
      // Auto-open WhatsApp to send receipt
      const url = `https://wa.me/${pixData.whatsapp_number}?text=${pixData.whatsapp_message.replace(/%0A/g, "%0A")}%0A%0ANome:%20${encodeURIComponent(name)}`;
      Linking.openURL(url);
    } catch {
      Alert.alert("Erro", "Falha ao enviar. Tente novamente.");
    } finally {
      setConfirming(false);
    }
  };

  const openWhatsApp = () => {
    if (!pixData) return;
    const url = `https://wa.me/${pixData.whatsapp_number}?text=${pixData.whatsapp_message}%0A%0ANome:%20${encodeURIComponent(name)}`;
    Linking.openURL(url);
  };

  if (submitted) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "bottom"]} testID="paywall-pending-screen">
        <View style={styles.pendingWrap}>
          <View style={styles.pendingIcon}>
            <Ionicons name="time" size={64} color={COLORS.primary} />
          </View>
          <Text style={styles.pendingTitle}>Aguardando Aprovação</Text>
          <Text style={styles.pendingDesc}>
            Recebemos sua solicitação! Envie o comprovante do PIX pelo WhatsApp
            e em breve liberaremos seu acesso (geralmente em poucos minutos).
          </Text>

          <TouchableOpacity
            style={[styles.confirmButton, { backgroundColor: "#25D366" }]}
            onPress={openWhatsApp}
            testID="open-whatsapp-button"
          >
            <Ionicons name="logo-whatsapp" size={22} color="#fff" />
            <Text style={styles.confirmButtonText}>Enviar Comprovante</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.linkBtn}
            onPress={() => router.replace("/")}
            testID="paywall-go-home"
          >
            <Text style={styles.linkBtnText}>Voltar ao início</Text>
          </TouchableOpacity>

          <View style={styles.infoCard}>
            <Ionicons name="information-circle" size={16} color={COLORS.textSecondary} />
            <Text style={styles.infoText}>
              Sua assinatura é ativada automaticamente assim que o admin
              aprovar seu pagamento. O app verifica a cada poucos segundos.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]} testID="paywall-screen">
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            testID="paywall-back-button"
          >
            <Ionicons name="chevron-back" size={28} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Assinar</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.priceCard}>
          <Text style={styles.priceLabel}>Plano Mensal</Text>
          <View style={styles.priceRow}>
            <Text style={styles.priceCurrency}>R$</Text>
            <Text style={styles.priceValue}>20</Text>
            <Text style={styles.priceUnit}>/mês</Text>
          </View>
          <View style={styles.highlightBadge}>
            <Ionicons name="flame" size={14} color="#fff" />
            <Text style={styles.highlightText}>Menos de R$ 1 por dia</Text>
          </View>
        </View>

        <View style={styles.benefitsCard}>
          <Benefit text="Rotas ilimitadas otimizadas" />
          <Benefit text="Scanner Shopee & Mercado Livre" />
          <Benefit text="Geocodificação automática de endereços" />
          <Benefit text="Histórico e estatísticas semanais" />
          <Benefit text="Mapa interativo com rota visual" />
        </View>

        {loading ? (
          <View style={styles.qrLoading}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.qrLoadingText}>Gerando PIX...</Text>
          </View>
        ) : pixData ? (
          <View style={styles.qrCard} testID="pix-qr-card">
            <Text style={styles.qrTitle}>Pague R$ 20,00 com PIX</Text>
            <Text style={styles.qrSubtitle}>1. Escaneie o QR Code abaixo</Text>

            <View style={styles.qrBox}>
              <QRCode
                value={pixData.pix_string}
                size={200}
                backgroundColor="#fff"
                color="#000"
              />
            </View>

            <View style={styles.pixInfoBox}>
              <Text style={styles.pixInfoLabel}>Chave PIX (CNPJ)</Text>
              <Text style={styles.pixInfoValue} testID="pix-key-value">{pixData.pix_key}</Text>
            </View>

            <TouchableOpacity
              style={styles.copyButton}
              onPress={copyPix}
              testID="copy-pix-button"
            >
              <Ionicons
                name={copied ? "checkmark-circle" : "copy"}
                size={20}
                color="#fff"
              />
              <Text style={styles.copyButtonText}>
                {copied ? "Código Copiado!" : "Copiar Pix Copia e Cola"}
              </Text>
            </TouchableOpacity>

            <Text style={styles.stepText}>2. Após pagar, informe seu nome:</Text>

            <TextInput
              style={styles.input}
              placeholder="Seu nome completo"
              placeholderTextColor={COLORS.textTertiary}
              value={name}
              onChangeText={setName}
              testID="customer-name-input"
            />
            <TextInput
              style={styles.input}
              placeholder="WhatsApp (opcional)"
              placeholderTextColor={COLORS.textTertiary}
              keyboardType={Platform.OS === "ios" ? "number-pad" : "phone-pad"}
              value={contact}
              onChangeText={setContact}
              testID="customer-contact-input"
            />

            <TouchableOpacity
              style={[styles.confirmButton, confirming && styles.disabled]}
              onPress={handleSubmitPayment}
              disabled={confirming}
              testID="submit-payment-button"
            >
              {confirming ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="logo-whatsapp" size={20} color="#fff" />
                  <Text style={styles.confirmButtonText}>Já paguei — Enviar Comprovante</Text>
                </>
              )}
            </TouchableOpacity>

            <Text style={styles.disclaimer}>
              Após o pagamento, abriremos o WhatsApp para você enviar o
              comprovante. Liberação manual em até alguns minutos.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Benefit({ text }: { text: string }) {
  return (
    <View style={styles.benefitRow}>
      <Ionicons name="checkmark-circle" size={20} color={COLORS.success} />
      <Text style={styles.benefitText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgBase },
  scroll: { padding: SPACING.lg, paddingBottom: SPACING.xl * 2 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: SPACING.lg,
  },
  backBtn: { width: 40, height: 40, justifyContent: "center" },
  headerTitle: { color: COLORS.textPrimary, fontSize: 20, fontWeight: "800" },
  priceCard: {
    backgroundColor: COLORS.bgSurface,
    borderRadius: RADIUS.xl,
    padding: SPACING.lg,
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.md,
  },
  priceLabel: {
    color: COLORS.textSecondary, fontSize: 14, fontWeight: "600",
    textTransform: "uppercase", letterSpacing: 1,
  },
  priceRow: { flexDirection: "row", alignItems: "baseline", marginVertical: SPACING.sm },
  priceCurrency: { color: COLORS.textPrimary, fontSize: 28, fontWeight: "700" },
  priceValue: { color: COLORS.primary, fontSize: 72, fontWeight: "900", letterSpacing: -2 },
  priceUnit: { color: COLORS.textSecondary, fontSize: 20, marginLeft: SPACING.xs },
  highlightBadge: {
    flexDirection: "row", alignItems: "center", gap: SPACING.xs,
    backgroundColor: COLORS.primary, paddingHorizontal: SPACING.md,
    paddingVertical: 6, borderRadius: RADIUS.full,
  },
  highlightText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  benefitsCard: {
    backgroundColor: COLORS.bgSurface, borderRadius: RADIUS.lg,
    padding: SPACING.md, gap: SPACING.sm,
    borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.lg,
  },
  benefitRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  benefitText: { color: COLORS.textPrimary, fontSize: 14, flex: 1 },

  qrLoading: { alignItems: "center", padding: SPACING.xl, gap: SPACING.md },
  qrLoadingText: { color: COLORS.textSecondary },

  qrCard: {
    backgroundColor: COLORS.bgSurface, borderRadius: RADIUS.xl,
    padding: SPACING.lg, borderWidth: 1, borderColor: COLORS.border, alignItems: "center",
  },
  qrTitle: { color: COLORS.textPrimary, fontSize: 18, fontWeight: "800" },
  qrSubtitle: { color: COLORS.textSecondary, fontSize: 13, marginTop: 4, marginBottom: SPACING.md },
  qrBox: { backgroundColor: "#fff", padding: SPACING.md, borderRadius: RADIUS.md, marginBottom: SPACING.md },
  pixInfoBox: {
    width: "100%", backgroundColor: COLORS.bgBase, borderRadius: RADIUS.md,
    padding: SPACING.md, marginBottom: SPACING.md, alignItems: "center",
  },
  pixInfoLabel: { color: COLORS.textTertiary, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 },
  pixInfoValue: { color: COLORS.textPrimary, fontSize: 16, fontWeight: "700", marginTop: 4 },
  copyButton: {
    flexDirection: "row", alignItems: "center", gap: SPACING.sm,
    backgroundColor: COLORS.bgElevated, paddingVertical: 14,
    paddingHorizontal: SPACING.lg, borderRadius: RADIUS.md,
    width: "100%", justifyContent: "center", marginBottom: SPACING.md,
  },
  copyButtonText: { color: "#fff", fontWeight: "700", fontSize: 14 },

  stepText: {
    color: COLORS.textSecondary, fontSize: 13, alignSelf: "flex-start",
    marginBottom: SPACING.sm,
  },
  input: {
    width: "100%", backgroundColor: COLORS.bgBase, borderRadius: RADIUS.md,
    padding: SPACING.md, color: COLORS.textPrimary, fontSize: 14,
    borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.sm,
  },

  confirmButton: {
    flexDirection: "row", alignItems: "center", gap: SPACING.sm,
    backgroundColor: "#25D366", paddingVertical: 16,
    paddingHorizontal: SPACING.lg, borderRadius: RADIUS.md,
    width: "100%", justifyContent: "center", marginTop: SPACING.sm,
  },
  confirmButtonText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  disabled: { opacity: 0.6 },
  disclaimer: {
    color: COLORS.textTertiary, fontSize: 11, textAlign: "center",
    marginTop: SPACING.md, lineHeight: 16,
  },

  pendingWrap: { flex: 1, padding: SPACING.lg, justifyContent: "center", alignItems: "center", gap: SPACING.md },
  pendingIcon: {
    width: 120, height: 120, borderRadius: 60,
    backgroundColor: COLORS.bgSurface, justifyContent: "center",
    alignItems: "center", borderWidth: 2, borderColor: COLORS.primary,
  },
  pendingTitle: { color: COLORS.textPrimary, fontSize: 24, fontWeight: "800" },
  pendingDesc: { color: COLORS.textSecondary, textAlign: "center", lineHeight: 22, fontSize: 14 },
  linkBtn: { paddingVertical: SPACING.md },
  linkBtnText: { color: COLORS.primary, fontWeight: "700", fontSize: 14 },
  infoCard: {
    flexDirection: "row", gap: SPACING.sm, backgroundColor: COLORS.bgSurface,
    padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1,
    borderColor: COLORS.border, marginTop: SPACING.md,
  },
  infoText: { color: COLORS.textSecondary, fontSize: 12, flex: 1, lineHeight: 17 },
});
