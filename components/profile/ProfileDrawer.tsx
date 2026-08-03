import { AvatarPickerModal } from "@/components/player/AvatarPickerModal";
import { LogoutConfirmPopup } from "@/components/profile/LogoutConfirmPopup";
import { PlayerAvatar } from "@/components/player/PlayerAvatar";
import type { AvatarId } from "@/constants/avatars";
import { useProfile } from "@/lib/profile";
import {
  calculateLevelFromPoints,
  getRankTitleFromPoints,
  POINTS_PER_LEVEL,
} from "@/lib/progression";
import { signOut } from "@/lib/supabaseAuth";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type ProfileDrawerProps = {
  visible: boolean;
  onClose: () => void;
};

const SCREEN_WIDTH = Dimensions.get("window").width;
const DRAWER_WIDTH = Math.min(282, SCREEN_WIDTH * 0.66);

export function ProfileDrawer({ visible, onClose }: ProfileDrawerProps) {
  const router = useRouter();
  const { profile, updateProfile } = useProfile();

  const [selectedAvatarId, setSelectedAvatarId] = useState<AvatarId | null>(
    null,
  );
  const [isAvatarPickerOpen, setIsAvatarPickerOpen] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [copied, setCopied] = useState(false);
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);

  const slideX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const nameInputRef = useRef<TextInput>(null);

  useEffect(() => {
    setSelectedAvatarId(profile?.avatarId ?? null);
  }, [profile?.avatarId]);

  useEffect(() => {
    setDraftName(profile?.displayName ?? "Player");
  }, [profile?.displayName]);

  const displayName = profile?.displayName ?? "Player";
  const activeAvatarId = selectedAvatarId ?? profile?.avatarId;
  const rankTitle = getRankTitleFromPoints(profile?.points);
  const points = Math.max(profile?.points ?? 0, 0);
  const level = calculateLevelFromPoints(points);
  const pointsInLevel = points % POINTS_PER_LEVEL;
  const progress = pointsInLevel / POINTS_PER_LEVEL;

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

  async function performLogout() {
    try {
      await signOut();
      closeDrawer();

      requestAnimationFrame(() => {
        router.replace("/login");
      });
    } catch {
      // ignore logout errors
    }
  }

  function handleLogout() {
    setIsLogoutConfirmOpen(true);
  }

  async function handleCopyPlayerId() {
    if (!profile?.playerId) return;

    await Clipboard.setStringAsync(profile.playerId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleOpenTelegram() {
    await Linking.openURL("https://t.me/aznifcommunity");
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
                <PlayerAvatar
                  avatarId={activeAvatarId}
                  avatarUrl={profile?.avatarUrl}
                  size={80}
                  style={styles.profileAvatar}
                />
              </View>
            </View>

            <Pressable
              style={styles.uploadButton}
              onPress={() => setIsAvatarPickerOpen(true)}
            >
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

                <Pressable
                  style={styles.editNameButton}
                  onPress={startEditingName}
                >
                  <Text style={styles.editNameText}>✎</Text>
                </Pressable>
              </>
            )}
          </View>

          <Text style={styles.level}>{rankTitle}</Text>

          <View style={styles.playerIdRow}>
            <View style={styles.playerIdTextWrap}>
              <Text style={styles.playerIdLabel}>ناسنامەی یاریزان</Text>
              <Text style={styles.playerId}>
                {profile?.playerId ?? "بەردەست نییە"}
              </Text>
            </View>
            <Pressable
              style={styles.copyButton}
              disabled={!profile?.playerId}
              onPress={() => void handleCopyPlayerId()}
            >
              <Ionicons
                name={copied ? "checkmark" : "copy-outline"}
                size={16}
                color="#c4b5fd"
              />
            </Pressable>
          </View>

          <View style={styles.progressCard}>
            <View style={styles.progressHeading}>
              <Text style={styles.pointsText}>{points} Points</Text>
              <View style={styles.levelPill}>
                <Text style={styles.levelPillText}>پلەی {level}</Text>
              </View>
            </View>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${Math.max(progress * 100, 4)}%` },
                ]}
              />
            </View>
          </View>

<Pressable
  style={styles.actionButton}
  onPress={() => void handleOpenTelegram()}
>
  <View style={styles.actionIcon}>
    <Ionicons name="paper-plane-outline" size={16} color="#c4b5fd" />
  </View>
  <Text style={styles.actionText}>بەشداری تیلیگراممان بە</Text>
  <Ionicons name="chevron-back" size={16} color="#a99bd8" />
</Pressable>

          <Pressable
            style={[styles.actionButton, styles.logoutButton]}
            onPress={handleLogout}
          >
            <View style={[styles.actionIcon, styles.logoutIcon]}>
              <Ionicons name="log-out-outline" size={16} color="#fca5a5" />
            </View>
            <Text style={styles.logoutButtonText}>دەرچوون</Text>
            <Ionicons name="chevron-back" size={16} color="#a99bd8" />
          </Pressable>
        </ScrollView>
      </Animated.View>

      <AvatarPickerModal
        visible={isAvatarPickerOpen}
        selectedAvatarId={activeAvatarId}
        onSelect={(avatarId) => void handleSelectAvatar(avatarId)}
        onClose={() => setIsAvatarPickerOpen(false)}
      />

      <LogoutConfirmPopup
        visible={isLogoutConfirmOpen}
        onCancel={() => setIsLogoutConfirmOpen(false)}
        onConfirm={() => void performLogout()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overlayRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
    elevation: 999,
    alignItems: "flex-start",
  },

  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.58)",
  },

  backdropPressable: {
    flex: 1,
  },

  drawer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    height: "100%",
    backgroundColor: "#040a19",
    borderRightWidth: 1,
    borderColor: "rgba(248, 215, 116, 0.24)",
    paddingHorizontal: 12,
    direction: "rtl",
    elevation: 1000,
  },

  scrollContent: {
    paddingTop: 26,
    paddingBottom: 34,
    direction: "rtl",
  },

  avatarWrap: {
    marginTop: 2,
    paddingVertical: 16,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(248, 215, 116, 0.18)",
    backgroundColor: "rgba(15, 23, 42, 0.66)",
    alignItems: "center",
    justifyContent: "center",
  },

  avatarRing: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 2,
    borderColor: "#f8d774",
    backgroundColor: "rgba(248, 215, 116, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },

  avatarInner: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
  },

  profileAvatar: {
    borderRadius: 40,
  },

  uploadButton: {
    position: "absolute",
    right: 78,
    bottom: 0,
    width: 29,
    height: 29,
    borderRadius: 6,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "rgba(248, 215, 116, 0.34)",
    alignItems: "center",
    justifyContent: "center",
  },

  uploadText: {
    color: "#ffffff",
    fontSize: 15,
    fontFamily: "SpedaBold",
    marginTop: -1,
  },

  nameRow: {
    marginTop: 12,
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },

  name: {
    maxWidth: 176,
    color: "#ffffff",
    fontSize: 16,
    fontFamily: "RobotoMedium",
    textAlign: "center",
  },

  editNameButton: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: "rgba(248, 215, 116, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(248, 215, 116, 0.24)",
    alignItems: "center",
    justifyContent: "center",
  },

  editNameText: {
    color: "#c4b5fd",
    fontSize: 12,
    fontFamily: "SpedaBold",
  },

  nameInput: {
    width: 190,
    height: 34,
    borderRadius: 6,
    backgroundColor: "rgba(15, 23, 42, 0.74)",
    borderWidth: 1,
    borderColor: "rgba(248, 215, 116, 0.28)",
    color: "#ffffff",
    paddingHorizontal: 10,
    fontSize: 15,
    fontFamily: "RobotoMedium",
    textAlign: "center",
  },

  level: {
    marginTop: 2,
    color: "#f8d774",
    fontSize: 12,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  playerIdRow: {
    marginTop: 20,
    minHeight: 56,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.18)",
    backgroundColor: "rgba(15, 23, 42, 0.66)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },

  playerId: {
    marginTop: 2,
    color: "#ffffff",
    fontSize: 13,
    fontFamily: "RobotoMedium",
    letterSpacing: 0.4,
    textAlign: "right",
    writingDirection: "rtl",
  },

  playerIdTextWrap: {
    flex: 1,
  },

  playerIdLabel: {
    color: "#b6c2d8",
    fontSize: 10,
    fontFamily: "SpedaBold",
    writingDirection: "rtl",
    textAlign: "right",
  },

  copyButton: {
    width: 32,
    height: 32,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(248, 215, 116, 0.34)",
    backgroundColor: "rgba(248, 215, 116, 0.1)",
    alignItems: "center",
    justifyContent: "center",
  },

  copyButtonText: {
    color: "#ffffff",
    fontSize: 10,
    fontFamily: "SpedaBold",
  },

  progressCard: {
    marginTop: 6,
    padding: 16,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(248, 215, 116, 0.18)",
    backgroundColor: "rgba(15, 23, 42, 0.66)",
  },

  progressHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pointsText: {
    color: "#fff",
    fontSize: 12,
    fontFamily: "RobotoMedium",
    writingDirection: "rtl",
    textAlign: "right",
  },
  levelPill: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 4,
    backgroundColor: "rgba(248, 215, 116, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(248, 215, 116, 0.24)",
  },
  levelPillText: {
    color: "#f8d774",
    fontSize: 11,
    fontFamily: "SpedaBold",
    writingDirection: "rtl",
    textAlign: "right",
  },
  progressTrack: {
    marginTop: 16,
    height: 8,
    borderRadius: 99,
    backgroundColor: "#020617",
    overflow: "hidden",
    alignItems: "flex-end",
  },
  progressFill: {
    height: "100%",
    borderRadius: 99,
    backgroundColor: "#f8d774",
  },
  actionButton: {
    marginTop: 6,
    minHeight: 50,
    paddingHorizontal: 14,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.16)",
    backgroundColor: "rgba(15, 23, 42, 0.66)",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  actionIcon: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: "rgba(248, 215, 116, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(248, 215, 116, 0.24)",
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: {
    flex: 1,
    color: "#fff",
    fontSize: 12,
    fontFamily: "SpedaBold",
    writingDirection: "rtl",
    textAlign: "right",
  },
  logoutIcon: {
    backgroundColor: "rgba(127, 29, 29, 0.22)",
    borderColor: "rgba(251,113,133,0.3)",
  },

  logoutButton: {
    borderColor: "rgba(251,113,133,0.24)",
    backgroundColor: "rgba(127, 29, 29, 0.12)",
  },

  logoutButtonText: {
    flex: 1,
    color: "#ff8b8b",
    fontSize: 12,
    fontFamily: "SpedaBold",
    writingDirection: "rtl",
    textAlign: "right",
  },
});
