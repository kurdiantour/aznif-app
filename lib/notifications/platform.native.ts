import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";

// Keep the Expo Go guard: loading expo-notifications there can crash startup.
const available = Constants.appOwnership !== "expo";
type NotificationsModule = typeof import("expo-notifications");
let Notifications: NotificationsModule | null = null;
if (available) {
  Notifications = require("expo-notifications") as NotificationsModule;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}
// Tapping uses the OS default app open/resume. Do not register response listeners.
export function subscribeToTokenChanges(listener: () => void) {
  if (!Notifications) return () => {};
  const subscription = Notifications.addPushTokenListener(listener);
  return () => subscription.remove();
}

export async function obtainToken(
  requestPermission: boolean
): Promise<{ token: string | null; permission: string }> {
  if (!available || !Notifications || !Device.isDevice) {
    return {
      token: null,
      permission: "development_build_required",
    };
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("general", {
      name: "Aznif",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
    });
  }

  let permission = await Notifications.getPermissionsAsync();

  if (
    requestPermission &&
    permission.canAskAgain &&
    !permission.granted
  ) {
    permission = await Notifications.requestPermissionsAsync();
  }

  const granted =
    permission.granted ||
    permission.ios?.status ===
      Notifications.IosAuthorizationStatus.PROVISIONAL;

  if (!granted) {
    return {
      token: null,
      permission: permission.status,
    };
  }

  const projectId =
    Constants.easConfig?.projectId ??
    Constants.expoConfig?.extra?.eas?.projectId;

  if (!projectId) {
    throw new Error("EAS project ID is missing");
  }

  const token = await Notifications.getExpoPushTokenAsync({
    projectId,
  });

  return {
    token: token.data,
    permission: "granted",
  };
}