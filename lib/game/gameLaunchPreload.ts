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

export async function prepareMultiplayerGameLaunch(
  roomId: string,
  mode: "1v1" | "2v2",
) {
  if (!roomId) return;

  const roomTable = mode === "1v1" ? "one_vs_one_rooms" : "two_vs_two_rooms";
  const startRpc = mode === "1v1" ? "start_one_vs_one_game" : "start_two_vs_two_game";
  const snapshotRpc = mode === "1v1" ? "get_one_vs_one_snapshot" : "get_two_vs_two_snapshot";

  const tablePreparation = (async () => {
    const { data, error } = await supabase.rpc("get_multiplayer_room_table", {
      p_room_id: roomId,
      p_mode: mode,
    });

    if (error) throw error;

    preloadedTableId =
      typeof data === "string" && isTableId(data)
        ? data
        : DEFAULT_TABLE_ID;

    const source = Image.resolveAssetSource(
      getTableById(preloadedTableId).images.game,
    );
    if (source?.uri) await ExpoImage.prefetch(source.uri, "memory-disk");
  })();

  const gamePreparation = (async () => {
    const { data: room } = await supabase
      .from(roomTable)
      .select("status, state")
      .eq("id", roomId)
      .maybeSingle();

    const hasStarted =
      room?.state?.status === "started" ||
      Array.isArray(room?.state?.handCounts);

    if (!hasStarted) {
      const { error } = await supabase.rpc(startRpc, { p_room_id: roomId });
      if (error) throw error;
    }

    const { error } = await supabase.rpc(snapshotRpc, { p_room_id: roomId });
    if (error) throw error;
  })();

  await Promise.all([tablePreparation, gamePreparation]);
}
