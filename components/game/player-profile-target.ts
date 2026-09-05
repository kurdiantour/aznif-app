import type { AvatarId } from "@/constants/avatars";

/** Minimal shared input consumed by the multiplayer profile popup. */
export type PlayerProfileTarget = {
  id: string;
  name: string;
  avatarId?: AvatarId;
};