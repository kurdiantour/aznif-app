import { requireNativeModule } from "expo";
import { randomUUID } from "expo-crypto";
import { useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { Platform } from "react-native";

type GameSystemGestures = {
  setProtected(token: string, enabled: boolean): Promise<void>;
};

/** Protect the bottom edge for the focused game, independently of tile gestures. */
export function useGameSystemGestureProtection() {
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "ios") return;

      let native: GameSystemGestures;

      try {
        native =
          requireNativeModule<GameSystemGestures>("AznifGameSystemGestures");
      } catch {
        return;
      }

      const token = randomUUID();

      const reportError = (error: unknown) => {
        console.error(
          "Failed to update iOS game system gesture protection",
          error,
        );
      };

      void native.setProtected(token, true).catch(reportError);

      return () => {
        void native.setProtected(token, false).catch(reportError);
      };
    }, []),
  );
}