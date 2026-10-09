import type { AvatarId } from "./avatar.ts";
export type ProfileStatus = "active" | "offline" | "banned";

export type Profile = {
  id: string;
  playerId: string;
  username: string;
  displayName: string;
  avatarId?: AvatarId;
  avatarUrl?: string;
  email?: string;
  bio?: string;
  status: ProfileStatus;
  level: number;
  coin: number;
  points: number;
  gems: number;
  gamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  isAdmin?: boolean;
  isFinanceAdmin?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProfileUpdate = Partial<
  Pick<Profile, "displayName" | "avatarId" | "avatarUrl" | "bio" | "status">
>;

