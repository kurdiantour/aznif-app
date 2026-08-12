import { LinearGradient } from "expo-linear-gradient";
import { createContext } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

type PurchaseConfirmation = {
  price: number;
  onConfirm: () => void | Promise<void>;
};

export type ShopPopupController = {
  showInsufficientGems: () => void;
  showPurchaseConfirmation: (confirmation: PurchaseConfirmation) => void;
};

export const ShopPopupContext = createContext<ShopPopupController>({
  showInsufficientGems: () => {},
  showPurchaseConfirmation: () => {},
});

type InsufficientGemsPopupProps = {
  visible: boolean;
  onClose: () => void;
};

export function InsufficientGemsPopup({
  visible,
  onClose,
}: InsufficientGemsPopupProps) {
  if (!visible) return null;

  return (
    <View style={styles.backdrop}>
      <LinearGradient
        colors={["#24134b", "#090d21"]}
        style={styles.popup}
      >
        <Text style={styles.title}>گەوهەری زیاتر پێویستە</Text>

        <View style={styles.singleButtonRow}>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.singleButton,
              styles.primaryButton,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={styles.buttonText}>تێگەیشتم</Text>
          </Pressable>
        </View>
      </LinearGradient>
    </View>
  );
}

type PurchaseConfirmationPopupProps = {
  confirmation: PurchaseConfirmation | null;
  onClose: () => void;
};

export function PurchaseConfirmationPopup({
  confirmation,
  onClose,
}: PurchaseConfirmationPopupProps) {
  if (!confirmation) return null;

  const handleConfirm = () => {
    onClose();
    void confirmation.onConfirm();
  };

  return (
    <View style={styles.backdrop}>
      <LinearGradient
        colors={["#24134b", "#090d21"]}
        style={styles.popup}
      >
        <Text style={styles.title}>دڵنیایت لەم کڕینە؟</Text>

        <Text style={styles.message}>
          {confirmation.price.toLocaleString()} گەوهەر لە هەژمارەکەت کەم
          دەبێتەوە
        </Text>

        <View style={styles.buttonRow}>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.actionButton,
              styles.secondaryButton,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={styles.buttonText}>داخستن</Text>
          </Pressable>

          <Pressable
            onPress={handleConfirm}
            style={({ pressed }) => [
              styles.actionButton,
              styles.primaryButton,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={styles.buttonText}>کڕین</Text>
          </Pressable>
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    elevation: 1000,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.72)",
  },

  popup: {
    width: 360,
    height: 180,
    maxWidth: "88%",
    paddingHorizontal: 20,
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
  },

  title: {
    color: "#ffffff",
    fontSize: 16,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },

  message: {
    marginTop: 7,
    color: "#d9d5e8",
    fontSize: 14,
    lineHeight: 20,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },

  singleButtonRow: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 18,
  },

  buttonRow: {
    width: "100%",
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
  },

  singleButton: {
    width: "48%",
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },

  actionButton: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },

  primaryButton: {
    backgroundColor: "#7c3aed",
  },

  secondaryButton: {
    backgroundColor: "#4b5563",
  },

  buttonPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },

  buttonText: {
    color: "#ffffff",
    fontFamily: "SpedaBold",
    fontSize: 13,
    textAlign: "center",
    writingDirection: "rtl",
  },
});