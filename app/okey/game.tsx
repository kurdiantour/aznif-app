import OkeyGameTableScene from "@/okey/scenes/OkeyGameTableScene";
import { useGameSystemGestureProtection } from "@/hooks/useGameSystemGestureProtection";

export default function OkeyGameScreen() {
  useGameSystemGestureProtection();
  return <OkeyGameTableScene />;
}
