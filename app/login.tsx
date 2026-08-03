import { useProfile } from "@/lib/profile";
import { markPendingLeaderboardConsent } from "@/lib/leaderboardVisibility";
import {
  getCurrentUser,
  getOrCreateProfile,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
  updateMyProfile,
} from "@/lib/supabaseAuth";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { FontAwesome, Ionicons } from "@expo/vector-icons";
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
const NEW_OAUTH_USER_CONSENT_WINDOW_MS = 5 * 60 * 1000;

function isRecentlyCreatedUser(createdAt?: string) {
  if (!createdAt) return false;

  const createdTime = new Date(createdAt).getTime();

  return Number.isFinite(createdTime) &&
    Date.now() - createdTime <= NEW_OAUTH_USER_CONSENT_WINDOW_MS;
}

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
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
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
          router.replace("/(tabs)/play");
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
      router.replace("/(tabs)/play");
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

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setMessage(null);

    try {
      const result = await signInWithGoogle();

      if (result.error) {
        setMessage("چوونەژوورەوە بە Google سەرکەوتوو نەبوو. تکایە دووبارە هەوڵ بدەوە.");
        return;
      }

      const profile = await getOrCreateProfile();

      if (!profile) {
        setMessage("چوونەژوورەوە بە Google سەرکەوتوو نەبوو. تکایە دووبارە هەوڵ بدەوە.");
        return;
      }

      const user = await getCurrentUser();

      if (isRecentlyCreatedUser(user?.created_at)) {
        await markPendingLeaderboardConsent();
      }

      await refreshProfile();
      router.replace("/(tabs)/play");
    } catch (error) {
      console.warn("[auth] Google sign-in failed", error);
      setMessage("چوونەژوورەوە بە Google سەرکەوتوو نەبوو. تکایە دووبارە هەوڵ بدەوە.");
    } finally {
      setIsLoading(false);
    }
  };
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
                          style={[
  styles.input,
  username.trim().length > 0 ? styles.ltrInput : styles.rtlInput,
]}
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
                        style={[
  styles.input,
  email.trim().length > 0 ? styles.ltrInput : styles.rtlInput,
]}
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
                        style={[
  styles.input,
  password.length > 0 ? styles.ltrInput : styles.rtlInput,
]}
                        secureTextEntry={!isPasswordVisible}
                        autoComplete={isSignup ? "new-password" : "password"}
                        value={password}
                        onChangeText={setPassword}
                        editable={!isLoading}
                      />
                      <Pressable
                        style={styles.passwordToggle}
                        onPress={() => setIsPasswordVisible((visible) => !visible)}
                        disabled={isLoading}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={
                          isPasswordVisible ? "Hide password" : "Show password"
                        }
                      >
                        <Ionicons
                          name={isPasswordVisible ? "eye-off-outline" : "eye-outline"}
                          size={20}
                          color="#9ca3af"
                        />
                      </Pressable>
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
                  <View style={styles.authChoiceRow}>
                    <View style={styles.authChoiceCard}>
                      <View style={[styles.guestIcon, styles.googleIcon]}>
                        <FontAwesome name="google" size={21} color="#ffffff" />
                      </View>
                      <Text style={[styles.guestTitle, styles.googleText]}>Google</Text>
                      <Text style={styles.guestCopy} numberOfLines={2}>
                        بە هەژماری <Text style={styles.googleInlineText}>Gmail</Text> بچۆ ژوورەوە.
                      </Text>
                      <Pressable
                        style={[styles.guestButton, styles.googleButton, isLoading && styles.disabled]}
                        onPress={() => void handleGoogleSignIn()}
                        disabled={isLoading}
                      >
                        <Text style={[styles.guestButtonText, styles.googleText]}>Google</Text>
                      </Pressable>
                    </View>

                    <View style={styles.authChoiceCard}>
                      <View style={styles.guestIcon}>
                        <Ionicons name="game-controller-outline" size={22} color="#f8d774" />
                      </View>
                      <Text style={styles.guestTitle}>میوان</Text>
                      <Text style={styles.guestCopy} numberOfLines={2}>
                        بەبێ هەژمار بچۆ ناو یاری.
                      </Text>
                      <Pressable
                        style={[styles.guestButton, isLoading && styles.disabled]}
                        onPress={() => router.replace("/(tabs)/play")}
                        disabled={isLoading}
                      >
                        <Text style={styles.guestButtonText}>بەردەوامبوون</Text>
                      </Pressable>
                    </View>
                  </View>
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
    flex: 1.18,
    minWidth: 0,
  },
  guestColumn: {
    flex: 1.02,
    minWidth: 0,
  },
  authChoiceRow: {
    flex: 1,
    flexDirection: "row-reverse",
    gap: 8,
    alignItems: "stretch",
  },

  authChoiceCard: {
    flex: 1,
    minWidth: 0,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(248, 215, 116, 0.18)",
    backgroundColor: "rgba(4, 10, 25, 0.52)",
    paddingHorizontal: 8,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  guestIcon: {
    width: 40,
    height: 40,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(248, 215, 116, 0.12)",
    marginBottom: 8,
  },

  googleIcon: {
    backgroundColor: "#4285f4",
  },

  guestTitle: {
    color: "#ffffff",
    fontSize: 15,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },
  guestCopy: {
    color: "#b6c2d8",
    fontSize: 11,
    fontFamily: "SpedaRegular",
    lineHeight: 18,
    textAlign: "center",
    writingDirection: "rtl",
    marginTop: 6,
    marginBottom: 10,
  },  modeSwitch: {
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
  
rtlInput: {
  fontFamily: "SpedaRegular",
  textAlign: "right",
  writingDirection: "rtl",
},

  passwordToggle: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.92,
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
  minHeight: 48,
  flexDirection: "row-reverse",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  alignSelf: "stretch",
  transform: [{ translateY: 11 }],
  borderRadius: 6,
  backgroundColor: "rgba(248, 215, 116, 0.1)",
},
  googleButton: {
    borderColor: "rgba(255,255,255,0.22)",
    backgroundColor: "rgba(255,255,255,0.1)",
  },

  googleInlineText: {
    fontFamily: "RobotoMedium",
  },

  googleText: {
  fontFamily: "RobotoMedium",
  writingDirection: "ltr",
},

  guestButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },
});
