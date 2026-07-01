import { PlayerAvatar } from "@/components/player/PlayerAvatar";
import type { GameInvite } from "@/lib/gameInvites";
import { LinearGradient } from "expo-linear-gradient";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

type Props = {
  invite: GameInvite | null;
  busy: boolean;
  error: string | null;
  onAccept: () => void;
  onDecline: () => void;
};

export function GameInvitePopup({ invite, busy, error, onAccept, onDecline }: Props) {
  if (!invite) return null;
  return (
    <View style={styles.backdrop}>
      <LinearGradient colors={["#24134b", "#090d21"]} style={styles.card}>
        <PlayerAvatar avatarId={invite.senderAvatarId} size={62} style={styles.avatar} />
        <Text style={styles.title}>بانگهێشتی یاری</Text>
        <Text style={styles.message}>{invite.senderName} بانگهێشتی یاری 1v1 کردوویت.</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.actions}>
          <Pressable style={[styles.button, styles.decline]} disabled={busy} onPress={onDecline}>
            <Text style={styles.buttonText}>ڕەتکردنەوە</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.accept]} disabled={busy} onPress={onAccept}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>قبوڵکردن</Text>}
          </Pressable>
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, zIndex: 1000, backgroundColor: "rgba(0,0,0,0.72)", alignItems: "center", justifyContent: "center" },
  card: { width: 340, maxWidth: "88%", borderRadius: 18, padding: 22, alignItems: "center", borderWidth: 1, borderColor: "rgba(168,85,247,0.6)" },
  avatar: { borderWidth: 3, borderColor: "#22c55e", borderRadius: 34 },
  title: { marginTop: 12, color: "#fff", fontFamily: "SpedaBold", fontSize: 18 },
  message: { marginTop: 7, color: "#d9d5e8", fontFamily: "SpedaBold", fontSize: 12, textAlign: "center" },
  error: { marginTop: 8, color: "#ff8a8a", fontFamily: "SpedaBold", fontSize: 11 },
  actions: { flexDirection: "row", gap: 10, marginTop: 18, width: "100%" },
  button: { flex: 1, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  accept: { backgroundColor: "#16a34a" },
  decline: { backgroundColor: "#4b5563" },
  buttonText: { color: "#fff", fontFamily: "SpedaBold", fontSize: 12 },
});
