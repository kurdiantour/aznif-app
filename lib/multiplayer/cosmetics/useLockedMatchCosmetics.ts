import { useEffect, useState } from "react";
import { AppState } from "react-native";
import type { MultiplayerCosmeticsResolution } from "./types";

/** Game-only: never accept a live preview as an authoritative match snapshot. */
export function useLockedMatchCosmetics(
  key: string | undefined,
  resolve: () => Promise<MultiplayerCosmeticsResolution | null>,
) {
  const [stored, setStored] = useState<{
    key: string;
    value: MultiplayerCosmeticsResolution;
  } | null>(null);

  useEffect(() => {
    if (!key) return;
    let active = true;
    let inFlight = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const fetchSnapshot = async () => {
      if (!active || inFlight) return;
      inFlight = true;
      clearTimeout(retry);
      let value: MultiplayerCosmeticsResolution | null = null;
      try {
        value = await Promise.race([
          resolve(),
          new Promise<null>((done) => { timeout = setTimeout(() => done(null), 15_000); }),
        ]);
      } catch {
        // A failed refresh must not replace an already accepted snapshot.
      } finally {
        clearTimeout(timeout);
        inFlight = false;
      }
      if (!active) return;
      if (value?.locked) {
        const snapshot = value;
        setStored((previous) => previous?.key === key ? previous : { key, value: snapshot });
      } else {
        retry = setTimeout(() => { void fetchSnapshot(); }, 2_000);
      }
    };
    void fetchSnapshot();
    const app = AppState.addEventListener("change", (status) => {
      if (status === "active") void fetchSnapshot();
    });
    return () => {
      active = false;
      clearTimeout(retry);
      clearTimeout(timeout);
      app.remove();
    };
  }, [key, resolve]);

  return stored && stored.key === key ? stored.value : null;
}
