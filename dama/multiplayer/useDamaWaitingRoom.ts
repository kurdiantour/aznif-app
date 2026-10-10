import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import {
  cancelDamaMatchmaking,
  getDamaWaitingStatus,
  joinDamaMatchmaking,
  type DamaWaitingStatus,
} from "@/dama/dama-adapter";

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object"
    && error !== null
    && "message" in error
    && typeof error.message === "string"
  ) {
    return error.message;
  }
  return "";
}

type UseDamaWaitingRoomOptions = {
  enabled: boolean;
  roomId?: string;
};

type WaitingRoomState = {
  roomId: string;
  status: DamaWaitingStatus | null;
  error: string | null;
};

export function useDamaWaitingRoom({
  enabled,
  roomId: initialRoomId = "",
}: UseDamaWaitingRoomOptions) {
  const router = useRouter();
  const requestedRoomId = String(initialRoomId ?? "");
  const [waitingRoomState, setWaitingRoomState] = useState<WaitingRoomState>({
    roomId: requestedRoomId,
    status: null,
    error: null,
  });
  const [cancelling, setCancelling] = useState(false);
  const status =
    waitingRoomState.roomId === requestedRoomId ? waitingRoomState.status : null;
  const error =
    waitingRoomState.roomId === requestedRoomId ? waitingRoomState.error : null;
  const roomIdRef = useRef(requestedRoomId);
  const statusRef = useRef<DamaWaitingStatus | null>(null);
  const cancellationStartedRef = useRef(false);
  const stopPollingRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    roomIdRef.current = requestedRoomId;
    statusRef.current = null;
    cancellationStartedRef.current = false;
    stopPollingRef.current = false;
    const updateState = (patch: Partial<WaitingRoomState>) => {
      setWaitingRoomState((current) => ({
        roomId: requestedRoomId,
        status: current.roomId === requestedRoomId ? current.status : null,
        error: current.roomId === requestedRoomId ? current.error : null,
        ...patch,
      }));
    };

    const refreshStatus = async () => {
      if (
        !active
        || inFlight
        || cancellationStartedRef.current
        || stopPollingRef.current
        || statusRef.current?.status === "active"
        || statusRef.current?.status === "finished"
      ) {
        return;
      }

      inFlight = true;
      let retryAfterMs = 1500;
      try {
        const nextStatus = roomIdRef.current
          ? await getDamaWaitingStatus(roomIdRef.current)
          : await joinDamaMatchmaking();

        if (!active || cancellationStartedRef.current) return;
        if (requestedRoomId && nextStatus.status === "none") {
          stopPollingRef.current = true;
          statusRef.current = null;
          updateState({
            status: null,
            error: "The Dama match is no longer available",
          });
          return;
        }
        const normalizedStatus =
          nextStatus.status === "none" || nextStatus.status === "cancelled"
            ? null
            : nextStatus;
        statusRef.current = normalizedStatus;
        roomIdRef.current = nextStatus.roomId ?? roomIdRef.current;
        updateState({ status: normalizedStatus, error: null });

        if (normalizedStatus?.status === "active" || normalizedStatus?.status === "finished") {
          return;
        }
      } catch (refreshError) {
        if (!active || cancellationStartedRef.current) return;
        retryAfterMs = 3000;
        updateState({
          error: getErrorMessage(refreshError) || "Unable to refresh Dama waiting room",
        });
        console.warn("Unable to refresh Dama waiting room", refreshError);
      } finally {
        inFlight = false;
        if (
          active
          && !cancellationStartedRef.current
          && !stopPollingRef.current
          && statusRef.current?.status !== "active"
          && statusRef.current?.status !== "finished"
        ) {
          timer = setTimeout(() => { void refreshStatus(); }, retryAfterMs);
        }
      }
    };

    void refreshStatus();
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        if (timer) clearTimeout(timer);
        timer = null;
        void refreshStatus();
      }
    });

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      appStateSubscription.remove();
    };
  }, [enabled, requestedRoomId]);

  const handleCancel = useCallback(async () => {
    if (
      cancelling
      || statusRef.current?.status !== "searching"
      || cancellationStartedRef.current
    ) {
      return;
    }

    cancellationStartedRef.current = true;
    setCancelling(true);
    try {
      await cancelDamaMatchmaking();
      router.replace("/(tabs)/play");
    } catch (cancelError) {
      cancellationStartedRef.current = false;
      setWaitingRoomState((current) => ({
        roomId: requestedRoomId,
        status: current.roomId === requestedRoomId ? current.status : null,
        error: getErrorMessage(cancelError) || "Unable to leave Dama matchmaking",
      }));
      console.warn("Failed to leave Dama matchmaking", cancelError);
    } finally {
      setCancelling(false);
    }
  }, [cancelling, requestedRoomId, router]);

  const currentRoomId = status?.roomId ?? requestedRoomId;
  const gameplayReady =
    Boolean(currentRoomId)
    && (status?.status === "active" || status?.status === "finished");
  const isWaiting =
    enabled
    && status !== null
    && status.status !== "active"
    && status.status !== "finished";

  return {
    status,
    error,
    cancelling,
    currentRoomId,
    gameplayReady,
    isWaiting,
    canCancel: status?.status === "searching" && !cancelling,
    handleCancel,
  };
}
