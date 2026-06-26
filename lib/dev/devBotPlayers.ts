import type { AvatarId } from "@/constants/avatars";
import type { Player, TeamId } from "@/types/game";

/**
 * Temporary, local-only 2v2 test switch. Set false (or delete this module)
 * to restore the normal 2v2 matchmaking path immediately.
 */
export const ENABLE_DEV_2V2_BOT_TEST = true;

export type DevBotSeat = {
  id: string;
  name: string;
  avatarId: AvatarId;
  seat: Player["seat"];
  kind: Player["kind"];
  teamId: TeamId;
};

export const DEV_2V2_BOT_PLAYERS: readonly DevBotSeat[] = [
  {
    id: "dev-human",
    name: "You",
    avatarId: "avatar-2",
    seat: "bottom",
    kind: "human",
    teamId: "teamA",
  },
  {
    id: "dev-opponent-1",
    name: "Shikha",
    avatarId: "avatar-1",
    seat: "left",
    kind: "bot",
    teamId: "teamB",
  },
  {
    id: "dev-teammate",
    name: "KurdishPlayer",
    avatarId: "bot-avatar",
    seat: "top",
    kind: "bot",
    teamId: "teamA",
  },
  {
    id: "dev-opponent-2",
    name: "ballerina",
    avatarId: "avatar-4",
    seat: "right",
    kind: "bot",
    teamId: "teamB",
  },
];
