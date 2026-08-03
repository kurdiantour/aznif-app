import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { BottomNav } from "@/components/lobby/BottomNav";
import { LobbyHeader } from "@/components/lobby/LobbyHeader";
import { MOBILE_HORIZONTAL_INSET, TABLET_HORIZONTAL_INSET } from "@/constants/layout";
import { useProfile } from "@/lib/profile";
import { getBalance } from "@/lib/wallet";

type PlayMode = "fun" | "aznif";

type OkeyTable = {
  id: string;
  subtitle: string;
  entry: number;
  minPoints: number;
  accent: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
};

const FUN_COIN_BALANCE = 25000;
const OKEY_LOBBY_CARD_WIDTH = 181;
const OKEY_LOBBY_CARD_HEIGHT = 220;

const FUN_TABLES: OkeyTable[] = [
  { id: "starter", subtitle: "مێزی دەستپێک", entry: 500, minPoints: 0, accent: "#22c55e", icon: "shield-half-full" },
  { id: "bronze", subtitle: "مێزی ئاسایی", entry: 3500, minPoints: 250, accent: "#c47a38", icon: "shield-outline" },
  { id: "silver", subtitle: "مێزی هاوسەنگ", entry: 15000, minPoints: 650, accent: "#94a3b8", icon: "shield-star-outline" },
  { id: "gold", subtitle: "مێزی شارەزا", entry: 25000, minPoints: 1100, accent: "#f5c542", icon: "crown-outline" },
];

const AZNIF_TABLES: OkeyTable[] = [
  { id: "aznif-low", subtitle: "ئەزنیفی کەم", entry: 10, minPoints: 0, accent: "#c47a38", icon: "shield-outline" },
  { id: "aznif-mid", subtitle: "ئەزنیفی مامناوەند", entry: 25, minPoints: 0, accent: "#94a3b8", icon: "shield-star-outline" },
  { id: "aznif-high", subtitle: "ئەزنیفی بەرز", entry: 40, minPoints: 0, accent: "#f5c542", icon: "crown-outline" },
  { id: "aznif-elite", subtitle: "مێزی پلەبەرز", entry: 60, minPoints: 0, accent: "#67e8f9", icon: "diamond-stone" },
];

function formatAmount(value: number) {
  return value.toLocaleString();
}

function modeCopy(mode: PlayMode) {
  return mode === "fun"
    ? {
        title: "یاریی ڕێزبەندی",
        notice: "یاریی سەرگەرمییە، بەبێ مەترسی ئەزنیف.",
        icon: "gamepad-variant-outline" as const,
        colors: ["rgba(34,197,94,0.92)", "rgba(14,116,144,0.82)"] as const,
      }
    : {
        title: "یاریی ڕاستەقینە",
        notice: "ئێستا تەنها ڕێڕەو و ڕووکار ئامادە دەکرێت.",
        icon: "cash-multiple" as const,
        colors: ["rgba(245,158,11,0.94)", "rgba(127,29,29,0.84)"] as const,
      };
}

function ModeCard({ mode, selectedMode, onPress }: { mode: PlayMode; selectedMode: PlayMode | null; onPress: () => void }) {
  const copy = modeCopy(mode);
  const selected = selectedMode === mode;

return (
  <Pressable
    onPress={onPress}
    style={({ pressed }) => [
      styles.modeCard,
      selected && styles.modeCardSelected,
      pressed && styles.pressed,
    ]}
  >
      <LinearGradient colors={copy.colors} style={StyleSheet.absoluteFill} />
      <View style={styles.modeCardShade} />
      <View style={styles.modeIconShell}>
        <MaterialCommunityIcons name={copy.icon} size={30} color="#fff7d6" />
      </View>
      <Text style={styles.modeTitle}>{copy.title}</Text>
      <Text style={styles.modeNotice}>{copy.notice}</Text>
    </Pressable>
  );
}

