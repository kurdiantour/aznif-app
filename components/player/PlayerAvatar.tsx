import { Image } from "expo-image";
import {
  Text,
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
  fallbackLabel?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
};

export function PlayerAvatar({
  avatarId,
  avatarUrl,
  fallbackLabel,
  size = 40,
  style,
  imageStyle,
}: PlayerAvatarProps) {
  const source = avatarUrl ? { uri: avatarUrl } : getAvatarSource(avatarId);
  const initial = fallbackLabel?.trim().slice(0, 1).toLocaleUpperCase();
  const hue = [...(fallbackLabel ?? "")].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) % 360, 0);

  if (!avatarUrl && !avatarId && initial) {
    return (
      <View
        accessibilityLabel={`${fallbackLabel} avatar`}
        style={[{ width: size, height: size, borderRadius: size / 2, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: `hsl(${hue}, 48%, 37%)`, borderWidth: 2, borderColor: "rgba(255,255,255,0.7)" }, style]}
      >
        <Text style={{ color: "#fff7e8", fontWeight: "900", fontSize: size * 0.48 }}>{initial}</Text>
      </View>
    );
  }

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
