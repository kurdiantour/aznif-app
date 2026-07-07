import { PlayerAvatar } from "@/components/player/PlayerAvatar";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";

type MatchMenuDrawerProps = {
  visible: boolean;
  players: any[];
  humanPlayer?: any | null;
  currentTurnPlayerId?: string | null;
  translateX: Animated.Value;
  onClose: () => void;
  onLeavePress: () => void;
};

export default function MatchMenuDrawer({
  visible,
  players,
  humanPlayer,
  currentTurnPlayerId,
  translateX,
  onClose,
  onLeavePress,
}: MatchMenuDrawerProps) {
  if (!visible) return null;

  return (
    <View style={styles.matchMenuOverlay}>
      <Pressable
        accessibilityLabel="داخستنی ڕێکخستنەکانی یاری"
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
                    {teamId === "teamA" ? "TEAM A" : "TEAM B"}
                    {isMyTeam ? " · MY TEAM" : " · OPPONENTS"}
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

                          {currentTurnPlayerId === player.id ? (
                            <View style={styles.activeTurnDot} />
                          ) : null}
                        </View>

                        <Text style={styles.matchMenuPlayerMeta}>
                          {player.kind === "bot" ? "BOT" : "HUMAN"} ·{" "}
                          {player.tileCount} tiles left
                        </Text>
                      </View>

                      {currentTurnPlayerId === player.id ? (
                        <Text style={styles.activeTurnLabel}>TURN</Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              );
            })}
          </View>

          <Pressable style={styles.matchMenuLeaveButton} onPress={onLeavePress}>
            <Ionicons name="log-out-outline" size={19} color="#ffffff" />
            <Text style={styles.matchMenuLeaveText}>دەرچوون لە یاری</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  matchMenuOverlay: {
    ...StyleSheet.absoluteFillObject,
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
    fontFamily: "RobotoMedium",
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
    fontFamily: "RobotoMedium",
  },

  activeTurnDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#55e58a",
  },

  matchMenuPlayerMeta: {
    marginTop: 2,
    color: "rgba(248,243,239,0.58)",
    fontSize: 9,
    fontFamily: "RobotoMedium",
  },

  activeTurnLabel: {
    color: "#55e58a",
    fontSize: 9,
    fontFamily: "RobotoMedium",
    letterSpacing: 0.4,
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
