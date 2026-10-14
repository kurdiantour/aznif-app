import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { useAuthState } from "@/lib/auth-state";
import { ReturnToGamePopup } from "./ReturnToGamePopup";
import type { MultiplayerResumeAdapter, ResumableMatch } from "@/lib/multiplayer/resume/types";
import { dominoResumeAdapter } from "@/domino/multiplayer/domino-resume-adapter";
import { damaResumeAdapter } from "@/dama/multiplayer/dama-resume-adapter";

// Register future games here once their server adapter has passed resume tests.
const adapters: MultiplayerResumeAdapter[] = [dominoResumeAdapter, damaResumeAdapter];

export function MultiplayerResumeOverlay() {
  const { userId, authReady } = useAuthState();
  const pathname = usePathname();
  const router = useRouter();
  const [match, setMatch] = useState<ResumableMatch | null>(null);
  const [loading, setLoading] = useState(false);
  const rejected = useRef(new Set<string>());
  const generation = useRef(0);

  const check = useCallback(async () => {
    const current = ++generation.current;
    if (!authReady || !userId || adapters.some((adapter) => adapter.isGameRoute(pathname))) {
      setMatch(null);
      return;
    }
    try {
      for (const adapter of adapters) {
        const found = await adapter.findActive(userId);
        if (current !== generation.current) return;
        if (found && !rejected.current.has(`${found.game}:${found.matchId}`)) {
          setMatch(found);
          return;
        }
      }
      setMatch(null);
    } catch (error) {
      console.warn("Multiplayer resume discovery failed", error);
    }
  }, [authReady, userId, pathname]);

  useEffect(() => {
    const generationRef = generation;
    let active = true;
    void Promise.resolve().then(() => { if (active) void check(); });
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    return () => { active = false; ++generationRef.current; subscription.remove(); };
  }, [check]);

  useEffect(() => {
    if (!match || !userId) return;
    const adapter = adapters.find((candidate) => candidate.game === match.game);
    if (!adapter) return;
    let live = true;
    const verify = async () => {
      try {
        if (!(await adapter.validate(match, userId)) && live) {
          setMatch(null);
          router.replace("/(tabs)/play");
        }
      } catch (error) {
        console.warn("Multiplayer resume validation failed", error);
      }
    };
    const unsubscribe = adapter.watch(match, () => { void verify(); });
    void verify();
    return () => { live = false; unsubscribe(); };
  }, [match, userId, router]);

  const handleReturn = async () => {
    if (!match || !userId || loading) return;
    const adapter = adapters.find((candidate) => candidate.game === match.game);
    if (!adapter) return;
    setLoading(true);
    try {
      if (!(await adapter.returnToMatch(match, userId))) {
        setMatch(null);
        router.replace("/(tabs)/play");
        return;
      }
      router.replace({ pathname: match.route as "/domino/game" | "/dama/game", params: match.params });
    } catch (error) {
      console.warn("Multiplayer resume failed", error);
    } finally { setLoading(false); }
  };

  const handleReject = async () => {
    if (!match || !userId || loading) return;
    const adapter = adapters.find((candidate) => candidate.game === match.game);
    if (!adapter) return;
    setLoading(true);
    try {
      if (await adapter.validate(match, userId)) await adapter.reject(match);
      rejected.current.add(`${match.game}:${match.matchId}`);
      setMatch(null);
      router.replace("/(tabs)/play");
    } catch (error) {
      console.warn("Multiplayer resume rejection failed", error);
    } finally { setLoading(false); }
  };

  if (!match || adapters.some((adapter) => adapter.isGameRoute(pathname))) return null;
  return <ReturnToGamePopup loading={loading} onReturn={handleReturn} onReject={handleReject} />;
}
