import { Image, View, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native';

import { getAvatarSource, type AvatarId } from '@/constants/avatars';

type PlayerAvatarProps = {
  avatarId?: AvatarId;
  size?: number;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
};

export function PlayerAvatar({
  avatarId,
  size = 40,
  style,
  imageStyle,
}: PlayerAvatarProps) {
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: 'hidden',
          backgroundColor: 'rgba(255,255,255,0.08)',
        },
        style,
      ]}
    >
      <Image
        source={getAvatarSource(avatarId)}
        style={[{ width: size, height: size }, imageStyle]}
        resizeMode="cover"
      />
    </View>
  );
}
