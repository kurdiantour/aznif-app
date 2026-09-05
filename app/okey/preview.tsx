import { Redirect } from "expo-router";

import { OkeyLocalPreviewGameTableScene } from "@/okey/scenes/OkeyGameTableScene";

export default function OkeyPreviewScreen() {
  if (!__DEV__) {
    return <Redirect href="/(tabs)/play" />;
  }

  return <OkeyLocalPreviewGameTableScene />;
}