function TableCard({ table, mode, balance }: { table: OkeyTable; mode: PlayMode; balance: number }) {
  const isAznif = mode === "aznif";
  const affordable = isAznif ? true : balance >= table.entry;
  const handleJoin = () => {
    if (!affordable) return;
    if (isAznif) return;
    router.push({ pathname: "/okey/game", params: { mode, table: table.id } });
  };

  return (
    <Pressable
      disabled={!affordable || isAznif}
      onPress={handleJoin}
      style={({ pressed }) => [
        styles.tableCard,
        !affordable && styles.tableCardLocked,
        pressed && affordable && !isAznif && styles.pressed,
      ]}
    >
      <LinearGradient
        colors={[`${table.accent}55`, "rgba(15,23,42,0.96)"]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.tableTopPill}>
        <Text style={styles.tableTopPillText}>{table.subtitle}</Text>
      </View>
      <View style={[styles.tableIcon, { borderColor: `${table.accent}88` }]}>
        <MaterialCommunityIcons name={table.icon} size={31} color={table.accent} />
      </View>
{!isAznif && (
  <View style={styles.metaPill}>
    <Ionicons name="star" size={13} color="#f8d774" />
    <Text style={styles.metaText}>
      {formatAmount(table.minPoints)}
    </Text>
  </View>
)}
<View style={styles.entryBox}>
  <MaterialCommunityIcons
    name="circle-multiple"
    size={16}
    color="#f8d774"
  />
  <Text style={styles.entryCurrency}>تێچوو</Text>
  <Text style={styles.entryAmount}>{formatAmount(table.entry)}</Text>
</View>

    </Pressable>
  );
}

export default function OkeyLobbyScreen() {
  const [selectedMode, setSelectedMode] = useState<PlayMode | null>(null);
  const [aznifBalance, setAznifBalance] = useState<number | null>(null);
  const { profile } = useProfile();
  const { width, height } = useWindowDimensions();
  const isTablet = Math.min(width, height) >= 600;

  const tables = selectedMode === "aznif" ? AZNIF_TABLES : FUN_TABLES;
  const activeBalance = selectedMode === "aznif" ? aznifBalance ?? 0 : FUN_COIN_BALANCE;

  const loadAznifBalance = useCallback(async () => {
    try {
      const wallet = await getBalance();
      setAznifBalance(Number(wallet.balances.mc || 0));
    } catch {
      setAznifBalance(0);
    }
  }, []);

  useEffect(() => {
    void loadAznifBalance();
  }, [loadAznifBalance]);

  const tableContent = useMemo(() => {
    if (!selectedMode) return null;
    return (
      <View style={styles.tableSection}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tableRow}>
          {tables.map((table) => (
            <TableCard key={table.id} table={table} mode={selectedMode} balance={activeBalance} />
          ))}
        </ScrollView>
      </View>
    );
  }, [activeBalance, selectedMode, tables]);

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
            {!selectedMode ? (
              <View style={styles.modeSection}>
                <View style={styles.modeRow}>
                  <ModeCard mode="fun" selectedMode={selectedMode} onPress={() => setSelectedMode("fun")} />
                  <ModeCard mode="aznif" selectedMode={selectedMode} onPress={() => setSelectedMode("aznif")} />
                </View>
              </View>
            ) : tableContent}
          </View>
        </View>
      </View>
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
  modeSection: {
    height: OKEY_LOBBY_CARD_HEIGHT,
    justifyContent: "center",
  },
  modeRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
  },
  modeCard: {
    width: OKEY_LOBBY_CARD_WIDTH,
    height: OKEY_LOBBY_CARD_HEIGHT,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    padding: 16,
    justifyContent: "space-between",
  },
  modeCardSelected: {
    borderColor: "rgba(248,215,116,0.72)",
  },
  modeCardShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(2,6,23,0.24)",
  },
  modeIconShell: {
    width: 58,
    height: 58,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  modeTitle: {
    color: "#ffffff",
    fontSize: 14,
    fontFamily: "SpedaBold",
  },
  modeNotice: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "SpedaBold",
    writingDirection: "rtl",
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
    opacity: 0.68,
  },
  tableTopPill: {
    height: 23,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
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
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  tableTitleSpacer: {
    marginTop: 8,
    height: 8,
  },
  metaPill: {
    marginTop: 7,
    height: 23,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
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
    backgroundColor: "rgba(2,6,23,0.38)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
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
  pressed: {
    transform: [{ scale: 0.985 }],
    opacity: 0.9,
  },
});
