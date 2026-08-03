import type { OkeyGameState, OkeyPlayer } from "../types/okey.ts";

export type OkeyBotDifficulty = "easy" | "normal" | "hard";

export type OkeyBotProfile = {
  difficulty: OkeyBotDifficulty;
  thinkDelayMs: number;
  minimumDiscardGain: number;
  discardRiskWeight: number;
  maximumSpendActions: number;
  candidateWindow: number;
};

export const OKEY_BOT_PROFILES: Readonly<Record<OkeyBotDifficulty, OkeyBotProfile>> = {
  easy: { difficulty: "easy", thinkDelayMs: 900, minimumDiscardGain: 12, discardRiskWeight: 0.45, maximumSpendActions: 6, candidateWindow: 3 },
  normal: { difficulty: "normal", thinkDelayMs: 700, minimumDiscardGain: 8, discardRiskWeight: 0.75, maximumSpendActions: 12, candidateWindow: 2 },
  hard: { difficulty: "hard", thinkDelayMs: 500, minimumDiscardGain: 4, discardRiskWeight: 1, maximumSpendActions: 16, candidateWindow: 1 },
};

export function getOkeyBotProfile(difficulty: OkeyBotDifficulty = "normal") { return OKEY_BOT_PROFILES[difficulty]; }
export function getOkeyBotDifficulty(player: OkeyPlayer): OkeyBotDifficulty { return player.botDifficulty ?? "normal"; }
export function isOkeyBotControlled(player: OkeyPlayer | undefined): boolean { return !!player && (player.kind === "bot" || player.controlledByBot === true); }

export function handSeatToBot(state: OkeyGameState, playerIndex: number, difficulty: OkeyBotDifficulty = "normal"): OkeyGameState {
  const player = state.players[playerIndex];
  if (!player || player.eliminated || player.controlledByBot) return state;
  return { ...state, players: state.players.map((entry, index) => index === playerIndex ? { ...entry, controlledByBot: true, botDifficulty: difficulty } : entry) };
}

export function returnSeatToPlayer(state: OkeyGameState, playerIndex: number): OkeyGameState {
  const player = state.players[playerIndex];
  if (!player?.controlledByBot) return state;
  return { ...state, players: state.players.map((entry, index) => index === playerIndex ? { ...entry, controlledByBot: false } : entry) };
}

export function createSeededOkeyBotRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x1_0000_0000;
  };
}
