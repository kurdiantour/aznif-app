import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { createContext, type ReactNode } from "react";
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
      <PopupCard>
        <View style={styles.gemIcon}>
          <Ionicons name="diamond" size={20} color="#d8a7ff" />
        </View>

        <Text style={styles.title}>گەوهەری زیاتر پێویستە</Text>

        <Pressable
          style={[styles.singleButton, styles.primaryButton]}
          onPress={onClose}
        >
          <Text style={styles.primaryButtonText}>تێگەیشتم</Text>
        </Pressable>
      </PopupCard>
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
      <PopupCard>
        <Text style={styles.title}>دڵنیایت لەم کڕینە؟</Text>

        <View style={styles.priceRow}>
          <Text style={styles.priceText}>
            {confirmation.price.toLocaleString()} گەوهەر لە هەژمارەکەت کەم دەبێتەوە
          </Text>
        </View>

        <View style={styles.buttonRow}>
          <Pressable
            style={[styles.actionButton, styles.secondaryButton]}
            onPress={onClose}
          >
            <Text style={styles.secondaryButtonText}>داخستن</Text>
          </Pressable>

          <Pressable
            style={[styles.actionButton, styles.primaryButton]}
            onPress={handleConfirm}
          >
            <Text style={styles.primaryButtonText}>کڕین</Text>
          </Pressable>
        </View>
      </PopupCard>
    </View>
  );
}

function PopupCard({ children }: { children: ReactNode }) {
  return (
    <LinearGradient colors={["#22114a", "#0b1027"]} style={styles.popup}>
      {children}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    elevation: 1000,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(2, 4, 15, 0.78)",
    paddingHorizontal: 24,
  },
  popup: {
    width: "100%",
    maxWidth: 310,
    borderRadius: 10,
    padding: 24,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 16,
  },
  gemIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(168, 85, 247, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(216, 180, 254, 0.42)",
  },
  title: {
    marginTop: 16,
    color: "#fff",
    fontSize: 12,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 14,
  },
  priceText: {
    color: "#ffffff",
    fontSize: 12,
    fontFamily: "SpedaBold",
  },
  singleButton: {
    width: "100%",
    height: 34,
    marginTop: 18,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonRow: {
    width: "100%",
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
  },
  actionButton: {
    flex: 1,
    height: 34,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButton: {
    backgroundColor: "#7c3aed",
    borderWidth: 1,
    borderColor: "rgba(221, 214, 254, 0.6)",
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 12,
    fontFamily: "SpedaBold",
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: "rgba(221, 214, 254, 0.38)",
  },
  secondaryButtonText: {
    color: "#e9ddff",
    fontSize: 12,
    fontFamily: "SpedaBold",
  },
});