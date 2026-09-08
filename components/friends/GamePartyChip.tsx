import { PlayerAvatar } from "@/components/player/PlayerAvatar";
import type { DominoParty } from "@/lib/dominoParty";
import { Ionicons } from "@expo/vector-icons";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

type Props = {
  party: DominoParty;
  currentUserId: string;
  cancelling: boolean;
  error: string | null;
  onCancel: () => void;
};

export function GamePartyChip({
  party,
  currentUserId,
  cancelling,
  error,
  onCancel,
}: Props) {
  const teammate = party.members.find(
    (member) => member.userId !== currentUserId
  );

  if (!teammate) return null;

  const displayName =
    teammate.name.length > 10
      ? `${teammate.name.slice(0, 10)}...`
      : teammate.name;

  return (
    <View pointerEvents="box-none" style={styles.host}>
      <View style={styles.chip}>
        <PlayerAvatar avatarId={teammate.avatarId} size={34} />

        <View style={styles.copy}>
          <Text numberOfLines={1} style={styles.name}>
            {displayName}
          </Text>

          <Text style={styles.label}>هاوتیمی</Text>

          {error ? (
            <Text numberOfLines={1} style={styles.error}>
              {error}
            </Text>
          ) : null}
        </View>

        <Pressable
          accessibilityLabel="پاشگەزبوونەوە لە پارتی"
          disabled={cancelling}
          hitSlop={8}
          onPress={onCancel}
          style={({ pressed }) => [
            styles.cancel,
            pressed && styles.pressed,
          ]}
        >
          {cancelling ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Ionicons color="#fff" name="close" size={20} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    alignItems: "center",
    justifyContent: "center",
  },

  chip: {
    maxWidth: 270,
    minWidth: 190,
    minHeight: 50,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(218,174,106,0.55)",
    backgroundColor: "rgba(48,29,20,0.96)",
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },

  copy: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
  },

  name: {
    color: "#fff4df",
    fontFamily: "SpedaBold",
    fontSize: 13,
    textAlign: "center",
  },

  label: {
    color: "#fcfaf7",
    fontFamily: "SpedaBold",
    fontSize: 10,
    textAlign: "center",
  },

  error: {
    color: "#ff9b94",
    fontFamily: "Speda",
    fontSize: 9,
    textAlign: "center",
  },

  cancel: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#9b3d36",
  },

  pressed: {
    opacity: 0.72,
  },
});