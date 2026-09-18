import { useEffect, useState } from "react";
import { Redirect } from "expo-router";

import OkeyGameTableScene from "@/okey/scenes/OkeyGameTableScene";
import { preloadEquippedCosmeticSet } from "@/lib/game/gameLaunchPreload";

export default function OkeyPreviewScreen() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void preloadEquippedCosmeticSet().then(() => {
      if (active) setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!__DEV__) return <Redirect href="/(tabs)/play" />;
  if (!ready) return null;

  return (
    <>
      <OkeyGameTableScene isPreview />
    </>
  );
}
