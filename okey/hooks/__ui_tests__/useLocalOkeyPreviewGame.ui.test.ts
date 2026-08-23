import { createInitialOkeyGame } from "../../engine/okey-engine";
import { handSeatToBot } from "../../engine/okey-bot-policy";
import {
  canCommitLocalPreviewBotTurn,
  getNextLocalPreviewDealerIndex,
} from "../useLocalOkeyPreviewGame";

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
describe("local Okey Preview bot sequencing", () => {
  test("commits only the expected current Bot after presentation completes", () => {
    const initial = createInitialOkeyGame(0);
    const botState = handSeatToBot(
      initial,
      initial.currentPlayerIndex,
      "normal",
    );
    const currentBot = botState.players[botState.currentPlayerIndex];

    expect(canCommitLocalPreviewBotTurn(botState, currentBot.id, true)).toBe(false);
    expect(canCommitLocalPreviewBotTurn(botState, "another-bot", false)).toBe(false);
    expect(canCommitLocalPreviewBotTurn(botState, currentBot.id, false)).toBe(true);
  });
});

