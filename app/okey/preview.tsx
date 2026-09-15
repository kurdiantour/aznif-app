import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { OkeyTileFace } from "@/okey/components/OkeyTileFace";
import { OkeyPlayerRack } from "@/okey/components/OkeyPlayerRack";
import { OkeyOpponentSeat } from "@/okey/components/OkeyOpponentSeat";
import { OkeyResponsiveLayoutProvider } from "@/okey/layout/OkeyResponsiveLayoutProvider";
import type { OkeyTile, OkeyColor } from "@/okey/types/okey";

const colors: OkeyColor[] = ["red", "blue", "black", "yellow"];
const makeState = () => {
  const tiles: OkeyTile[] = Array.from({ length: 104 }, (_, index) => ({
    id: `preview-${index}`, color: colors[index % 4],
    value: Math.floor(index / 4) % 13 + 1, copy: index < 52 ? 1 : 2,
  }));
  return { hand: tiles.slice(0, 14), deck: tiles.slice(14), discards: [] as OkeyTile[], selected: null as string | null, turn: 1 };
};

export default function OkeyPreviewScreen() {
  const router = useRouter();
  const [local, setLocal] = useState(makeState);
  if (!__DEV__) return <Redirect href="/(tabs)/play" />;
  const draw = (fromDiscard: boolean) => setLocal(current => {
    if (current.hand.length >= 15) return current;
    const source = fromDiscard ? current.discards : current.deck;
    if (!source.length) return current;
    const tile = fromDiscard ? source[source.length - 1] : source[0];
    return { ...current, hand: [...current.hand, tile],
      ...(fromDiscard ? { discards: source.slice(0, -1) } : { deck: source.slice(1) }), selected: null };
  });
  const discard = () => setLocal(current => {
    if (current.hand.length < 15 || !current.selected) return current;
    const tile = current.hand.find(item => item.id === current.selected);
    if (!tile) return current;
    return { ...current, hand: current.hand.filter(item => item.id !== tile.id),
      discards: [...current.discards, tile], selected: null, turn: current.turn + 1 };
  });
  return <OkeyResponsiveLayoutProvider><View style={styles.screen}>
    <View style={styles.header}>
      <Pressable onPress={() => router.back()}><Text style={styles.link}>‹ Back</Text></Pressable>
      <Text style={styles.title}>Okey Preview · Local UI</Text>
      <Pressable onPress={() => setLocal(makeState())}><Text style={styles.link}>Reset</Text></Pressable>
    </View>
    <View style={styles.table}>
      <View style={styles.opponents}>{(["top", "left", "right"] as const).map((side, index) => <OkeyOpponentSeat key={side} name={`Bot ${index + 1}`} count={14} active={false} side={side} turnTimeLeftMilliseconds={30000} turnDeadlineAt={null} serverClockOffsetMs={0} turnDurationSeconds={30} />)}</View>
      <View style={styles.center}>
        <View style={styles.pile}><Text style={styles.white}>Indicator</Text><OkeyTileFace tile={{ id: "indicator", color: "red", value: 8, copy: 1 }} compact /></View>
        <Pressable style={styles.pile} onPress={() => draw(false)}><Text style={styles.white}>Deck · {local.deck.length}</Text><Text style={styles.big}>▣</Text></Pressable>
        <Pressable style={styles.pile} onPress={() => draw(true)}><Text style={styles.white}>Discard</Text>{local.discards.length ? <OkeyTileFace tile={local.discards[local.discards.length - 1]} compact /> : <Text style={styles.big}>—</Text>}</Pressable>
      </View>
      <Text style={styles.hint}>Turn {local.turn} · Draw, select a tile, then discard</Text>
    </View>
    <View style={styles.rack}>
      <OkeyPlayerRack tiles={local.hand} selectedTileId={local.selected} okeyTile={{ id: "okey", color: "red", value: 9, copy: 1 }} onSelectTile={tileId => setLocal(current => ({ ...current, selected: tileId }))} onMoveTile={(tileId, targetIndex) => setLocal(current => { const hand = [...current.hand]; const from = hand.findIndex(tile => tile.id === tileId); if (from < 0) return current; const [tile] = hand.splice(from, 1); hand.splice(targetIndex, 0, tile); return { ...current, hand }; })} showTurnTimer={false} turnTimeLeftMilliseconds={30000} turnDeadlineAt={null} serverClockOffsetMs={0} turnDurationSeconds={30} />
      <Pressable style={styles.button} onPress={discard}><Text style={styles.white}>Discard selected tile</Text></Pressable>
    </View>
  </View></OkeyResponsiveLayoutProvider>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#13251e" },
  header: { paddingTop: 45, paddingHorizontal: 16, paddingBottom: 12, flexDirection: "row", justifyContent: "space-between" },
  link: { color: "#f6c945", fontWeight: "700" }, title: { color: "#fff", fontSize: 17, fontWeight: "800" },
  table: { flex: 1, margin: 12, borderRadius: 100, borderWidth: 9, borderColor: "#5b3219", backgroundColor: "#176b48", justifyContent: "space-around", padding: 16 },
  opponents: { flexDirection: "row", justifyContent: "space-around" }, center: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 20 },
  pile: { alignItems: "center", minWidth: 70, minHeight: 95, justifyContent: "center" }, white: { color: "#fff", fontWeight: "700" },
  big: { color: "#f6c945", fontSize: 35 }, hint: { color: "#fff", textAlign: "center", fontSize: 12 },
  rack: { backgroundColor: "#56341e", padding: 12 }, tiles: { gap: 3, alignItems: "center", paddingVertical: 8 },
  button: { alignSelf: "center", backgroundColor: "#2e7d57", paddingHorizontal: 22, paddingVertical: 10, borderRadius: 10 },
});
