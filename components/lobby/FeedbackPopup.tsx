import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { useAuthState } from "@/lib/auth-state";
import { supabase } from "@/lib/supabase";

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function FeedbackPopup({ visible, onClose }: Props) {
  const [mounted, setMounted] = useState(visible);
  const [progress] = useState(() => new Animated.Value(visible ? 1 : 0));
  const closing = useRef(false);

  const { userId } = useAuthState();
  const [message, setMessage] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const close = useCallback(() => {
    if (closing.current) return;

    closing.current = true;

    Animated.timing(progress, {
      toValue: 0,
      duration: 190,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;

      setMounted(false);
      closing.current = false;
      setMessage("");
      setImages([]);
      setIsSubmitting(false);
      onClose();
    });
  }, [onClose, progress]);

  useEffect(() => {
    if (!visible) {
      if (mounted && !closing.current) {
        close();
      }
      return;
    }

    if (mounted && !closing.current) {
      return;
    }

    closing.current = false;
    setMounted(true);
    setIsSubmitting(false);
    setMessage("");
    setImages([]);

    progress.stopAnimation();
    progress.setValue(0);

    Animated.timing(progress, {
      toValue: 1,
      duration: 310,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [close, mounted, progress, visible]);

  async function handlePickImage() {
    if (images.length >= 3 || isSubmitting) return;

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.5,
      });

      if (result.canceled || !result.assets[0]) {
        return;
      }

      setImages((prev) => [...prev, result.assets[0].uri]);
    } catch (error) {
      console.warn("Failed to pick image:", error);
    }
  }

  function handleRemoveImage(index: number) {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    if (!userId || isSubmitting) return;
    const trimmedMessage = message.trim();
    if (!trimmedMessage) return;

    setIsSubmitting(true);
    const uploadedPaths: string[] = [];

    try {
      // 1. Upload Images (if any)
      for (const uri of images) {
        const response = await fetch(uri);
        const arrayBuffer = await response.arrayBuffer();
        const extension = uri.split(".").pop()?.toLowerCase() || "jpg";
        const mimeType =
          extension === "png"
            ? "image/png"
            : extension === "webp"
              ? "image/webp"
              : "image/jpeg";
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${extension}`;
        const filePath = `${userId}/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from("feedback_images")
          .upload(filePath, arrayBuffer, {
            contentType: mimeType,
            upsert: false,
          });

        if (uploadError) throw uploadError;
        uploadedPaths.push(filePath);
      }

      // 2. Insert into Database
      const { error: dbError } = await supabase.from("feedback").insert({
        user_id: userId,
        message: trimmedMessage,
        image_paths: uploadedPaths,
      });

      if (dbError) throw dbError;

      // 3. Success -> reset and close
      setMessage("");
      setImages([]);
      close();
    } catch (error) {
      console.warn("Failed to submit feedback:", error);

      // Cleanup orphans
      if (uploadedPaths.length > 0) {
        await supabase.storage
          .from("feedback_images")
          .remove(uploadedPaths)
          .catch((cleanupError) => {
            console.warn("Failed to cleanup orphaned images:", cleanupError);
          });
      }
    } finally {
      if (mounted && !closing.current) {
        setIsSubmitting(false);
      }
    }
  }

  if (!mounted) return null;

  const overlayOpacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.overlay, { opacity: overlayOpacity }]}
    >
      <View style={styles.backdrop} />
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <Animated.View
          accessibilityViewIsModal
        style={[
          styles.panel,
          {
            transform: [
              {
                translateY: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [16, 0],
                }),
              },
              {
                scale: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.96, 1],
                }),
              },
            ],
          },
        ]}
      >
        <View pointerEvents="none" style={styles.topGlow} />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close feedback"
          hitSlop={10}
          onPress={close}
          disabled={isSubmitting}
          style={({ pressed }) => [
            styles.closeButton,
            pressed && styles.closePressed,
          ]}
        >
          <Ionicons name="close" size={20} color="#f8d675" />
        </Pressable>

        <View style={styles.heading}>
          <View style={styles.headingIcon}>
            <Ionicons name="bulb-outline" size={22} color="#ffd45c" />
          </View>

          <Text style={styles.title}>گوێمان لێتە</Text>

          <Text style={styles.subtitle}>
            بیرۆکە، پێشنیار یان هەر شتێکت هەیە، بۆمان بنێرە
          </Text>
        </View>

        <View style={styles.composer}>
          <TextInput
            multiline
            scrollEnabled
            placeholder="لێرە بنووسە..."
            placeholderTextColor="#afa8bc"
            accessibilityLabel="لێرە بنووسە..."
            textAlignVertical="top"
            style={styles.feedbackInput}
            value={message}
            onChangeText={setMessage}
            editable={!isSubmitting}
          />

          <View style={styles.actionRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="بۆمان بنێرە"
              disabled={isSubmitting || !message.trim()}
              onPress={() => void handleSubmit()}
              style={({ pressed }) => [
                styles.sendButton,
                (pressed || isSubmitting || !message.trim()) && styles.pressed,
              ]}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#251b09" size="small" />
              ) : (
                <Text style={styles.sendText}>بۆمان بنێرە</Text>
              )}
            </Pressable>

            <View style={styles.attachmentSlots}>
              {[0, 1, 2].map((slotIndex) => {
                const uri = images[slotIndex];
                return (
                  <View key={slotIndex} style={styles.attachmentSlot}>
                    {uri ? (
                      <>
                        <Image
                          source={uri}
                          style={styles.thumbnail}
                          contentFit="cover"
                        />
                        {!isSubmitting && (
                          <Pressable
                            style={styles.removeButton}
                            onPress={() => handleRemoveImage(slotIndex)}
                            hitSlop={8}
                          >
                            <Ionicons name="close" size={14} color="#ffffff" />
                          </Pressable>
                        )}
                      </>
                    ) : (
                      <Pressable
                        style={styles.addAttachmentButton}
                        onPress={() => void handlePickImage()}
                        disabled={isSubmitting}
                      >
                        <Ionicons name="add" size={22} color="#f8d675" />
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        </View>
      </Animated.View>
      </TouchableWithoutFeedback>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 5000,
    elevation: 5000,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(5,4,12,0.8)",
  },
  panel: {
    width: "100%",
    maxWidth: 800,
    height: 360,
    overflow: "hidden",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,212,92,0.52)",
    backgroundColor: "#14121d",
    paddingTop: 22,
    paddingBottom: 17,
    shadowColor: "#000",
    shadowOpacity: 0.46,
    shadowRadius: 20,
    shadowOffset: {
      width: 0,
      height: 12,
    },
    elevation: 20,
  },
  topGlow: {
    position: "absolute",
    top: -55,
    left: "23%",
    width: "54%",
    height: 110,
    borderRadius: 60,
    backgroundColor: "rgba(255,202,68,0.1)",
  },
  closeButton: {
    position: "absolute",
    top: 12,
    right: 13,
    zIndex: 2,
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: "rgba(255,212,92,0.22)",
    backgroundColor: "rgba(255,212,92,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  closePressed: {
    opacity: 0.72,
  },
  heading: {
    alignItems: "center",
    paddingHorizontal: 50,
    marginBottom: 18,
  },
  headingIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 7,
    backgroundColor: "rgba(255,202,68,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,212,92,0.35)",
  },
  title: {
    color: "#fff6d8",
    fontSize: 19,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },
  subtitle: {
    color: "#afa8bc",
    fontSize: 12,
    fontFamily: "SpedaRegular",
    marginTop: 3,
    textAlign: "center",
    writingDirection: "rtl",
  },
  composer: {
    flex: 1,
    paddingHorizontal: 18,
    gap: 12,
  },
  feedbackInput: {
    flex: 1,
    minHeight: 110,
    backgroundColor: "#201d29",
    borderWidth: 1,
    borderColor: "rgba(255,212,92,0.22)",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#fff6d8",
    fontFamily: "SpedaRegular",
    fontSize: 14,
    textAlign: "right",
    writingDirection: "rtl",
  },
  actionRow: {
    direction: "ltr",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  attachmentSlots: {
    flexDirection: "row",
    gap: 8,
  },
  attachmentSlot: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: "#201d29",
    borderWidth: 1,
    borderColor: "rgba(255,212,92,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  addAttachmentButton: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbnail: {
    width: "100%",
    height: "100%",
    borderRadius: 9,
  },
  removeButton: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#ef4444",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#14121d",
  },
  sendButton: {
    width: 148,
    height: 44,
    borderRadius: 10,
    backgroundColor: "#d39c23",
    alignItems: "center",
    justifyContent: "center",
  },
  sendText: {
    color: "#251b09",
    fontSize: 14,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },
  pressed: {
    opacity: 0.72,
  },
});
