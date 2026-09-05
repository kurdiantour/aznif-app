import { AVATAR_IDS, type AvatarId } from "@/constants/avatars";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { PlayerAvatar } from "./PlayerAvatar";

const PICKABLE_AVATAR_IDS = AVATAR_IDS.filter(
  (avatarId) => avatarId !== "bot-avatar",
);
const TOP_ROW_AVATAR_IDS = PICKABLE_AVATAR_IDS.slice(0, 4);
const BOTTOM_ROW_AVATAR_IDS = PICKABLE_AVATAR_IDS.slice(4);

type AvatarPickerModalProps = {
  visible: boolean;
  selectedAvatarId?: AvatarId;
  onSelect: (avatarId: AvatarId) => void;
  onClose: () => void;
};

export function AvatarPickerModal({
  visible,
  selectedAvatarId,
  onSelect,
  onClose,
}: AvatarPickerModalProps) {
  const { width } = useWindowDimensions();
  const optionSize = width < 430 ? 54 : 64;
  const avatarSize = optionSize - 12;

  if (!visible) {
    return null;
  }

  return (
    <View style={styles.overlay}>
      <Pressable style={styles.backdrop} onPress={onClose} />

      <View style={styles.card}>
        <Text style={styles.subtitle}>ڕووکارێک بۆ پرۆفایلەکەت دیاری بکە</Text>

        <View style={styles.options}>
          {[TOP_ROW_AVATAR_IDS, BOTTOM_ROW_AVATAR_IDS].map((row, rowIndex) => (
            <View key={rowIndex} style={styles.optionRow}>
              {row.map((avatarId) => {
                const active = selectedAvatarId === avatarId;

                return (
                  <Pressable
                    key={avatarId}
                    style={[
                      styles.option,
                      { width: optionSize, height: optionSize, borderRadius: optionSize / 2 },
                      active && styles.optionSelected,
                    ]}
                    onPress={() => onSelect(avatarId)}
                  >
                    <PlayerAvatar avatarId={avatarId} size={avatarSize} />
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 1001,
    elevation: 1001,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },

  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0, 0, 0, 0.62)",
  },

  card: {
    width: "100%",
    maxWidth: 460,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(139, 92, 246, 0.55)",
    backgroundColor: "#0b0718",
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 20,
    alignItems: "center",
  },

  title: {
    color: "#ffffff",
    fontSize: 20,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  subtitle: {
    marginTop: 4,
    color: "#9ca3ff",
    fontSize: 13,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  options: {
    width: "100%",
    marginTop: 22,
    gap: 14,
  },

  optionRow: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },

  option: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },

  optionSelected: {
    borderWidth: 2,
    borderColor: "#14f1c1",
    backgroundColor: "rgba(20, 241, 193, 0.14)",
  },

});
