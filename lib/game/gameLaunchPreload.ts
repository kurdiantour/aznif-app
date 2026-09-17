import { SupabaseDominoOneVsOneAdapter } from "@/domino/modes/one-vs-one/adapters/supabase-domino-one-vs-one-adapter";
import {
  DEFAULT_TABLE_ID,
  getTableById,
  isTableId,
  type TableId,
} from "@/constants/catalog/tables";
import { supabase } from "@/lib/supabase";
import { Image as ExpoImage } from "expo-image";
import { Image } from "react-native";

let preloadedTableId: TableId = DEFAULT_TABLE_ID;

export function getPreloadedTableId() {
  return preloadedTableId;
}

export function setPreloadedTableId(id: TableId) {
  if (isTableId(id)) {
    preloadedTableId = id;
  }
}

export async function preloadEquippedCosmeticSet(): Promise<TableId> {
  try {
    const { data } = await supabase
      .from("user_equipped_shop_items")
      .select("item_id")
      .eq("category", "tables")
      .maybeSingle();

    if (data?.item_id && isTableId(data.item_id)) {
      preloadedTableId = data.item_id;
    }
  } catch (error) {
    console.warn("Unable to resolve equipped cosmetic set", error);
  }

  const setAssets = getTableById(preloadedTableId).assets;
  for (const asset of [
    setAssets.table,
    setAssets.playerRack,
    setAssets.opponentRack,
    setAssets.tiles.back,
  ]) {
    const source = Image.resolveAssetSource(asset);
    if (source?.uri) await ExpoImage.prefetch(source.uri, "memory-disk");
  }

  return preloadedTableId;
}

export async function prepareMultiplayerGameLaunch(
  roomId: string,
  mode: "1v1" | "2v2",
) {
  if (!roomId) return;

  const tablePreparation = (async () => {
    const { data, error } = await supabase.rpc("get_multiplayer_room_table", {
      p_room_id: roomId,
      p_mode: mode,
    });

    if (error) throw error;

    preloadedTableId =
      typeof data === "string" && isTableId(data)
        ? data
        : await preloadEquippedCosmeticSet();

    const setAssets = getTableById(preloadedTableId).assets;
    for (const asset of [
      setAssets.table,
      setAssets.playerRack,
      setAssets.opponentRack,
      setAssets.tiles.back,
    ]) {
      const source = Image.resolveAssetSource(asset);
      if (source?.uri) await ExpoImage.prefetch(source.uri, "memory-disk");
    }
  })();

  const gamePreparation =
    mode === "1v1"
      ? new SupabaseDominoOneVsOneAdapter(roomId).prepareLaunch()
      : (async () => {
          const { data: room } = await supabase
            .from("two_vs_two_rooms")
            .select("status, state")
            .eq("id", roomId)
            .maybeSingle();

          const hasStarted =
            room?.state?.status === "started" ||
            Array.isArray(room?.state?.handCounts);

          if (!hasStarted) {
            const { error } = await supabase.rpc("start_two_vs_two_game", {
              p_room_id: roomId,
            });
            if (error) throw error;
          }

          const { error } = await supabase.rpc("get_two_vs_two_snapshot", {
            p_room_id: roomId,
          });
          if (error) throw error;
        })();

  await Promise.all([tablePreparation, gamePreparation]);
}
