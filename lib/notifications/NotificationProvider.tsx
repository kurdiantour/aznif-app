import React, { useEffect } from "react";
import { AppState } from "react-native";
import { useProfile } from "../profile";
import { registerPushDevice, resumeDeviceRegistration } from "./devices";
import { subscribeToTokenChanges } from "./platform";

// Registration only. No tap listener, router, startup gate or notification UI.
export function NotificationProvider({ children }: React.PropsWithChildren) {
  const { session, authLoading } = useProfile();
  const userId = session?.user.id;
  useEffect(() => {
    if (authLoading || !userId) return;
    resumeDeviceRegistration();
    const sync = (requestPermission = false, devicePushToken?: import("expo-notifications").DevicePushToken) => {
      void registerPushDevice(userId, requestPermission, devicePushToken).catch(error => {
        console.warn("Push registration failed", error);
      });
    };
    sync(true);
    const state = AppState.addEventListener("change", next => {
      if (next === "active") sync();
    });
    const token = subscribeToTokenChanges(devicePushToken => sync(false, devicePushToken));
    return () => { state.remove(); token(); };
  }, [userId, authLoading]);
  return <>{children}</>;
}
