import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { useProfile } from "@/lib/profile";
import { supabase } from "@/lib/supabase";
import { AVATAR_IDS, type AvatarId } from "@/types/avatar";

import { PlayerAvatar } from "./PlayerAvatar";

const PICKABLE_AVATAR_IDS = AVATAR_IDS.filter(
  (avatarId) => avatarId !== "bot-avatar",
);

const ALL_PICKER_ITEMS = ["upload", ...PICKABLE_AVATAR_IDS];

type AvatarPickerModalProps = {
  visible: boolean;
  selectedAvatarId?: AvatarId;
  onSelect: (avatarId: AvatarId) => void;
  onUploadAvatar?: (url: string) => Promise<void>;
  onClose: () => void;
};

export function AvatarPickerModal({
  visible,
  selectedAvatarId,
  onSelect,
  onUploadAvatar,
  onClose,
}: AvatarPickerModalProps) {
  const { width } = useWindowDimensions();
  const { profile } = useProfile();

  const [isUploading, setIsUploading] = useState(false);

  const optionSize = width < 430 ? 54 : 64;
  const avatarSize = optionSize - 12;

  async function handlePickImage() {
    if (!profile || !onUploadAvatar || isUploading) {
      return;
    }

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.5,
      });

      if (result.canceled || !result.assets[0]) {
        return;
      }

      setIsUploading(true);

      const asset = result.assets[0];
      const mimeType = asset.mimeType ?? "image/jpeg";

      const response = await fetch(asset.uri);
      const arrayBuffer = await response.arrayBuffer();

      const extensionFromFileName = asset.fileName
        ?.split(".")
        .pop()
        ?.toLowerCase();

      const extensionFromMimeType =
        mimeType === "image/png"
          ? "png"
          : mimeType === "image/webp"
            ? "webp"
            : mimeType === "image/heic"
              ? "heic"
              : mimeType === "image/heif"
                ? "heif"
                : "jpg";

      const fileExtension =
        extensionFromFileName &&
        /^[a-z0-9]+$/.test(extensionFromFileName)
          ? extensionFromFileName
          : extensionFromMimeType;

      const fileName = `${Date.now()}.${fileExtension}`;
      const filePath = `${profile.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, arrayBuffer, {
          contentType: mimeType,
          upsert: false,
        });

      if (uploadError) {
        throw uploadError;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("avatars").getPublicUrl(filePath);

      await onUploadAvatar(publicUrl);
    } catch (error) {
      console.warn("Upload failed:", error);
    } finally {
      setIsUploading(false);
    }
  }

  if (!visible) {
    return null;
  }

  return (
    <View style={styles.overlay}>
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        disabled={isUploading}
      />

      <View style={styles.card}>
        <Text style={styles.subtitle}>
          ڕووکارێک بۆ پرۆفایلەکەت دیاری بکە
        </Text>

        <View style={styles.options}>
          {ALL_PICKER_ITEMS.map((item) => {
            if (item === "upload") {
              return (
                <Pressable
                  key="upload"
                  style={[
                    styles.option,
                    {
                      width: optionSize,
                      height: optionSize,
                      borderRadius: optionSize / 2,
                    },
                  ]}
                  onPress={() => void handlePickImage()}
                  disabled={isUploading}
                >
                  {isUploading ? (
                    <ActivityIndicator color="#14f1c1" />
                  ) : (
                    <Ionicons
                      name="add"
                      size={32}
                      color="#9ca3ff"
                    />
                  )}
                </Pressable>
              );
            }

            const avatarId = item as AvatarId;
            const active = selectedAvatarId === avatarId;

            return (
              <Pressable
                key={avatarId}
                style={[
                  styles.option,
                  {
                    width: optionSize,
                    height: optionSize,
                    borderRadius: optionSize / 2,
                  },
                  active && styles.optionSelected,
                ]}
                onPress={() => onSelect(avatarId)}
                disabled={isUploading}
              >
                <PlayerAvatar
                  avatarId={avatarId}
                  size={avatarSize}
                />
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 1001,
    elevation: 1001,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },

  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0, 0, 0, 0.62)",
  },

  card: {
    width: "100%",
    maxWidth: 460,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(139, 92, 246, 0.55)",
    backgroundColor: "#0b0718",
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 20,
    alignItems: "center",
  },

  subtitle: {
    marginTop: 4,
    color: "#9ca3ff",
    fontSize: 13,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  options: {
    width: "100%",
    marginTop: 22,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 14,
  },

  option: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },

  optionSelected: {
    borderWidth: 2,
    borderColor: "#14f1c1",
    backgroundColor: "rgba(20, 241, 193, 0.14)",
  },
});