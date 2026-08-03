import type { ImageSourcePropType } from "react-native";

export type AvatarId =
  | "avatar-1"
  | "avatar-2"
  | "avatar-3"
  | "avatar-4"
  | "avatar-5"
  | "avatar-6"
  | "avatar-7"
  | "avatar-8"
  | "avatar-9"
  | "bot-avatar";

export const AVATAR_IDS: AvatarId[] = [
  "avatar-1",
  "avatar-2",
  "avatar-3",
  "avatar-4",
  "avatar-5",
  "avatar-6",
  "avatar-7",
  "avatar-8",
  "avatar-9",
  "bot-avatar",
];

export const AVATAR_SOURCE: Record<AvatarId, ImageSourcePropType> = {
  "avatar-1": require("@/assets/images/avatars/avatar-1.webp"),
  "avatar-2": require("@/assets/images/avatars/avatar-2.webp"),
  "avatar-3": require("@/assets/images/avatars/avatar-3.webp"),
  "avatar-4": require("@/assets/images/avatars/avatar-4.webp"),
  "avatar-5": require("@/assets/images/avatars/avatar-5.png"),
  "avatar-6": require("@/assets/images/avatars/avatar-6.png"),
  "avatar-7": require("@/assets/images/avatars/avatar-7.png"),
  "avatar-8": require("@/assets/images/avatars/avatar-8.png"),
  "avatar-9": require("@/assets/images/avatars/avatar-9.png"),

  "bot-avatar": require("@/assets/images/avatars/bot-avatar.webp"),
};

export function getAvatarSource(id?: AvatarId) {
  return AVATAR_SOURCE[id ?? "avatar-2"];
}
