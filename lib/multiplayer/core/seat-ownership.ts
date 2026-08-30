export type SeatControllerKind = "human" | "bot";
export type TakeoverReason = "manual_leave" | "timeout";

export type SeatOwnership = {
  seatId: string;
  ownerPlayerId: string;
  controller: SeatControllerKind;
};

export type SeatOwnershipTransition = {
  seatId: string;
  ownerPlayerId: string;
  from: "human";
  to: "bot";
  reason: TakeoverReason;
};

export function projectSeatOwnership(input: {
  seatId: string;
  ownerPlayerId: string;
  controlledByBot: boolean;
}): SeatOwnership {
  return {
    seatId: input.seatId,
    ownerPlayerId: input.ownerPlayerId,
    controller: input.controlledByBot ? "bot" : "human",
  };
}

export function createBotTakeoverTransition(
  ownership: SeatOwnership,
  reason: TakeoverReason,
): SeatOwnershipTransition | null {
  if (ownership.controller === "bot") return null;
  return { ...ownership, from: "human", to: "bot", reason };
}
