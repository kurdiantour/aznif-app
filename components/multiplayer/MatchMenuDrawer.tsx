import { PlayerAvatar } from "@/components/player/PlayerAvatar";
import { getRankTitleFromPoints } from "@/lib/progression";
import { BlurView } from "expo-blur";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

type MatchMenuDrawerProps = {
  visible: boolean;
  loadHumanProfiles?: boolean;
  showBotLabel?: boolean;
  botLabel?: string;
  players: any[];
  humanPlayer?: any | null;
  activePlayerId?: string | null;
  translateX: Animated.Value;
  onClose: () => void;
  onLeavePress: () => void;
};

function getPlayerRankLabel(player: any) {
  if (player.kind === "bot") {
    return "بۆت";
  }

  return getRankTitleFromPoints(player.points);
}

export default function MatchMenuDrawer(props: MatchMenuDrawerProps) {
  return props.visible ? (
    <MatchMenuDrawerContent {...props} />
  ) : null;
}

function MatchMenuDrawerContent({
  showBotLabel = true,
  botLabel = "بۆت",
  players,
  humanPlayer,
  activePlayerId,
  translateX,
  onClose,
  onLeavePress,
}: MatchMenuDrawerProps) {

  const myTeamId = humanPlayer?.teamId ?? players[0]?.teamId;
  const opponentTeamId =
    myTeamId === "teamA" ? "teamB" : "teamA";

  const hasAuthoritativeTeams =
    !!myTeamId &&
    players.some((player) => !!player?.teamId);

  // 2v2 teammates occupy opposite indexes (0 + 2 and 1 + 3). The waiting
  // popup displays those same pairs together, so the drawer must group by
  // the authoritative team id instead of grouping adjacent array entries.
  const myTeamPlayers = hasAuthoritativeTeams
    ? players.filter(
        (player) => player?.teamId === myTeamId,
      )
    : [players[0], players[2]].filter(Boolean);

  const opponentTeamPlayers = hasAuthoritativeTeams
    ? players.filter(
        (player) => player?.teamId === opponentTeamId,
      )
    : [players[1], players[3]].filter(Boolean);

  const teams = [
    {
      key: "my-team",
      title: "تیمی تۆ",
      players: myTeamPlayers,
    },
    {
      key: "opponent-team",
      title: "تیمی بەرامبەر",
      players: opponentTeamPlayers,
    },
  ];

  return (
    <View style={styles.matchMenuOverlay}>
      <Pressable
        style={styles.matchMenuBackdrop}
        onPress={onClose}
      />

      <Animated.View
        style={[
          styles.matchMenuPanel,
          {
            transform: [
              {
                translateX,
              },
            ],
          },
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
            {teams.map((team) => (
              <View
                key={team.key}
                style={styles.teamGroup}
              >
                <Text style={styles.teamGroupTitle}>
                  {team.title}
                </Text>

                {team.players.map((player) => {
                  const isBot = player.kind === "bot";

                  return (
                    <View
                      key={player.id}
                      style={[
                        styles.matchMenuPlayerRow,
                        player.id === activePlayerId &&
                          styles.matchMenuPlayerRowActive,
                      ]}
                    >
                      <View style={styles.matchMenuAvatar}>
                        <PlayerAvatar
                          avatarId={isBot ? undefined : player.avatarId}
                          avatarUrl={player.avatarUrl}
                          fallbackLabel={isBot && !player.avatarUrl ? player.name : undefined}
                          size={34}
                        />
                      </View>

                      <View
                        style={styles.matchMenuPlayerInfo}
                      >
                        <View
                          style={
                            styles.matchMenuPlayerNameRow
                          }
                        >
                          <Text
                            numberOfLines={1}
                            style={
                              styles.matchMenuPlayerName
                            }
                          >
                            {player.name}
                          </Text>
                        </View>

                        {(!isBot || showBotLabel) && <Text
                          style={styles.matchMenuPlayerMeta}
                        >
                          {isBot ? botLabel : getPlayerRankLabel(player)}
                        </Text>}
                      </View>
                    </View>
                  );
                })}
              </View>
            ))}
          </View>

          <Pressable
            style={styles.matchMenuLeaveButton}
            onPress={onLeavePress}
          >
            <Text style={styles.matchMenuLeaveText}>
              دەرچوون لە یاری
            </Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  matchMenuOverlay: {
    ...StyleSheet.absoluteFill,
    direction: "ltr",
    zIndex: 950,
    elevation: 950,
    alignItems: "flex-end",
    justifyContent: "flex-start",
  },

  matchMenuBackdrop: {
    ...StyleSheet.absoluteFill,
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
    shadowOffset: {
      width: 0,
      height: 8,
    },

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

  matchMenuPlayerRowActive: {
    borderColor: "#ef2424",
    borderWidth: 1,
  },

  matchMenuPlayerRow: {
    minHeight: 48,
    paddingHorizontal: 8,
    paddingVertical: 6,

    flexDirection: "row",
    alignItems: "center",

    borderRadius: 10,

    backgroundColor:
      "rgba(255,255,255,0.055)",

    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.18)",
  },

  matchMenuAvatar: {
    width: 37,
    height: 37,
    borderRadius: 18.5,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor:
      "rgba(250,204,21,0.75)",
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
    borderColor:
      "rgba(255,255,255,0.24)",
  },

  matchMenuLeaveText: {
    color: "#ffffff",
    fontSize: 13,
    fontFamily: "SpedaBold",
  },
});
