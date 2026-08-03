import type { OkeyTurnMessage } from "@/okey/types/okey";

export function translateOkeyTurnMessage(message: OkeyTurnMessage): string {
  switch (message.code) {
    case "discard-tile": return `${message.playerName}: یەک بەرد فڕێ بدە.`;
    case "draw-tile": return `${message.playerName}: لە کۆگا یان بەردە فڕێدراوەکان بەردێک هەڵبگرە.`;
    case "set-locked": return `${message.playerName}: دەستەکە داخرا.`;
    case "joker-released": return `${message.playerName}: جۆکەرەکە ئازاد کرا.`;
    case "tile-added": return `${message.playerName}: بەردێک زیاد کرا بۆ مەڵدێک.`;
    case "tile-cycle-limit": return "سنووری سووڕی کۆگای بەرد تەواو بوو.";
    case "draw-pile-reshuffled": return `کۆگای بەرد تێکەڵ کرایەوە (${message.current}/${message.maximum}).`;
    case "winner": return `${message.playerName} بردییەوە.`;
  }
}