import type { AvatarId } from "@/types/avatar";

/** Minimal shared input consumed by the multiplayer profile popup. */
export type PlayerProfileTarget = {
  id: string;
  name: string;
  avatarId?: AvatarId;
};