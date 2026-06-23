import { Image } from "expo-image";
import { ReactNode, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import {
  DEFAULT_TABLE_ID,
  getTableById,
  isTableId,
  type TableId,
} from "@/constants/catalog/tables";
import { supabase } from "@/lib/supabase";

type Props = {
  children: ReactNode;
  tableId?: TableId;
};

export default function TableBackground({ children, tableId }: Props) {
  const [activeTableId, setActiveTableId] = useState<TableId | null>(
    tableId ?? null,
  );
  const [tableBackgroundReady, setTableBackgroundReady] = useState(
    tableId !== undefined,
  );

  useEffect(() => {
    if (tableId) {
      setActiveTableId(tableId);
      setTableBackgroundReady(true);
      return;
    }

    let mounted = true;

    setTableBackgroundReady(false);
    void supabase
      .from("user_equipped_shop_items")
      .select("item_id")
      .eq("category", "tables")
      .maybeSingle()
      .then(
        ({ data, error }) => {
          if (!mounted) return;

          if (error) {
            console.warn("Unable to load equipped table", error);
          }

          setActiveTableId(
            data?.item_id && isTableId(data.item_id)
              ? data.item_id
              : DEFAULT_TABLE_ID,
          );
          setTableBackgroundReady(true);
        },
        (error: unknown) => {
          if (!mounted) return;
          console.warn("Unable to load equipped table", error);
          setActiveTableId(DEFAULT_TABLE_ID);
          setTableBackgroundReady(true);
        },
      );

    return () => {
      mounted = false;
    };
  }, [tableId]);

  return (
    <View style={styles.background}>
      {tableBackgroundReady && activeTableId ? (
        <Image
          source={getTableById(activeTableId).images.game}
          style={StyleSheet.absoluteFill}
          contentFit="fill"
          cachePolicy="memory-disk"
          transition={0}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.loadingBackground]} />
      )}
      <View style={styles.overlay}>{children}</View>
    </View>
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
});
