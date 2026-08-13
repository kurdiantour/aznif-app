import { createInitialOkeyGame } from "../../engine/okey-engine";
import { getNextLocalPreviewDealerIndex } from "../useLocalOkeyPreviewGame";

describe("local Okey preview cycle-limit dealer", () => {
  test.each([0, 1, 2, 3])(
    "preserves dealer %i when the tile cycle ends without a winner",
    (dealerIndex) => {
      const roundState = {
        ...createInitialOkeyGame(dealerIndex),
        phase: "finished" as const,
        winnerId: null,
        endReason: "tile-cycle-limit" as const,
        turnMessage: { code: "tile-cycle-limit" as const },
      };

      expect(getNextLocalPreviewDealerIndex(roundState)).toBe(dealerIndex);
    },
  );
});