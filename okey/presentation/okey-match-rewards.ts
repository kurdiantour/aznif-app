import type { OkeyMatchSettlement } from "../server/okey-authoritative";
import type { OkeyTeamId } from "../types/okey";

export type OkeyMatchPopupRewards = {
  currencyLabel: "Coin" | "MC";
  currencyDelta: number;
  gem: number;
  point: number;
};

export function mapOkeySettlementToPopupRewards(
  settlement: OkeyMatchSettlement | null | undefined,
  matchWinnerTeamId: OkeyTeamId | null,
  viewerTeamId: OkeyTeamId,
): OkeyMatchPopupRewards | null {
  if (!settlement || settlement.type !== "winner") return null;

  const viewerWon = matchWinnerTeamId === viewerTeamId;
  const entryFee = Number(settlement.entryFeePerPlayer ?? 0);
  const currencyDelta = viewerWon
    ? Number(settlement.payoutPerWinner ?? 0) - entryFee
    : -entryFee;

  return {
    currencyLabel: settlement.currency === "aznif" ? "MC" : "Coin",
    currencyDelta,
    gem: settlement.currency === "fun" ? Number(settlement.playerReward?.gemDelta ?? 0) : 0,
    point: settlement.currency === "fun" ? Number(settlement.playerReward?.pointDelta ?? 0) : 0,
  };
}
