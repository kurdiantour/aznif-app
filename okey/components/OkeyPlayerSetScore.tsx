import { Pressable, Text, View } from "react-native";

import { styles } from "./okeyStyles";

export function OkeyPlayerSetScore({
  score,
  canOpen = false,
  konkan = false,
  onOpen,
}: {
  score: number;
  canOpen?: boolean;
  konkan?: boolean;
  onOpen?: () => void;
}) {
  return (
    <View style={styles.playerSetScoreWrap} pointerEvents="box-none">
      {canOpen ? (
        <Pressable
          style={styles.openSetsButton}
          onPress={onOpen}
        >
          <Text style={styles.openSetsButtonText}>
            {konkan ? "کۆنکان" : "کردنەوە"}
          </Text>
        </Pressable>
      ) : null}

      <View
        style={styles.playerSetScore}
        pointerEvents="none"
      >
        <Text style={styles.playerSetScoreLabel}>
          {konkan ? "دۆخ" : "نمرەی دەستە"}
        </Text>

        <Text style={styles.playerSetScoreValue}>
          {konkan ? "کۆنکان" : score}
        </Text>
      </View>
    </View>
  );
}