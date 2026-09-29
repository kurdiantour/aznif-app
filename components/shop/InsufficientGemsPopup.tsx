import { LinearGradient } from "expo-linear-gradient";
import { createContext } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useWallet } from "@/lib/wallet-context";

type PurchaseConfirmation = {
  price: number;
  onConfirm: () => void | Promise<void>;
};

export type ShopPopupController = {
  showPurchaseConfirmation: (
    confirmation: PurchaseConfirmation,
  ) => void;
};

export const ShopPopupContext =
  createContext<ShopPopupController>({
    showPurchaseConfirmation: () => {},
  });

type PurchaseConfirmationPopupProps = {
  confirmation: PurchaseConfirmation | null;
  onClose: () => void;
};

export function PurchaseConfirmationPopup({
  confirmation,
  onClose,
}: PurchaseConfirmationPopupProps) {
  const { gemBalance } = useWallet();

  if (!confirmation) return null;

  const balanceIsKnown = gemBalance !== null;

  const hasEnoughGems =
    balanceIsKnown &&
    gemBalance >= confirmation.price;

  const hasInsufficientGems =
    balanceIsKnown &&
    gemBalance < confirmation.price;

  const handleConfirm = () => {
    if (!hasEnoughGems) return;

    onClose();
    void confirmation.onConfirm();
  };

  return (
    <View style={confirmationStyles.overlay}>
      <LinearGradient
        colors={[
          "rgba(2, 6, 23, 0.92)",
          "rgba(9, 18, 40, 0.86)",
        ]}
        style={StyleSheet.absoluteFill}
      />

      <View style={confirmationStyles.fixedContent}>
        <View style={confirmationStyles.card}>
          <View style={confirmationStyles.headerPanel}>
            <Text style={confirmationStyles.title}>
              {hasInsufficientGems
                ? "گەوهەری پێویستت نییە"
                : "دڵنیایت لەم کڕینە؟"}
            </Text>

            <Text style={confirmationStyles.subtitle}>
              {hasInsufficientGems
                ? `بۆ بەدەستهێنانی ئەم سێتە ${confirmation.price.toLocaleString()} گەوهەر پێویستە`
                : `${confirmation.price.toLocaleString()} گەوهەر لە هەژمارەکەت کەم دەبێتەوە`}
            </Text>
          </View>

          <View style={confirmationStyles.form}>
            <Pressable
              disabled={!hasEnoughGems}
              onPress={handleConfirm}
              style={({ pressed }) => [
                confirmationStyles.primaryButton,
                !hasEnoughGems &&
                  confirmationStyles.primaryButtonDisabled,
                pressed &&
                  hasEnoughGems &&
                  confirmationStyles.buttonPressed,
              ]}
            >
              <Text
                style={[
                  confirmationStyles.primaryText,
                  !hasEnoughGems &&
                    confirmationStyles.primaryTextDisabled,
                ]}
              >
                بەدەستی بهێنە
              </Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                confirmationStyles.secondaryButton,
                pressed &&
                  confirmationStyles.buttonPressed,
              ]}
              onPress={onClose}
            >
              <Text style={confirmationStyles.secondaryText}>
                {hasInsufficientGems
                  ? "تێگەیشتم"
                  : "پاشگەزبوونەوە"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const confirmationStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 5000,
    elevation: 5000,
  },

  fixedContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 16,
  },

  card: {
    width: "100%",
    maxWidth: 390,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    backgroundColor: "rgba(4, 10, 25, 0.86)",
    padding: 12,
  },

  headerPanel: {
    minHeight: 92,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(248, 215, 116, 0.22)",
    backgroundColor: "rgba(15, 23, 42, 0.66)",
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },

  title: {
    width: "100%",
    color: "#ffffff",
    fontSize: 19,
    lineHeight: 28,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },

  subtitle: {
    width: "100%",
    color: "#b6c2d8",
    fontSize: 14,
    lineHeight: 22,
    fontFamily: "SpedaRegular",
    textAlign: "center",
    writingDirection: "rtl",
    marginTop: 6,
  },

  form: {
    gap: 9,
  },

  primaryButton: {
    minHeight: 48,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    backgroundColor: "#2563eb",
    marginTop: 4,
  },

  primaryButtonDisabled: {
    backgroundColor: "rgba(37, 99, 235, 0.32)",
    opacity: 0.55,
  },

  primaryText: {
    color: "#ffffff",
    fontFamily: "SpedaBold",
    fontSize: 15,
    textAlign: "center",
    writingDirection: "rtl",
  },

  primaryTextDisabled: {
    color: "rgba(255, 255, 255, 0.62)",
  },

  secondaryButton: {
    minHeight: 46,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(248, 215, 116, 0.34)",
    backgroundColor: "rgba(248, 215, 116, 0.1)",
  },

  secondaryText: {
    color: "#ffffff",
    fontFamily: "SpedaBold",
    fontSize: 13,
    textAlign: "center",
    writingDirection: "rtl",
  },

  buttonPressed: {
    opacity: 0.8,
  },
});