import type { AvatarId } from "@/constants/avatars";

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
  points: number;
  createdAt: string;
  updatedAt: string;
};

export type ProfileUpdate = Partial<
  Pick<Profile, "displayName" | "avatarId" | "avatarUrl" | "bio" | "status">
>;
