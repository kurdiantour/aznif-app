import { LinearGradient } from "expo-linear-gradient";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import { BottomNav } from "@/components/lobby/BottomNav";
import { LobbyHeader } from "@/components/lobby/LobbyHeader";
import {
  MOBILE_HORIZONTAL_INSET,
  TABLET_HORIZONTAL_INSET,
} from "@/constants/layout";
import { useProfile } from "@/lib/profile";
import { supabase } from "@/lib/supabase";
import { getBalance } from "@/lib/wallet";
import type { Wallet } from "@/types/wallet";

const PRIVATE_ROOM_BET_AMOUNT = 10;

export default function CreateRoomScreen() {
  const router = useRouter();

  const {
    profile,
    loading: profileLoading,
  } = useProfile();

  const { width, height } = useWindowDimensions();

  const isTablet = Math.min(width, height) >= 600;

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);

  const [privateSubmitting, setPrivateSubmitting] =
    useState(false);

  const [joinSubmitting, setJoinSubmitting] =
    useState(false);

  const [roomCode, setRoomCode] = useState("");
  const [roomCodeError, setRoomCodeError] =
    useState<string | null>(null);

  const [error, setError] =
    useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadWallet() {
      if (profileLoading || !profile) {
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const result = await getBalance();

        if (mounted) {
          setWallet(result);
        }
      } catch (reason) {
        console.warn(
          "Unable to load private-room balance:",
          reason,
        );

        if (mounted) {
          setError("نەتوانرا باڵانسی ئەزنیف بار بکرێت.");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void loadWallet();

    return () => {
      mounted = false;
    };
  }, [profile, profileLoading]);

  const getRoomError = (
    reason: unknown,
    fallback: string,
  ) => {
    const message =
      reason instanceof Error
        ? reason.message
        : fallback;

    const normalized = message.toLowerCase();

    if (normalized.includes("not found")) {
      return "ژوورێک بەم کۆدەوە نەدۆزرایەوە.";
    }

    if (
      normalized.includes("not joinable") ||
      normalized.includes("full")
    ) {
      return "ئەم ژوورە چیتر بەردەست نییە.";
    }

    if (
      normalized.includes("authentication") ||
      normalized.includes("jwt")
    ) {
      return "تکایە دووبارە بچۆرە ژوورەوە.";
    }

    if (normalized.includes("insufficient")) {
      return `هەردوو یاریزان پێویستیان بە لانیکەم ${PRIVATE_ROOM_BET_AMOUNT} ئەزنیف هەیە.`;
    }

    return message;
  };

  const openPrivateRoom = (
    roomId: string,
    code = "",
  ) => {
    router.replace({
      pathname: "/domino/matchmaking",
      params: {
        mode: "1v1",
        matchmaking_status: "private",
        room_id: roomId,
        room_code: code,
        matchType: "private",
      },
    });
  };

  const createPrivateRoom = async () => {
    if (privateSubmitting || joinSubmitting) {
      return;
    }

    if (!profile) {
      router.push("/login");
      return;
    }

    if (
      !wallet ||
      wallet.balances.mc < PRIVATE_ROOM_BET_AMOUNT
    ) {
      setError(
        `بۆ دروستکردنی ژوور پێویستت بە ${PRIVATE_ROOM_BET_AMOUNT} ئەزنیف هەیە.`,
      );
      return;
    }

    setPrivateSubmitting(true);
    setError(null);

    try {
      const {
        data,
        error: rpcError,
      } = await supabase.rpc(
        "create_private_10_aznif_room",
      );

      if (rpcError) {
        throw rpcError;
      }

      if (!data?.id) {
        throw new Error(
          "Unable to create a private room.",
        );
      }

      openPrivateRoom(
        data.id,
        data.room_code ?? "",
      );
    } catch (reason) {
      console.warn(
        "Unable to create private room:",
        reason,
      );

      setError(
        getRoomError(
          reason,
          "نەتوانرا ژووری تایبەت دروست بکرێت.",
        ),
      );
    } finally {
      setPrivateSubmitting(false);
    }
  };

  const joinPrivateRoom = async () => {
    if (privateSubmitting || joinSubmitting) {
      return;
    }

    const normalizedCode =
      roomCode.trim().toUpperCase();

    if (!normalizedCode) {
      setRoomCodeError(
        "تکایە کۆدی ژوور بنووسە",
      );
      return;
    }

    setRoomCodeError(null);
    setJoinSubmitting(true);
    setError(null);

    try {
      const {
        data,
        error: rpcError,
      } = await supabase.rpc(
        "join_private_10_aznif_room",
        {
          p_room_code: normalizedCode,
        },
      );

      if (rpcError) {
        throw rpcError;
      }

      if (!data?.ok) {
        const messages: Record<string, string> = {
          invalid_code:
            "ژوورێک بەم کۆدەوە نەدۆزرایەوە.",

          expired:
            "کاتی ئەم ژوورە تایبەتە بەسەرچووە.",

          host_unavailable:
            "دروستکەری ژوور چیتر چاوەڕێ ناکات.",

          not_joinable:
            "ئەم ژوورە چیتر بەردەست نییە.",

          insufficient_aznif:
            "هەردوو یاریزان پێویستیان بە لانیکەم ١٠ ئەزنیف هەیە.",

          already_in_paid_room:
            "لە ئێستادا لە ژوورێکی پارەدار دایت.",

          rate_limited:
            "هەوڵی زۆرت داوە؛ تکایە کەمێک چاوەڕێ بکە.",

          cannot_join_own_room:
            "تۆ خۆت دروستکەری ئەم ژوورەیت.",
        };

        throw new Error(
          messages[data?.error_code] ??
            "نەتوانرا بچیتە ژووری تایبەت.",
        );
      }

      if (!data.room_id) {
        throw new Error(
          "Unable to join private room.",
        );
      }

      openPrivateRoom(
        data.room_id,
        normalizedCode,
      );
    } catch (reason) {
      console.warn(
        "Unable to join private room:",
        reason,
      );

      setError(
        getRoomError(
          reason,
          "نەتوانرا بچیتە ژووری تایبەت.",
        ),
      );
    } finally {
      setJoinSubmitting(false);
    }
  };

  if (!profileLoading && !profile) {
    return <Redirect href="/login" />;
  }

  if (loading || profileLoading) {
    return (
      <View style={styles.screen}>
        <LobbyHeader />

        <View style={styles.loading}>
          <ActivityIndicator
            size="large"
            color="#ffffff"
          />
        </View>

        <BottomNav active={null} />
      </View>
    );
  }

  const submitting =
    privateSubmitting || joinSubmitting;

  const privateRoomDisabled =
    !wallet ||
    wallet.balances.mc <
      PRIVATE_ROOM_BET_AMOUNT;

  return (
    <View style={styles.screen}>
      <LobbyHeader />

      <View
        style={[
          styles.contentFrame,
          {
            paddingHorizontal: isTablet
              ? TABLET_HORIZONTAL_INSET
              : MOBILE_HORIZONTAL_INSET,
          },
        ]}
      >
        <View
          style={[
            styles.cardsRow,
            isTablet && styles.cardsRowTablet,
          ]}
        >
          <View
            style={[
              styles.card,
              isTablet && styles.cardTablet,
            ]}
          >
            <Image
              source={require(
                "@/assets/images/lobby/create-room.webp"
              )}
              style={styles.cover}
              resizeMode="cover"
            />

            <LinearGradient
              colors={[
                "transparent",
                "rgba(8,9,20,0.97)",
              ]}
              style={styles.createFade}
            />

            <View
              style={[
                styles.createCardBody,
                isTablet &&
                  styles.createCardBodyTablet,
              ]}
            >
              <Text
                style={[
                  styles.heading,
                  isTablet && styles.headingTablet,
                ]}
              >
                دروستکردنی ژووری تایبەت
              </Text>

              <Text
                style={[
                  styles.description,
                  isTablet &&
                    styles.descriptionTablet,
                ]}
              >
                بەشداری: (
                {" "}
                {PRIVATE_ROOM_BET_AMOUNT.toLocaleString(
                  "en-US",
                )}
                {" "}
                ) ئەزنیف
              </Text>

              <Pressable
                onPress={createPrivateRoom}
                disabled={
                  privateRoomDisabled ||
                  submitting
                }
                style={({ pressed }) => [
                  styles.button,
                  styles.createButton,
                  isTablet &&
                    styles.buttonTablet,
                  (privateRoomDisabled ||
                    submitting) &&
                    styles.dim,
                  pressed &&
                    !privateRoomDisabled &&
                    !submitting &&
                    styles.pressed,
                ]}
              >
                {privateSubmitting ? (
                  <ActivityIndicator
                    color="#ffffff"
                  />
                ) : (
                  <Text
                    style={[
                      styles.buttonText,
                      isTablet &&
                        styles.buttonTextTablet,
                    ]}
                  >
                    دروستکردنی ژوور
                  </Text>
                )}
              </Pressable>
            </View>
          </View>

          <View
            style={[
              styles.card,
              isTablet && styles.cardTablet,
            ]}
          >
            <LinearGradient
              colors={[
                "#193656",
                "#13243b",
                "#10141e",
              ]}
              style={
                StyleSheet.absoluteFillObject
              }
            />

            <View
              style={[
                styles.cardBody,
                isTablet &&
                  styles.cardBodyTablet,
              ]}
            >
              <Text
                style={[
                  styles.heading,
                  isTablet && styles.headingTablet,
                ]}
              >
                چوونە ژووری تایبەت
              </Text>

              <Text
                style={[
                  styles.description,
                  isTablet &&
                    styles.descriptionTablet,
                ]}
              >
                کۆدی ژوورەکە بنووسە
              </Text>

              {roomCodeError ? (
                <Text
                  style={styles.roomCodeError}
                >
                  {roomCodeError}
                </Text>
              ) : null}

              <TextInput
                value={roomCode}
                onChangeText={(value) => {
                  setRoomCode(value);
                  setRoomCodeError(null);
                  setError(null);
                }}
                placeholder="کۆدی ژوور"
                placeholderTextColor="#9faec6"
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!submitting}
                maxLength={12}
                style={[
                  styles.input,
                  isTablet && styles.inputTablet,
                ]}
              />

              <Pressable
                onPress={joinPrivateRoom}
                disabled={submitting}
                style={({ pressed }) => [
                  styles.button,
                  styles.joinButton,
                  isTablet &&
                    styles.buttonTablet,
                  submitting && styles.dim,
                  pressed &&
                    !submitting &&
                    styles.pressed,
                ]}
              >
                {joinSubmitting ? (
                  <ActivityIndicator
                    color="#ffffff"
                  />
                ) : (
                  <Text
                    style={[
                      styles.buttonText,
                      isTablet &&
                        styles.buttonTextTablet,
                    ]}
                  >
                    چوونە ژوورەوە
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>

        {error ? (
          <Text
            style={[
              styles.error,
              isTablet && styles.errorTablet,
            ]}
          >
            {error}
          </Text>
        ) : null}
      </View>

      <BottomNav active={null} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingTop: 14,
    paddingBottom: 18,
    backgroundColor: "#090b1d",
  },

  contentFrame: {
    flex: 1,
    paddingBottom: 74,
    justifyContent: "center",
  },

  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  cardsRow: {
    alignSelf: "flex-start",
    width: "50%",
    height: "80%",
    minHeight: 205,
    maxHeight: 238,
    flexDirection: "row",
    gap: 8,
  },

  cardsRowTablet: {
    width: "55%",
    height: "72%",
    minHeight: 390,
    maxHeight: 520,
    gap: 18,
    marginTop: 12,
  },

  card: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(180,120,255,0.34)",
    backgroundColor: "#172033",
  },

  cardTablet: {
    borderRadius: 18,
    borderWidth: 1.4,
  },

  cover: {
    width: "100%",
    height: "100%",
  },

  createFade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "62%",
  },

  cardBody: {
    flex: 1,
    padding: 18,
    alignItems: "center",
    justifyContent: "flex-end",
  },

  cardBodyTablet: {
    padding: 28,
  },

  createCardBody: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 18,
    alignItems: "center",
  },

  createCardBodyTablet: {
    padding: 28,
  },

  heading: {
    color: "#ffffff",
    fontSize: 17,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  headingTablet: {
    fontSize: 24,
  },

  description: {
    marginTop: 6,
    color: "#f3f4f6",
    fontSize: 11,
    lineHeight: 17,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  descriptionTablet: {
    marginTop: 10,
    fontSize: 16,
    lineHeight: 24,
  },

  button: {
    width: "100%",
    height: 40,
    marginTop: 13,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },

  buttonTablet: {
    height: 54,
    marginTop: 20,
    borderRadius: 15,
  },

  createButton: {
    backgroundColor: "#8b5be4",
  },

  joinButton: {
    backgroundColor: "#2853a4",
  },

  buttonText: {
    color: "#ffffff",
    fontSize: 11,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  buttonTextTablet: {
    fontSize: 16,
  },

  input: {
    width: "100%",
    height: 40,
    marginTop: 13,
    paddingHorizontal: 14,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#426184",
    backgroundColor: "rgba(10,17,31,0.64)",
    color: "#ffffff",
    fontSize: 11,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  inputTablet: {
    height: 54,
    marginTop: 20,
    borderRadius: 14,
    fontSize: 16,
  },

  roomCodeError: {
    marginTop: 8,
    color: "#ff9a9a",
    fontSize: 11,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  dim: {
    opacity: 0.46,
  },

  pressed: {
    opacity: 0.9,
    transform: [{ scale: 0.985 }],
  },

  error: {
    marginTop: 12,
    paddingHorizontal: 14,
    color: "#ff9a9a",
    fontSize: 12,
    lineHeight: 19,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },

  errorTablet: {
    marginTop: 18,
    fontSize: 16,
    lineHeight: 25,
  },
});