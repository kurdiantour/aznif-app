import type { ImageSourcePropType } from 'react-native';

export type AvatarId =
  | 'avatar-1'
  | 'avatar-2'
  | 'avatar-3'
  | 'avatar-4'
  | 'bot-avatar';

export const AVATAR_IDS: AvatarId[] = [
  'avatar-1',
  'avatar-2',
  'avatar-3',
  'avatar-4',
  'bot-avatar'
];

export const AVATAR_SOURCE: Record<AvatarId, ImageSourcePropType> = {
  'avatar-1': require('@/assets/images/avatars/avatar-1.webp'),
  'avatar-2': require('@/assets/images/avatars/avatar-2.webp'),
  'avatar-3': require('@/assets/images/avatars/avatar-3.webp'),
  'avatar-4': require('@/assets/images/avatars/avatar-4.webp'),

  'bot-avatar': require('@/assets/images/avatars/bot-avatar.webp'),
};

export function getAvatarSource(id?: AvatarId) {
  return AVATAR_SOURCE[id ?? 'avatar-2'];
}