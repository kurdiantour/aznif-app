import { Redirect } from "expo-router";

import { useLocalOkeyPreviewGame } from "@/okey/hooks/useLocalOkeyPreviewGame";
import OkeyGameTableScene from "@/okey/scenes/OkeyGameTableScene";

export default function OkeyPreviewScreen() {
  const controller = useLocalOkeyPreviewGame();

  if (!__DEV__) {
    return <Redirect href="/okey" />;
  }

  return <OkeyGameTableScene controller={controller} preview />;
}
