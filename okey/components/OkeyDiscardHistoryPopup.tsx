import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { isOkeyWildcard } from "@/okey/engine/okey-engine";
import type { OkeyTile } from "@/okey/types/okey";
import { OkeyTileFace } from "./OkeyTileFace";

type OkeyDiscardHistoryPopupProps = {
  visible: boolean;
  tiles: OkeyTile[];
  okeyTile: OkeyTile;
  onClose: () => void;
};

export function OkeyDiscardHistoryPopup({
  visible,
  tiles,
  okeyTile,
  onClose,
}: OkeyDiscardHistoryPopupProps) {
  if (!visible) return null;

  const newestFirst = [...tiles].reverse();

  return (
    <View style={styles.overlayRoot} pointerEvents="box-none" accessibilityViewIsModal>
      <View style={styles.backdrop}>
        <Pressable
          accessible
          accessibilityRole="button"
          accessibilityLabel="داخستنی مێژووی بەردە فڕێدراوەکان"
          accessibilityHint="دوو جار لێبدە بۆ داخستن."
          style={styles.backdropPressable}
          onPress={onClose}
        />
      </View>

      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text accessibilityRole="header" style={styles.title}>{`بەردە فڕێدراوەکان (${tiles.length} بەرد)`}</Text>
        </View>

        <ScrollView
          accessibilityRole="list"
          accessibilityLabel={`مێژووی ${tiles.length} بەردی فڕێدراو`}
          contentContainerStyle={styles.tileGrid}
          showsVerticalScrollIndicator={false}
        >
          {newestFirst.map((tile, index) => (
            <View
              key={`${tile.id}-${index}`}
              style={styles.tileSlot}
            >
              <View style={styles.tileScale}>
                <OkeyTileFace
                  tile={tile}
                  compact
                  isWildcard={isOkeyWildcard(tile, okeyTile)}
                />
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlayRoot: {
    ...StyleSheet.absoluteFill,
    zIndex: 1200,
    elevation: 1200,
    alignItems: "center",
    justifyContent: "center",
  },

  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.62)",
  },

  backdropPressable: {
    flex: 1,
  },

  card: {
    width: 540,
    maxWidth: "88%",
    minHeight: 170,
    maxHeight: "80%",

    borderRadius: 8,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,

    backgroundColor: "rgba(18, 13, 28, 0.96)",

    borderWidth: 1,
    borderColor: "rgba(248,215,116,0.42)",

    zIndex: 1201,
    elevation: 1201,
  },

  headerRow: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },

  title: {
    color: "#fff7da",
    fontSize: 12,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  tileGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 2,
    rowGap: 2,
    paddingBottom: 2,
  },

  tileSlot: {
    width: 26,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },

  tileScale: {
    transform: [{ scale: 0.6 }],
  },
});
