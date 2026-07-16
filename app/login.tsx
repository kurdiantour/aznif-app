import { useProfile } from "@/lib/profile";
import { markPendingLeaderboardConsent } from "@/lib/leaderboardVisibility";
import {
  getCurrentUser,
  getOrCreateProfile,
  signInWithEmail,
  signUpWithEmail,
  updateMyProfile,
} from "@/lib/supabaseAuth";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

const SAVED_EMAIL_KEY = "domino_saved_email";
const SESSION_CHECK_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error("Session check timed out."));
    }, timeoutMs);

    promise
      .then(resolve, reject)
      .finally(() => clearTimeout(timeoutId));
  });
}

export default function LoginScreen() {
  const router = useRouter();
  const { refreshProfile } = useProfile();
  const { width } = useWindowDimensions();

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [isLoading, setIsLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function verifySession() {
      try {
        const savedEmail = await AsyncStorage.getItem(SAVED_EMAIL_KEY);

        if (savedEmail && isMounted) {
          setEmail(savedEmail);
        }

        const user = await withTimeout(
          getCurrentUser(),
          SESSION_CHECK_TIMEOUT_MS,
        );

        if (user && isMounted) {
          await withTimeout(
            getOrCreateProfile(),
            SESSION_CHECK_TIMEOUT_MS,
          );
          router.replace("/(tabs)/lobby");
          return;
        }
      } catch {
        // Ignore session errors and show auth form.
      } finally {
        if (isMounted) {
          setCheckingSession(false);
        }
      }
    }

    verifySession();

    return () => {
      isMounted = false;
    };
  }, [router]);

  const handleAuth = async (authMode = mode) => {
    const cleanEmail = email.trim().toLowerCase();
    const cleanUsername = username.trim();

    if (!cleanEmail || !password) {
      setMessage("تکایە ئیمەیڵ و وشەی نهێنی بنووسە.");
      return;
    }

    if (authMode === "signup" && cleanUsername.length < 3) {
      setMessage("ناوی بەکارهێنەر دەبێت لانیکەم ٣ پیت بێت.");
      return;
    }

    setIsLoading(true);
    setMessage(null);

    try {
      const result =
        authMode === "signup"
          ? await signUpWithEmail(cleanEmail, password)
          : await signInWithEmail(cleanEmail, password);

      if (result.error) {
        setMessage(
          authMode === "signup"
            ? "نەتوانرا هەژمارەکە دروست بکرێت. زانیارییەکان بپشکنە و دووبارە هەوڵ بدەوە."
            : "ئیمەیڵ یان وشەی نهێنی هەڵەیە.",
        );
        return;
      }

      if (authMode === "signup" && !result.data.session) {
        await AsyncStorage.setItem(SAVED_EMAIL_KEY, cleanEmail);
        setMessage(
          "هەژمارەکەت دروست بوو. تکایە ئیمەیڵەکەت پشتڕاست بکەرەوە، پاشان بچۆ ژوورەوە.",
        );
        setMode("signin");
        setPassword("");
        return;
      }

      const profile = await getOrCreateProfile();

      if (!profile) {
        setMessage(
          "نەتوانرا پڕۆفایلەکەت ئامادە بکرێت. تکایە ئیمەیڵەکەت پشتڕاست بکەرەوە و دووبارە هەوڵ بدەوە.",
        );
        return;
      }

      if (authMode === "signup") {
        await updateMyProfile({ username: cleanUsername });
        await refreshProfile();
        await markPendingLeaderboardConsent();
      }

      await AsyncStorage.setItem(SAVED_EMAIL_KEY, cleanEmail);
      router.replace("/(tabs)/lobby");
    } catch (error) {
      console.warn("[auth] login failed", error);
      setMessage("هەڵەیەک ڕوویدا. تکایە دووبارە هەوڵ بدەوە.");
    } finally {
      setIsLoading(false);
    }
  };

  if (checkingSession) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color="#f8d774" size="large" />
      </View>
    );
  }

  const isSignup = mode === "signup";
  const isWideLayout = width >= 720;

  const selectMode = (nextMode: "signin" | "signup") => {
    setMode(nextMode);
    setMessage(null);
  };

  return (
    <ImageBackground
      source={require("@/assets/images/lobby/lobby-bg.webp")}
      resizeMode="cover"
      style={styles.background}
    >
      <LinearGradient
        colors={["rgba(2, 6, 23, 0.92)", "rgba(9, 18, 40, 0.86)"]}
        style={styles.overlay}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.keyboardView}
        >
          <View style={styles.fixedContent}>
            <View
              style={[styles.panel, isWideLayout && styles.panelWide]}
            >
              <View style={[styles.contentRow, !isWideLayout && styles.contentStack]}>
                <View style={styles.formColumn}>
                  <View style={styles.modeSwitch}>
                    <Pressable
                      style={[styles.modeButton, !isSignup && styles.modeActive]}
                      onPress={() => selectMode("signin")}
                      disabled={isLoading}
                    >
                      <Text
                        style={[
                          styles.modeText,
                          !isSignup && styles.modeTextActive,
                        ]}
                      >
                        چوونەژوورەوە
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[styles.modeButton, isSignup && styles.modeActive]}
                      onPress={() => selectMode("signup")}
                      disabled={isLoading}
                    >
                      <Text
                        style={[
                          styles.modeText,
                          isSignup && styles.modeTextActive,
                        ]}
                      >
                        هەژماری نوێ
                      </Text>
                    </Pressable>
                  </View>

                  <View style={styles.form}>
                    {isSignup ? (
                      <View style={styles.inputWrap}>
                        <Ionicons name="person-outline" size={18} color="#9ca3af" />
                        <TextInput
                          placeholder="ناوی بەکارهێنەر"
                          placeholderTextColor="#8fa1bf"
                          style={styles.input}
                          autoCapitalize="none"
                          value={username}
                          onChangeText={setUsername}
                          editable={!isLoading}
                        />
                      </View>
                    ) : null}

                    <View style={styles.inputWrap}>
                      <Ionicons name="mail-outline" size={18} color="#9ca3af" />
                      <TextInput
                        placeholder="ئیمەیڵ"
                        placeholderTextColor="#8fa1bf"
                        style={[styles.input, styles.ltrInput]}
                        autoCapitalize="none"
                        keyboardType="email-address"
                        autoComplete="email"
                        value={email}
                        onChangeText={setEmail}
                        editable={!isLoading}
                      />
                    </View>

                    <View style={styles.inputWrap}>
                      <Ionicons
                        name="lock-closed-outline"
                        size={18}
                        color="#9ca3af"
                      />
                      <TextInput
                        placeholder="وشەی نهێنی"
                        placeholderTextColor="#8fa1bf"
                        style={styles.input}
                        secureTextEntry
                        autoComplete={isSignup ? "new-password" : "password"}
                        value={password}
                        onChangeText={setPassword}
                        editable={!isLoading}
                      />
                    </View>

                    {message ? <Text style={styles.messageText}>{message}</Text> : null}

                    <Pressable
                      style={[styles.primaryButton, isLoading && styles.disabled]}
                      onPress={() => handleAuth(mode)}
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <ActivityIndicator color="#ffffff" />
                      ) : (
                        <>
                          <Text style={styles.primaryButtonText}>
                            {isSignup ? "دروستکردنی هەژمار" : "چوونەژوورەوە"}
                          </Text>
                          <Ionicons
                            name="arrow-back"
                            size={19}
                            color="#ffffff"
                          />
                        </>
                      )}
                    </Pressable>

                    {!isSignup ? (
                      <Pressable
                        style={styles.textButton}
                        onPress={() => router.push("/forgot-password")}
                        disabled={isLoading}
                      >
                        <Text style={styles.textButtonLabel}>
                          وشەی نهێنیت لەبیرکردووە؟
                        </Text>
                      </Pressable>
                    ) : (
                      <Text style={styles.privacyText}>
                        بە دروستکردنی هەژمار، ڕازیت بە{" "}
                        <Text
                          style={styles.inlineLink}
                          onPress={() => router.push("/privacy")}
                        >
                          سیاسەتی پاراستنی نهێنی
                        </Text>
                        .
                      </Text>
                    )}
                  </View>
                </View>

                <View style={styles.guestColumn}>
                  <View style={styles.guestIcon}>
                    <Ionicons name="game-controller-outline" size={26} color="#f8d774" />
                  </View>
                  <Text style={styles.guestTitle}>میوان</Text>
                  <Text style={styles.guestCopy}>
                    بەبێ هەژمار بچۆ ناو یاری و دواتر دەتوانیت هەژمار دروست بکەیت.
                  </Text>
                  <Pressable
                    style={[styles.guestButton, isLoading && styles.disabled]}
                    onPress={() => router.replace("/(tabs)/lobby")}
                    disabled={isLoading}
                  >
                    <Text style={styles.guestButtonText}>بەردەوامبوون</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </LinearGradient>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
    backgroundColor: "#020617",
  },
  overlay: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  fixedContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#020617",
  },
  panel: {
    width: "100%",
    maxWidth: 390,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    backgroundColor: "rgba(4, 10, 25, 0.86)",
    padding: 12,
  },
  panelWide: {
    maxWidth: 760,
  },
  contentRow: {
    flexDirection: "row-reverse",
    gap: 12,
    alignItems: "stretch",
  },
  contentStack: {
    flexDirection: "column",
  },
  formColumn: {
    flex: 1.28,
    minWidth: 0,
  },
  guestColumn: {
    flex: 0.92,
    minWidth: 0,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(248, 215, 116, 0.22)",
    backgroundColor: "rgba(15, 23, 42, 0.66)",
    padding: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  guestIcon: {
    width: 48,
    height: 48,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(248, 215, 116, 0.12)",
    marginBottom: 10,
  },
  guestTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },
  guestCopy: {
    color: "#b6c2d8",
    fontSize: 12,
    fontFamily: "SpedaRegular",
    lineHeight: 22,
    textAlign: "center",
    writingDirection: "rtl",
    marginTop: 8,
    marginBottom: 12,
  },
  modeSwitch: {
    flexDirection: "row-reverse",
    gap: 6,
    marginBottom: 10,
  },
  modeButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.22)",
    backgroundColor: "rgba(15, 23, 42, 0.72)",
  },
  modeActive: {
    borderColor: "rgba(248, 215, 116, 0.6)",
    backgroundColor: "rgba(248, 215, 116, 0.16)",
  },
  modeText: {
    color: "#b6c2d8",
    fontSize: 13,
    fontFamily: "SpedaBold",
    textAlign: "center",
  },
  modeTextActive: {
    color: "#f8d774",
  },
  form: {
    gap: 9,
  },
  inputWrap: {
    minHeight: 48,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.24)",
    backgroundColor: "rgba(15, 23, 42, 0.74)",
    paddingHorizontal: 13,
  },
  input: {
    flex: 1,
    minHeight: 46,
    color: "#ffffff",
    fontFamily: "SpedaRegular",
    fontSize: 14,
    textAlign: "right",
    writingDirection: "rtl",
  },
  ltrInput: {
    fontFamily: "RobotoMedium",
    textAlign: "left",
    writingDirection: "ltr",
  },
  messageText: {
    color: "#fecaca",
    fontSize: 12,
    fontFamily: "SpedaRegular",
    lineHeight: 20,
    textAlign: "center",
    writingDirection: "rtl",
  },
  primaryButton: {
    minHeight: 48,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 6,
    backgroundColor: "#2563eb",
    marginTop: 4,
  },
  disabled: {
    opacity: 0.65,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },
  textButton: {
    alignSelf: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  textButtonLabel: {
    color: "#93c5fd",
    fontSize: 13,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },
  privacyText: {
    color: "#a8b7d5",
    fontSize: 12,
    fontFamily: "SpedaRegular",
    lineHeight: 20,
    textAlign: "center",
    writingDirection: "rtl",
  },
  inlineLink: {
    color: "#93c5fd",
    fontFamily: "SpedaBold",
    textDecorationLine: "underline",
  },
  guestButton: {
    minHeight: 46,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    alignSelf: "stretch",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(248, 215, 116, 0.34)",
    backgroundColor: "rgba(248, 215, 116, 0.1)",
  },
  guestButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },
});
