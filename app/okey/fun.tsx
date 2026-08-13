import {
  Ionicons,
  MaterialCommunityIcons,
} from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import {
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { BottomNav } from "@/components/lobby/BottomNav";
import { LobbyHeader } from "@/components/lobby/LobbyHeader";
import {
  MOBILE_HORIZONTAL_INSET,
  TABLET_HORIZONTAL_INSET,
} from "@/constants/layout";
import { useProfile } from "@/lib/profile";
import { getBalance } from "@/lib/wallet";
import { releaseTakenOverOkeyMemberships } from "@/okey/multiplayer/okey-active-membership";
import {
  matchmakeOkeyRoom,
  type OkeyRoomSnapshot,
} from "@/okey/multiplayer/okey-room-api";

type OkeyTable = {
  id: string;
  subtitle: string;
  entry: number;
  minPoints: number;
  accent: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
};

const OKEY_LOBBY_CARD_WIDTH = 200;
const OKEY_LOBBY_CARD_HEIGHT = 250;

const FUN_TABLES: OkeyTable[] = [
  {
    id: "starter",
    subtitle: "مێزی دەستپێک",
    entry: 500,
    minPoints: 0,
    accent: "#22c55e",
    icon: "shield-half-full",
  },
  {
    id: "bronze",
    subtitle: "مێزی ئاسایی",
    entry: 3_500,
    minPoints: 250,
    accent: "#c47a38",
    icon: "shield-outline",
  },
  {
    id: "silver",
    subtitle: "مێزی هاوسەنگ",
    entry: 15_000,
    minPoints: 650,
    accent: "#94a3b8",
    icon: "shield-star-outline",
  },
  {
    id: "gold",
    subtitle: "مێزی شارەزا",
    entry: 25_000,
    minPoints: 1_100,
    accent: "#f5c542",
    icon: "crown-outline",
  },
];

function formatAmount(value: number) {
  return value.toLocaleString();
}

type TableCardProps = {
  table: OkeyTable;
  balance: number;
  points: number;
  joining: boolean;
  disabledByOtherJoin: boolean;
  onJoin: () => void;
};

function TableCard({
  table,
  balance,
  points,
  joining,
  disabledByOtherJoin,
  onJoin,
}: TableCardProps) {
  const affordable = balance >= table.entry;
  const meetsPointRequirement = points >= table.minPoints;

  const disabled =
    !affordable ||
    !meetsPointRequirement ||
    joining ||
    disabledByOtherJoin;

  return (
    <Pressable
      disabled={disabled}
      onPress={onJoin}
      style={({ pressed }) => [
        styles.tableCard,
        (!affordable || !meetsPointRequirement) && styles.tableCardLocked,
        joining && styles.tableCardJoining,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <LinearGradient
        colors={[
          `${table.accent}55`,
          "rgba(15,23,42,0.96)",
        ]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.tableTopPill}>
        <Text style={styles.tableTopPillText}>
          {table.subtitle}
        </Text>
      </View>

      <View
        style={[
          styles.tableIcon,
          {
            borderColor: `${table.accent}88`,
          },
        ]}
      >
        {joining ? (
          <ActivityIndicator color={table.accent} />
        ) : (
          <MaterialCommunityIcons
            name={table.icon}
            size={31}
            color={table.accent}
          />
        )}
      </View>

      <View style={styles.metaPill}>
        <Ionicons
          name="star"
          size={13}
          color="#f8d774"
        />

        <Text style={styles.metaText}>
          {formatAmount(table.minPoints)}
        </Text>
      </View>

      <View style={styles.entryBox}>
        <MaterialCommunityIcons
          name="circle-multiple"
          size={16}
          color="#f8d774"
        />

        <Text style={styles.entryCurrency}>
          تێچوو
        </Text>

        <Text style={styles.entryAmount}>
          {formatAmount(table.entry)}
        </Text>
      </View>
    </Pressable>
  );
}

export default function OkeyFunScreen() {
  const { profile } = useProfile();
  const { width, height } = useWindowDimensions();

  const isTablet =
    Math.min(width, height) >= 600;

  const [coinBalance, setCoinBalance] =
    useState(0);

  const [joiningTableId, setJoiningTableId] =
    useState<string | null>(null);

  const [joinError, setJoinError] =
    useState<string | null>(null);

  const loadWalletBalance =
    useCallback(async () => {
      try {
        const wallet = await getBalance();

        setCoinBalance(
          Number(wallet.balances.coin || 0),
        );
      } catch {
        setCoinBalance(0);
      }
    }, []);

  useEffect(() => {
    void loadWalletBalance();
  }, [loadWalletBalance]);

  useEffect(() => {
    if (!joinError) {
      return;
    }

    const timer = setTimeout(() => {
      setJoinError(null);
    }, 5000);

    return () => clearTimeout(timer);
  }, [joinError]);

  const openOnlineGame = useCallback(
    (room: OkeyRoomSnapshot) => {
      setJoiningTableId(null);
      setJoinError(null);

      router.replace({
        pathname: "/okey/game",
        params: {
          mode: "fun",
          table: room.tableId,
          tableId: room.tableId,
          matchId: room.matchId,
        },
      });
    },
    [],
  );

  const handleJoinTable = useCallback(
    async (table: OkeyTable) => {
      if (joiningTableId) {
        return;
      }

      if (!profile) {
        setJoinError(
          "پێویستە سەرەتا بچیتە ژوورەوە.",
        );
        return;
      }

      if (coinBalance < table.entry || profile.points < table.minPoints) {
        return;
      }

      setJoinError(null);
      setJoiningTableId(table.id);

      try {
        await releaseTakenOverOkeyMemberships();

        const room =
          await matchmakeOkeyRoom(table.id);

        openOnlineGame(room);
      } catch (error) {
        console.warn(
          "Unable to join Okey Fun table:",
          error,
        );

        setJoiningTableId(null);
        setJoinError(
          "نەتوانرا بچیتە ناو یاری. دووبارە هەوڵ بدەرەوە.",
        );
      }
    },
    [
      coinBalance,
      joiningTableId,
      openOnlineGame,
      profile,
    ],
  );

  return (
    <View style={styles.shell}>
      <LobbyHeader />

      <View
        style={[
          styles.shellContent,
          {
            paddingHorizontal: isTablet
              ? TABLET_HORIZONTAL_INSET
              : MOBILE_HORIZONTAL_INSET,
          },
        ]}
      >
        <View style={styles.screen}>
          <View style={styles.content}>
            <View style={styles.tableSection}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={
                  styles.tableRow
                }
              >
                {FUN_TABLES.map((table) => (
                  <TableCard
                    key={table.id}
                    table={table}
                    balance={coinBalance}
                    points={profile?.points ?? 0}
                    joining={
                      joiningTableId === table.id
                    }
                    disabledByOtherJoin={
                      joiningTableId !== null &&
                      joiningTableId !== table.id
                    }
                    onJoin={() => {
                      void handleJoinTable(table);
                    }}
                  />
                ))}
              </ScrollView>
            </View>

          </View>
        </View>
      </View>

      {joinError ? (
        <View
          pointerEvents="none"
          style={styles.toast}
        >
          <Ionicons
            name="alert-circle-outline"
            size={18}
            color="#fca5a5"
          />

          <Text style={styles.toastText}>
            {joinError}
          </Text>
        </View>
      ) : null}

      <BottomNav requireAuth={!profile} />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    paddingTop: 14,
    paddingBottom: 18,
    backgroundColor: "#090b1d",
  },

  shellContent: {
    flex: 1,
    paddingBottom: 74,
  },

  screen: {
    flex: 1,
  },

  content: {
    flex: 1,
    justifyContent: "center",
  },

  tableSection: {
    height: OKEY_LOBBY_CARD_HEIGHT,
    justifyContent: "center",
  },

  tableRow: {
    height: OKEY_LOBBY_CARD_HEIGHT,
    gap: 8,
    paddingVertical: 0,
    paddingRight: 0,
    alignItems: "flex-start",
  },

  tableCard: {
    width: OKEY_LOBBY_CARD_WIDTH,
    height: OKEY_LOBBY_CARD_HEIGHT,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    paddingHorizontal: 10,
    paddingTop: 9,
    paddingBottom: 8,
    alignItems: "center",
  },

  tableCardLocked: {
    opacity: 0.48,
  },

  tableCardJoining: {
    opacity: 0.82,
  },

  tableTopPill: {
    height: 23,
    borderRadius: 999,
    backgroundColor:
      "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.16)",
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },

  tableTopPillText: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 10,
    fontFamily: "SpedaBold",
  },

  tableIcon: {
    marginTop: 18,
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor:
      "rgba(255,255,255,0.08)",
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  metaPill: {
    marginTop: 7,
    height: 23,
    borderRadius: 999,
    backgroundColor:
      "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.14)",
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },

  metaText: {
    color: "#f3f4f6",
    fontSize: 14,
    fontFamily: "SpedaBold",
    writingDirection: "rtl",
  },

  entryBox: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 10,
    height: 32,
    borderRadius: 9,
    backgroundColor:
      "rgba(2,6,23,0.38)",
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.10)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },

  entryAmount: {
    color: "#ffffff",
    fontSize: 14,
  },

  entryCurrency: {
    color: "#ffffff",
    fontSize: 14,
    fontFamily: "SpedaBold",
  },

  toast: {
    position: "absolute",
    bottom: 90,
    alignSelf: "center",
    zIndex: 100,
    elevation: 20,
    maxWidth: "90%",
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.35)",
    backgroundColor: "rgba(20,18,29,0.96)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },

  toastText: {
    color: "#f1e1e1",
    fontSize: 12,
    lineHeight: 19,
    textAlign: "center",
    fontFamily: "SpedaBold",
    writingDirection: "rtl",
  },

  pressed: {
    transform: [{ scale: 0.985 }],
    opacity: 0.9,
  },
});