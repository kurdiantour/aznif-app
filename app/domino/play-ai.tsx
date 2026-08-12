import DominoWaitingPlayersPopup from "@/components/game/DominoWaitingPlayersPopup";
import type { AvatarId } from "@/constants/avatars";
import { useProfile } from "@/lib/profile";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ImageBackground, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const INTRO_DURATION_SECONDS = 5;

function createPracticeMatchId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export default function PlayAIModeScreen() {
  const router = useRouter();
  const { profile, loading: profileLoading } = useProfile();
  const practiceMatchIdRef = useRef(createPracticeMatchId());
  const navigationStartedRef = useRef(false);
  const [countdownSeconds, setCountdownSeconds] = useState(
    INTRO_DURATION_SECONDS,
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdownSeconds((previous) => Math.max(0, previous - 1));
    }, 1000);

    const timeout = setTimeout(() => {
      navigationStartedRef.current = true;
      router.replace({
        pathname: "/domino/game",
        params: {
          room_id: practiceMatchIdRef.current,
          mode: "1v1",
          practice: "true",
        },
      });
    }, INTRO_DURATION_SECONDS * 1000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [router]);

  if (profileLoading) return <View style={styles.loadingScreen} />;

  return (
    <ImageBackground
      source={require("@/assets/images/lobby/lobby-bg.webp")}
      style={styles.background}
      resizeMode="cover"
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.overlay} />
        <DominoWaitingPlayersPopup
          visible
          playerCount={2}
          entryFee={0}
          currency="fun"
          players={[
            {
              playerIndex: 0,
              avatarId: profile?.avatarId as AvatarId | undefined,
            },
            { playerIndex: 1, avatarId: "bot-avatar" },
          ]}
          countdownSeconds={countdownSeconds}
          onCancel={() => {
            if (!navigationStartedRef.current) router.back();
          }}
        />
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  background: { flex: 1, backgroundColor: "#050214" },
  loadingScreen: { flex: 1, backgroundColor: "#050214" },
  safeArea: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(3,0,15,0.54)",
  },
});
