import { Image } from "expo-image";
import {
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { getAvatarSource } from "@/constants/avatars";
import type { AvatarId } from "@/types/avatar";

type PlayerAvatarProps = {
  avatarId?: AvatarId;
  avatarUrl?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
};

export function PlayerAvatar({
  avatarId,
  avatarUrl,
  size = 40,
  style,
  imageStyle,
}: PlayerAvatarProps) {
  const source = avatarUrl ? { uri: avatarUrl } : getAvatarSource(avatarId);

  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: "hidden",
          backgroundColor: "rgba(255,255,255,0.08)",
        },
        style,
      ]}
    >
      <Image
        source={source}
        style={[{ width: size, height: size }, imageStyle]}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={0}
      />
    </View>
  );
}