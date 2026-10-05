import React, { useEffect } from "react";
import { AppState } from "react-native";
import { useRouter, useSegments } from "expo-router";

import { useAuthState } from "../auth-state";
import {
  recordPushOpen,
  registerPushDevice,
  resumeDeviceRegistration,
} from "./devices";
import {
  clearPushResponse,
  lastPushResponse,
  subscribeToPushResponses,
  subscribeToTokenChanges,
} from "./platform";
import {
  queuePushRoute,
  validPushRoute,
} from "./routes";

const handlingResponses = new Set<string>();

export function NotificationProvider({
  children,
}: React.PropsWithChildren) {
  const { userId, authReady } = useAuthState();

  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (!authReady || !userId) return;

    let live = true;

    const handle = async (
      response: import("expo-notifications").NotificationResponse,
    ): Promise<boolean> => {
      if (
        response.actionIdentifier !==
        "expo.modules.notifications.actions.DEFAULT"
      ) {
        return false;
      }

      const payload =
        response.notification.request.content.data;

      const responseId =
        response.notification.request.identifier;

      if (handlingResponses.has(responseId)) {
        return true;
      }

      const campaignId = payload?.campaign_id;
      const deviceId = payload?.device_id;

      if (
        typeof campaignId !== "string" ||
        typeof deviceId !== "string"
      ) {
        return false;
      }

      handlingResponses.add(responseId);

      try {
        const valid = await recordPushOpen(
          userId,
          campaignId,
          deviceId,
        );

        if (!live) {
          handlingResponses.delete(responseId);
          return false;
        }

        if (!valid) {
          handlingResponses.delete(responseId);
          return false;
        }

        if (!validPushRoute(payload?.deep_link)) {
          return true;
        }

        if (
          (segments as readonly string[]).length === 0 ||
          (segments as readonly string[])[0] === "index"
        ) {
          queuePushRoute(payload.deep_link);
        } else {
          router.push(payload.deep_link as never);
        }

        return true;
      } catch (error) {
        handlingResponses.delete(responseId);

        console.warn(
          "Push open recording failed",
          error,
        );

        return false;
      }
    };

    const unsubscribe =
      subscribeToPushResponses((response) => {
        void handle(response);
      });

    void lastPushResponse()
      .then(async (response) => {
        if (
          response &&
          live &&
          (await handle(response))
        ) {
          await clearPushResponse();
        }
      })
      .catch((error) =>
        console.warn(
          "Push response recovery failed",
          error,
        ),
      );

    return () => {
      live = false;
      unsubscribe();
    };
  }, [
    authReady,
    userId,
    router,
    segments,
  ]);

  useEffect(() => {
    if (!authReady || !userId) return;

    resumeDeviceRegistration();

    const sync = (
      requestPermission = false,
      devicePushToken?: import("expo-notifications").DevicePushToken,
    ) => {
      void registerPushDevice(
        userId,
        requestPermission,
        devicePushToken,
      ).catch((error) => {
        console.warn(
          "Push registration failed",
          error,
        );
      });
    };

    sync(true);

    const state =
      AppState.addEventListener(
        "change",
        (next) => {
          if (next === "active") {
            sync();
          }
        },
      );

    const token =
      subscribeToTokenChanges(
        (devicePushToken) =>
          sync(
            false,
            devicePushToken,
          ),
      );

    return () => {
      state.remove();
      token();
    };
  }, [
    userId,
    authReady,
  ]);

  return <>{children}</>;
}