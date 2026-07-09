import { LinearGradient } from "expo-linear-gradient";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { BottomNav } from "@/components/lobby/BottomNav";
import { LobbyHeader } from "@/components/lobby/LobbyHeader";
import { useProfile } from "@/lib/profile";
import { supabase } from "@/lib/supabase";
import { getBalance } from "@/lib/wallet";
import { Wallet } from "@/types/wallet";

const BET_OPTIONS = [1, 5];
const PRIVATE_ROOM_BET_AMOUNT = 10;

export default function CreateRoomScreen() {
  const router = useRouter();
  const { profile, loading: profileLoading } = useProfile();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [privateSubmitting, setPrivateSubmitting] = useState(false);
  const [publicSubmitting, setPublicSubmitting] = useState(false);
  const [joinSubmitting, setJoinSubmitting] = useState(false);
  const [roomCode, setRoomCode] = useState("");
  const [roomCodeError, setRoomCodeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profileLoading || !profile) return;

    getBalance().then(setWallet).catch(() => setError("Unable to load balance.")).finally(() => setLoading(false));
  }, [profile, profileLoading]);

  const roomError = (reason: unknown, fallback: string) => {
    const message = reason instanceof Error ? reason.message : fallback;
    const normalized = message.toLowerCase();
    if (normalized.includes("not found")) return "We could not find a room with that code.";
    if (normalized.includes("not joinable") || normalized.includes("full")) return "This room is no longer available. Ask the host for a new code.";
    return normalized.includes("authentication") ? "Please sign in again before joining a room." : message;
  };

  const openRoom = (roomId: string, code = "") => router.replace({ pathname: "/matchmaking", params: { mode: "1v1", matchmaking_status: "private", room_id: roomId, room_code: code, matchType: "private" } });
  const createRoom = async () => {
    setPrivateSubmitting(true); setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc("create_private_10_aznif_room");
      if (rpcError) throw rpcError;
      if (!data?.id) throw new Error("Unable to create a private room.");
      openRoom(data.id, data.room_code);
    } catch (reason) { setError(roomError(reason, "Unable to create private room.")); }
    finally { setPrivateSubmitting(false); }
  };
  const joinRoom = async () => {
    const code = roomCode.trim().toUpperCase();
    if (!code) {
      setRoomCodeError("تکایە کۆدی ژوور بنووسە");
      return;
    }
    setRoomCodeError(null);
    setJoinSubmitting(true); setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc("join_private_10_aznif_room", { p_room_code: code });
      if (rpcError) throw rpcError;
      if (!data?.ok) {
        const messages: Record<string, string> = {
          invalid_code: "We could not find a private room with that code.",
          expired: "This private room has expired.",
          host_unavailable: "The host is no longer waiting in this room.",
          not_joinable: "This private room is no longer available.",
          insufficient_aznif: "Both players need at least 10 Aznif.",
          already_in_paid_room: "You are already in another paid room.",
          rate_limited: "Too many room-code attempts. Please wait a few minutes.",
          cannot_join_own_room: "You are already the host of this room.",
        };
        throw new Error(messages[data?.error_code] ?? "Unable to join this private room.");
      }
      if (!data.room_id) throw new Error("Unable to join this private room.");
      openRoom(data.room_id, code);
    } catch (reason) { setError(roomError(reason, "Unable to join private room.")); }
    finally { setJoinSubmitting(false); }
  };
  const startPublicMatch = async (betAmount: number) => {
    setPublicSubmitting(true); setError(null);
    try {
      const { data: result, error: rpcError } = await supabase.rpc("find_one_vs_one_bet_match", {
        p_bet_amount: betAmount,
      });
      if (rpcError) throw rpcError;
      if (!result?.status || (result.status === "matched" && !result.room_id)) {
        throw new Error("Unable to start matchmaking.");
      }
      router.replace({ pathname: "/matchmaking", params: { mode: "1v1", matchmaking_status: result.status, room_id: result.room_id ?? "", matchType: "duo" } });
    } catch (reason) { setError(roomError(reason, "Unable to start matchmaking.")); }
    finally { setPublicSubmitting(false); }
  };

  if (!profileLoading && !profile) return <Redirect href="/login" />;
  if (loading || profileLoading) return <View style={styles.screen}><LobbyHeader /><View style={styles.loading}><ActivityIndicator size="large" color="#fff" /></View><BottomNav active="home" /></View>;

  const submitting = privateSubmitting || publicSubmitting || joinSubmitting;
  const privateRoomDisabled = !wallet || wallet.balances.mc < PRIVATE_ROOM_BET_AMOUNT;

  return <View style={styles.screen}>
    <LobbyHeader />
    <View style={styles.cardsRow}>
      <View style={[styles.card, styles.createCard]}>
        <Image source={require("@/assets/images/lobby/create-room.webp")} style={styles.cover} resizeMode="cover" />
        <LinearGradient colors={["transparent", "rgba(8,9,20,0.97)"]} style={styles.createFade} />
        <View style={styles.createCardBody}>
          <Text style={styles.description}>دروستکردنی مێزێکی تایبەت</Text>
          <Text style={styles.description}>بەشداری: ( {PRIVATE_ROOM_BET_AMOUNT.toLocaleString("en-US")} ) ئەزنیف</Text>
          <Pressable style={[styles.button, styles.createButton, (privateRoomDisabled || submitting) && styles.dim]} onPress={createRoom} disabled={privateRoomDisabled || submitting}>
            {privateSubmitting ? <ActivityIndicator color="#fff" /> : (
              <View style={styles.createButtonLabel}>
                <Text style={styles.buttonText}>دروستکردن ژوور</Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>

      <View style={[styles.card, styles.joinCard]}>
        <LinearGradient colors={["#193656", "#13243b", "#10141e"]} style={StyleSheet.absoluteFillObject} />
        <View style={styles.cardBody}>
          {roomCodeError ? <Text style={styles.roomCodeError}>{roomCodeError}</Text> : null}
          <TextInput value={roomCode} onChangeText={(value) => { setRoomCode(value); setRoomCodeError(null); }} placeholder="کۆدی ژوورەوە" placeholderTextColor="#9faec6" autoCapitalize="characters" editable={!submitting} style={styles.input} />
          <Pressable style={[styles.button, styles.joinButton, submitting && styles.dim]} onPress={joinRoom} disabled={submitting}>
            <Text style={styles.buttonText}>چوونە ژوورەوە</Text>
          </Pressable>
        </View>
      </View>

      {BET_OPTIONS.map((amount) => {
        const disabled = !wallet || amount > wallet.balances.mc;
        return <Pressable key={amount} style={[styles.card, styles.matchCard, disabled && styles.dim]} onPress={() => startPublicMatch(amount)} disabled={disabled || submitting}>
          <LinearGradient colors={amount === 1 ? ["#4d320d", "#795011", "#17151b"] : ["#412162", "#7220c3", "#181426"]} locations={[0, 0.67, 1]} style={StyleSheet.absoluteFillObject} />
          <View style={styles.cardBody}>
            <Text style={styles.heading}>پێکدادان</Text>
            <Text style={styles.description}>
              بەشداری: ( {amount.toLocaleString("en-US")} ) ئەزنیف
            </Text>
            <View style={[styles.button, styles.searchButton]}><Text style={styles.buttonText}>گەڕان</Text></View>
          </View>
        </Pressable>;
      })}
    </View>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <BottomNav active="home" />
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#151827", paddingHorizontal: 30, paddingTop: 14, paddingBottom: 88 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  cardsRow: { flexDirection: "row", width: "100%", height: "80%", maxHeight: 238, minHeight: 205, marginTop: 0, gap: 8 },
  card: { flex: 1, borderRadius: 14, overflow: "hidden", backgroundColor: "#172033" },
  createCard: {},
  joinCard: {},
  matchCard: {},
  activeBet: {},
  cover: { width: "100%", height: "100%" },
  createFade: { position: "absolute", left: 0, right: 0, bottom: 0, height: "48%" },
  cardBody: { flex: 1, justifyContent: "flex-end", alignItems: "center", padding: 18 },
  createCardBody: { position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center", padding: 18 },
  heading: { color: "#fff", fontSize: 17, fontFamily: "SpedaBold", textAlign: "center" },
  description: { marginTop: 4, color: "#f3f4f6", fontSize: 11, fontFamily: "SpedaBold", textAlign: "center" },
  button: { width: "100%", height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 13 },
  createButton: { backgroundColor: "#8b5be4" }, joinButton: { backgroundColor: "#2853a4" }, searchButton: { backgroundColor: "#cf8f08" },
  buttonText: { color: "#fff", fontSize: 11, fontFamily: "SpedaBold", textAlign: "center" },
  createButtonLabel: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 4 },
  input: { width: "100%", height: 40, marginTop: 13, borderRadius: 11, borderWidth: 1, borderColor: "#426184", backgroundColor: "rgba(10, 17, 31, 0.64)", color: "#fff", paddingHorizontal: 14, fontSize: 11, fontFamily: "SpedaBold", textAlign: "center" },
  roomCodeError: { color: "#ff9a9a", fontSize: 11, fontFamily: "SpedaBold", textAlign: "center" },
  dim: { opacity: 0.46 }, error: { marginTop: 10, color: "#ff9a9a", textAlign: "center", fontSize: 12, fontFamily: "SpedaBold" },
});
