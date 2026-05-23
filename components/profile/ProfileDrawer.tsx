import { PlayerAvatar } from '@/components/player/PlayerAvatar';
import { AVATAR_IDS, type AvatarId } from '@/constants/avatars';
import { useProfile } from '@/lib/profile';
import { signOut } from '@/lib/supabaseAuth';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

type ProfileDrawerProps = {
  visible: boolean;
  onClose: () => void;
};

const SCREEN_WIDTH = Dimensions.get('window').width;
const DRAWER_WIDTH = Math.min(282, SCREEN_WIDTH * 0.76);

export function ProfileDrawer({ visible, onClose }: ProfileDrawerProps) {
  const router = useRouter();
  const { profile, updateProfile } = useProfile();

  const [selectedAvatarId, setSelectedAvatarId] = useState<AvatarId | null>(null);
  const [isAvatarPickerOpen, setIsAvatarPickerOpen] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [draftName, setDraftName] = useState('');

  const slideX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const nameInputRef = useRef<TextInput>(null);

  useEffect(() => {
    setSelectedAvatarId(profile?.avatarId ?? null);
  }, [profile?.avatarId]);

  useEffect(() => {
    setDraftName(profile?.displayName ?? 'Player');
  }, [profile?.displayName]);

  const displayName = profile?.displayName ?? 'Player';
  const activeAvatarId = selectedAvatarId ?? profile?.avatarId;

  async function handleSelectAvatar(avatarId: AvatarId) {
    setSelectedAvatarId(avatarId);

    try {
      await updateProfile({ avatarId });
      setIsAvatarPickerOpen(false);
    } catch {
      setSelectedAvatarId(profile?.avatarId ?? null);
    }
  }

  function startEditingName() {
    setDraftName(displayName);
    setIsEditingName(true);

    requestAnimationFrame(() => {
      nameInputRef.current?.focus();
    });
  }

  async function finishEditingName() {
    const trimmed = draftName.trim();

    setIsEditingName(false);

    if (!trimmed || trimmed === displayName) {
      setDraftName(displayName);
      return;
    }

    try {
      await updateProfile({ displayName: trimmed });
    } catch {
      setDraftName(displayName);
    }
  }

  async function handleLogout() {
    try {
      await signOut();
      closeDrawer();

      requestAnimationFrame(() => {
        router.replace('/login');
      });
    } catch {
      // ignore logout errors
    }
  }

  useEffect(() => {
    if (!visible) {
      return;
    }

    slideX.setValue(-DRAWER_WIDTH);
    fade.setValue(0);

    Animated.parallel([
      Animated.timing(slideX, {
        toValue: 0,
        duration: 190,
        useNativeDriver: true,
      }),
      Animated.timing(fade, {
        toValue: 1,
        duration: 140,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, slideX, fade]);

  function closeDrawer() {
    setIsAvatarPickerOpen(false);
    setIsEditingName(false);

    Animated.parallel([
      Animated.timing(slideX, {
        toValue: -DRAWER_WIDTH,
        duration: 160,
        useNativeDriver: true,
      }),
      Animated.timing(fade, {
        toValue: 0,
        duration: 120,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onClose();
    });
  }

  if (!visible) {
    return null;
  }

  return (
    <View style={styles.overlayRoot} pointerEvents="box-none">
      <Animated.View style={[styles.backdrop, { opacity: fade }]}>
        <Pressable style={styles.backdropPressable} onPress={closeDrawer} />
      </Animated.View>

      <Animated.View
        style={[
          styles.drawer,
          {
            width: DRAWER_WIDTH,
            transform: [{ translateX: slideX }],
          },
        ]}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          bounces={false}
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.avatarWrap}>
            <View style={styles.avatarRing}>
              <View style={styles.avatarInner}>
                <PlayerAvatar avatarId={activeAvatarId} size={80} style={styles.profileAvatar} />
              </View>
            </View>

            <Pressable style={styles.uploadButton} onPress={() => setIsAvatarPickerOpen(true)}>
              <Text style={styles.uploadText}>⇧</Text>
            </Pressable>
          </View>

          <View style={styles.nameRow}>
            {isEditingName ? (
              <TextInput
                ref={nameInputRef}
                value={draftName}
                onChangeText={setDraftName}
                onBlur={() => void finishEditingName()}
                onSubmitEditing={() => void finishEditingName()}
                returnKeyType="done"
                placeholder="Player"
                placeholderTextColor="#7f8fb2"
                style={styles.nameInput}
                maxLength={18}
                selectTextOnFocus
              />
            ) : (
              <>
                <Text style={styles.name} numberOfLines={1}>
                  {displayName}
                </Text>

                <Pressable style={styles.editNameButton} onPress={startEditingName}>
                  <Text style={styles.editNameText}>✎</Text>
                </Pressable>
              </>
            )}
          </View>

          <Pressable style={styles.logoutButton} onPress={() => void handleLogout()}>
            <Text style={styles.logoutButtonText}>Logout</Text>
          </Pressable>
        </ScrollView>
      </Animated.View>

      {isAvatarPickerOpen && (
        <View style={styles.avatarPickerOverlay}>
          <Pressable
            style={styles.avatarPickerBackdrop}
            onPress={() => setIsAvatarPickerOpen(false)}
          />

          <View style={styles.avatarPickerCard}>
            <Text style={styles.avatarPickerTitle}>Choose Avatar</Text>
            <Text style={styles.avatarPickerSubtitle}>Select your profile look</Text>

            <View style={styles.avatarOptions}>
              {AVATAR_IDS.map((avatarId) => {
                const active = activeAvatarId === avatarId;

                return (
                  <Pressable
                    key={avatarId}
                    style={[styles.avatarOption, active && styles.avatarOptionSelected]}
                    onPress={() => void handleSelectAvatar(avatarId)}
                  >
                    <PlayerAvatar avatarId={avatarId} size={58} />
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              style={styles.avatarPickerClose}
              onPress={() => setIsAvatarPickerOpen(false)}
            >
              <Text style={styles.avatarPickerCloseText}>Close</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlayRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
    elevation: 999,
    alignItems: 'flex-start',
  },

  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },

  backdropPressable: {
    flex: 1,
  },

  drawer: {
    height: '100%',
    backgroundColor: '#070613',
    borderRightWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.32)',
    paddingHorizontal: 14,
    elevation: 1000,
  },

  scrollContent: {
    paddingTop: 26,
    paddingBottom: 34,
  },

  avatarWrap: {
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },

  avatarRing: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 3,
    borderColor: '#9b5cff',
    backgroundColor: 'rgba(91, 41, 154, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  avatarInner: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#171022',
    alignItems: 'center',
    justifyContent: 'center',
  },

  profileAvatar: {
    borderRadius: 40,
  },

  uploadButton: {
    position: 'absolute',
    right: 78,
    bottom: 0,
    width: 29,
    height: 29,
    borderRadius: 15,
    backgroundColor: '#35106f',
    borderWidth: 1,
    borderColor: '#8b5cf6',
    alignItems: 'center',
    justifyContent: 'center',
  },

  uploadText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
    marginTop: -1,
  },

  nameRow: {
    marginTop: 12,
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },

  name: {
    maxWidth: 176,
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },

  editNameButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  editNameText: {
    color: '#c4b5fd',
    fontSize: 12,
    fontWeight: '900',
  },

  nameInput: {
    width: 190,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.45)',
    color: '#ffffff',
    paddingHorizontal: 10,
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },

  logoutButton: {
    marginTop: 22,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  logoutButtonText: {
    color: '#ff8b8b',
    fontSize: 13,
    fontWeight: '900',
  },

  avatarPickerOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1001,
    elevation: 1001,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },

  avatarPickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.58)',
  },

  avatarPickerCard: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.45)',
    backgroundColor: '#0b0718',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
    alignItems: 'center',
  },

  avatarPickerTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
  },

  avatarPickerSubtitle: {
    marginTop: 4,
    color: '#9ca3ff',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },

  avatarOptions: {
    width: '100%',
    marginTop: 18,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
  },

  avatarOption: {
    width: 66,
    height: 66,
    borderRadius: 50,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },

  avatarOptionSelected: {
    borderColor: '#14f1c1',
    backgroundColor: 'rgba(20, 241, 193, 0.14)',
  },

  avatarPickerClose: {
    marginTop: 18,
    height: 38,
    minWidth: 112,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },

  avatarPickerCloseText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
});