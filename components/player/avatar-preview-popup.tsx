import { createContext } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { PlayerAvatar } from "@/components/player/PlayerAvatar";
import type { AvatarId } from "@/types/avatar";

export type AvatarPreviewData = { id?: AvatarId | null; url?: string | null };

export type AvatarPreviewController = {
  showPreview: (avatar: AvatarPreviewData) => void;
};

export const AvatarPreviewContext = createContext<AvatarPreviewController>({
  showPreview: () => {},
});

type AvatarPreviewPopupProps = {
  avatar: AvatarPreviewData | null;
  onClose: () => void;
};

export function AvatarPreviewPopup({ avatar, onClose }: AvatarPreviewPopupProps) {
  if (!avatar) return null;

  return (
    <View style={styles.backdrop}>
      <Pressable style={styles.absoluteFill} onPress={onClose} />
      <Pressable style={styles.closeButton} onPress={onClose}>
        <Ionicons name="close" size={32} color="#ffffff" />
      </Pressable>
      <Pressable onPress={(e) => e.stopPropagation()}>
        <PlayerAvatar
          avatarId={avatar.id ?? undefined}
          avatarUrl={avatar.url ?? undefined}
          size={280}
          style={styles.image}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    zIndex: 9999,
    elevation: 9999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.85)",
  },
  absoluteFill: {
    ...StyleSheet.absoluteFill,
  },
  closeButton: {
    position: "absolute",
    top: 40,
    right: 20,
    padding: 8,
    zIndex: 10,
  },
  image: {
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.2)",
  },
});
