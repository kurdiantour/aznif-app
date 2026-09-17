import { Image } from "expo-image";
import { type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { type TableId } from "@/constants/catalog/tables";
import {
  OkeyCosmeticsProvider,
  useOkeyCosmetics,
} from "@/okey/hooks/useOkeyCosmetics";

type Props = {
  children: ReactNode;
  tableId?: TableId;
  contentPadding?: boolean;
};

function TableBackgroundInner({
  children,
  contentPadding,
}: {
  children: ReactNode;
  contentPadding: boolean;
}) {
  const { setAssets, isReady } = useOkeyCosmetics();

  return (
    <View style={styles.background}>
      {isReady ? (
        <Image
          source={setAssets.table}
          style={StyleSheet.absoluteFill}
          contentFit="fill"
          cachePolicy="memory-disk"
          transition={0}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.loadingBackground]} />
      )}

      <View
        style={[
          styles.overlay,
          !contentPadding && styles.overlayNoPadding,
        ]}
      >
        {children}
      </View>
    </View>
  );
}

export default function TableBackground({
  children,
  tableId,
  contentPadding = true,
}: Props) {
  return (
    <OkeyCosmeticsProvider tableId={tableId}>
      <TableBackgroundInner contentPadding={contentPadding}>
        {children}
      </TableBackgroundInner>
    </OkeyCosmeticsProvider>
  );
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
    width: "100%",
    height: "100%",
  },

  loadingBackground: {
    backgroundColor: "#090b1d",
  },

  overlay: {
    flex: 1,

    paddingHorizontal: 34,
    paddingTop: 60,
    paddingBottom: 20,

    justifyContent: "space-between",
  },

  overlayNoPadding: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
});