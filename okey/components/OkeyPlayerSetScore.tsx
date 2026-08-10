import { Pressable, Text, View } from "react-native";

import { styles } from "./okeyStyles";

export function OkeyPlayerSetScore({
  score,
  targetScore,
  canOpen = false,
  konkan = false,
  onOpen,
}: {
  score: number;
  targetScore: number;
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
            {konkan ? "کۆنکان" : "ڕاخستن"}
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

        {konkan ? (
          <Text style={styles.playerSetScoreValue}>
            کۆنکان
          </Text>
        ) : (
          <View style={styles.playerSetScoreValueRow}>
            <Text style={styles.playerSetScoreTarget}>
              {targetScore}
            </Text>

            <Text style={styles.playerSetScoreSlash}>
              {" / "}
            </Text>

            <Text style={styles.playerSetScoreCurrent}>
              {score}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}