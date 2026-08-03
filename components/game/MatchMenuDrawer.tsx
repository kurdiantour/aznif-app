import { PlayerAvatar } from "@/components/player/PlayerAvatar";
import { getRankTitleFromLevel, getRankTitleFromPoints } from "@/lib/progression";
import { BlurView } from "expo-blur";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";

type MatchMenuDrawerProps = {
  visible: boolean;
  players: any[];
  humanPlayer?: any | null;
  translateX: Animated.Value;
  onClose: () => void;
  onLeavePress: () => void;
};

function getPlayerRankLabel(player: any) {
  if (player.kind === "bot") return "\u0628\u06c6\u062a";
  if (typeof player.points === "number") return getRankTitleFromPoints(player.points);
  return getRankTitleFromLevel(player.level);
}

export default function MatchMenuDrawer({
  visible,
  players,
  humanPlayer,
  translateX,
  onClose,
  onLeavePress,
}: MatchMenuDrawerProps) {
  if (!visible) return null;

  return (
    <View style={styles.matchMenuOverlay}>
      <Pressable
        accessibilityLabel="\u062f\u0627\u062e\u0633\u062a\u0646\u06cc \u0695\u06ce\u06a9\u062e\u0633\u062a\u0646\u06d5\u06a9\u0627\u0646\u06cc \u06cc\u0627\u0631\u06cc"
        style={styles.matchMenuBackdrop}
        onPress={onClose}
      />

      <Animated.View
        style={[
          styles.matchMenuPanel,
          { transform: [{ translateX }] },
        ]}
      >
        <BlurView
          intensity={88}
          tint="dark"
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
        />

        <View style={styles.matchMenuContent}>
          <View style={styles.matchMenuPlayersSection}>
            {(["teamA", "teamB"] as const).map((teamId) => {
              const isMyTeam = humanPlayer?.teamId === teamId;
              const teamPlayers = players.filter(
                (player) => player.teamId === teamId,
              );

              return (
                <View key={teamId} style={styles.teamGroup}>
                  <Text style={styles.teamGroupTitle}>
                    {teamId === "teamA" ? "تیمی یەکەم" : "تیمی دووەم"}
                    {isMyTeam ? " · تیمی تۆ" : " · تیمی بەرامبەر"}
                  </Text>

                  {teamPlayers.map((player) => (
                    <View key={player.id} style={styles.matchMenuPlayerRow}>
                      <PlayerAvatar
                        avatarId={player.avatarId}
                        size={34}
                        style={styles.matchMenuAvatar}
                      />

                      <View style={styles.matchMenuPlayerInfo}>
                        <View style={styles.matchMenuPlayerNameRow}>
                          <Text
                            numberOfLines={1}
                            style={styles.matchMenuPlayerName}
                          >
                            {player.name}
                          </Text>

                        </View>

                        <Text style={styles.matchMenuPlayerMeta}>
                          {getPlayerRankLabel(player)}
                        </Text>
                      </View>

                    </View>
                  ))}
                </View>
              );
            })}
          </View>

          <Pressable style={styles.matchMenuLeaveButton} onPress={onLeavePress}>
            <Text style={styles.matchMenuLeaveText}>{"\u062f\u06d5\u0631\u0686\u0648\u0648\u0646 \u0644\u06d5 \u06cc\u0627\u0631\u06cc"}</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  matchMenuOverlay: {
    ...StyleSheet.absoluteFillObject,
    direction: "ltr",
    zIndex: 950,
    elevation: 950,
    alignItems: "flex-end",
    justifyContent: "flex-start",
  },

  matchMenuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(9, 3, 18, 0.24)",
  },

  matchMenuPanel: {
    width: 300,
    maxWidth: "100%",
    height: "100%",
    borderTopLeftRadius: 24,
    borderBottomLeftRadius: 24,
    padding: 18,
    overflow: "hidden",
    backgroundColor: "rgba(58, 25, 92, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 20,
  },

  matchMenuContent: {
    paddingTop: 15,
  },

  matchMenuPlayersSection: {
    gap: 12,
  },

  teamGroup: {
    gap: 6,
  },

  teamGroupTitle: {
    color: "rgba(248,243,239,0.68)",
    fontSize: 10,
    fontFamily: "SpedaRegular",
    letterSpacing: 0.75,
  },

  matchMenuPlayerRow: {
    minHeight: 48,
    paddingHorizontal: 8,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.055)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },

  matchMenuAvatar: {
    borderWidth: 1.5,
    borderColor: "rgba(250,204,21,0.75)",
  },

  matchMenuPlayerInfo: {
    flex: 1,
    minWidth: 0,
    marginLeft: 9,
  },

  matchMenuPlayerNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  matchMenuPlayerName: {
    flexShrink: 1,
    color: "#f8f3ef",
    fontSize: 13,
    fontFamily: "SpedaRegular",
  },


  matchMenuPlayerMeta: {
    marginTop: 2,
    color: "rgba(248,243,239,0.58)",
    fontSize: 9,
    fontFamily: "SpedaRegular",
  },


  matchMenuLeaveButton: {
    height: 42,
    marginTop: 18,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: "#dc2626",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)",
  },

  matchMenuLeaveText: {
    color: "#ffffff",
    fontSize: 13,
    fontFamily: "SpedaBold",
  },
});
