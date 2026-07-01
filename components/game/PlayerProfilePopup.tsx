import { PlayerAvatar } from "@/components/player/PlayerAvatar";
import type { AvatarId } from "@/constants/avatars";
import { sendFriendRequest } from "@/lib/friends";
import { getRankTitleFromLevel } from "@/lib/progression";
import { supabase } from "@/lib/supabase";
import type { Player } from "@/types/game";
import { BlurView } from "expo-blur";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";

type Profile = { username: string; player_id: string; avatar_id: AvatarId; level: number; points: number; games_played: number; games_won: number; games_lost: number };
type Balances = { mc: number; gold: number };
type FriendState = "none" | "pending" | "accepted" | "self" | "unavailable";

export default function PlayerProfilePopup({
  player,
  onDismiss,
}: {
  player: Player | null;
  onDismiss: () => void;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [friendState, setFriendState] = useState<FriendState>("unavailable");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const translateX = useRef(new Animated.Value(420)).current;

  useEffect(() => {
    if (!player) return;
    translateX.setValue(420);
    Animated.timing(translateX, {
      toValue: 0,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [player, translateX]);

  const dismiss = () => {
    Animated.timing(translateX, {
      toValue: 420,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) onDismiss();
    });
  };

  useEffect(() => {
    let active = true;
    setProfile(null);
    setBalances(null);
    setFriendState("unavailable");
    setLoading(false);
    if (!player || !/^[0-9a-f-]{36}$/i.test(player.id)) return;
    setLoading(true);
    void (async () => {
      const [{ data: auth }, { data: cards }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.rpc("get_public_player_card", { p_player_id: player.id }),
      ]);
      if (!active) return;
      const card = cards?.[0] ?? null;
      setProfile(card as Profile | null);
      setBalances(card ? { mc: Number(card.aznif) || 0, gold: Number(card.gems) || 0 } : null);
      const ownId = auth.user?.id;
      if (!ownId) setFriendState("unavailable");
      else if (ownId === player.id) setFriendState("self");
      else {
        const { data } = await supabase.from("friendships").select("status").or(`and(requester_id.eq.${ownId},addressee_id.eq.${player.id}),and(requester_id.eq.${player.id},addressee_id.eq.${ownId})`).maybeSingle();
        if (active) setFriendState(data?.status === "accepted" ? "accepted" : data?.status === "pending" ? "pending" : "none");
      }
      if (active) setLoading(false);
    })().catch(() => { if (active) { setFriendState("unavailable"); setLoading(false); } });
    return () => { active = false; };
  }, [player]);

  const addFriend = async () => {
    if (!player || friendState !== "none") return;
    setSending(true);
    try { await sendFriendRequest(player.id); setFriendState("pending"); }
    finally { setSending(false); }
  };

  const buttonLabel = friendState === "accepted" ? "هاوڕێن" : friendState === "pending" ? "داواکاری نێردرا" : "زیادکردنی هاوڕێ";

  if (!player) return null;

  return (
    <View style={styles.overlay}>
      <Pressable style={styles.backdrop} onPress={dismiss} />
      <Animated.View style={[styles.card, { transform: [{ translateX }] }]}>
            <BlurView intensity={88} tint="dark" pointerEvents="none" style={StyleSheet.absoluteFill} />
            <PlayerAvatar avatarId={profile?.avatar_id ?? player.avatarId} size={72} style={styles.avatar} />
            <Text style={styles.name}>{profile?.username ?? player.name}</Text>
            {loading ? <ActivityIndicator color="#a855f7" style={styles.loader} /> : (
              <>
                <Text style={styles.level}>{getRankTitleFromLevel(profile?.level ?? 1)}</Text>
                <View style={styles.stats}>
                  <View style={styles.statBox}><Text style={styles.statValue}>{balances?.mc ?? 0}</Text><Text style={styles.statLabel}>ئەزنیف</Text></View>
                  <View style={styles.statBox}><Text style={styles.statValue}>{balances?.gold ?? 0}</Text><Text style={styles.statLabel}>گەوهەر</Text></View>
                  <View style={styles.statBox}><Text style={styles.statValue}>{profile?.points ?? 0}</Text><Text style={styles.statLabel}>پوینت</Text></View>
                </View>
                <View style={styles.gameStats}>
                  <View style={styles.gameStatRow}><Text style={styles.gameStatLabel}>کۆی یارییەکان</Text><Text style={styles.gameStatValue}>{profile?.games_played ?? 0}</Text></View>
                  <View style={styles.gameStatRow}><Text style={styles.gameStatLabel}>بردنەوە</Text><Text style={styles.gameStatValue}>{profile?.games_won ?? 0}</Text></View>
                  <View style={styles.gameStatRow}><Text style={styles.gameStatLabel}>دۆڕان</Text><Text style={styles.gameStatValue}>{profile?.games_lost ?? 0}</Text></View>
                </View>
                {friendState !== "self" && (
                  <Pressable style={[styles.friendButton, friendState !== "none" && styles.friendButtonDisabled]} onPress={addFriend} disabled={friendState !== "none" || sending}>
                    {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.friendButtonText}>{buttonLabel}</Text>}
                  </Pressable>
                )}
              </>
            )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 980,
    elevation: 980,
    alignItems: "flex-end",
    justifyContent: "flex-start",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "transparent",
  },
  card: {
    width: 300,
    maxWidth: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingHorizontal: 24,
    paddingTop: 20,
    borderTopLeftRadius: 24,
    borderBottomLeftRadius: 24,
    overflow: "hidden",
    backgroundColor: "rgba(58, 25, 92, 0.18)",
    shadowOffset: { width: 0, height: 12 },
    elevation: 24,
  },
  avatar: {
    borderWidth: 3,
    borderColor: "#a855f7",
  },
  name: {
    marginTop: 14,
    color: "#ffffff",
    fontSize: 20,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },
  loader: { marginTop: 18 },
  level: { marginTop: 2, color: "#e9d5ff", fontSize: 12, fontFamily: "SpedaBold" },
  stats: { width: "100%", flexDirection: "row", gap: 7, marginTop: 14 },
  statBox: { flex: 1, minHeight: 46, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.07)" },
  statValue: { color: "#facc15", fontSize: 13, fontFamily: "RobotoMedium" },
  statLabel: { marginTop: 1, color: "#e9d5ff", fontSize: 8, fontFamily: "SpedaBold" },
  gameStats: { width: "100%", marginTop: 12, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.055)" },
  gameStatRow: { minHeight: 27, flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between" },
  gameStatLabel: { color: "rgba(255,255,255,0.72)", fontSize: 11, fontFamily: "SpedaBold" },
  gameStatValue: { color: "#ffffff", fontSize: 13, fontFamily: "RobotoMedium" },
  friendButton: { marginTop: 18, minWidth: 170, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#7c3aed" },
  friendButtonDisabled: { backgroundColor: "rgba(124,58,237,0.35)" },
  friendButtonText: { color: "#fff", fontSize: 12, fontFamily: "SpedaBold" },
});
