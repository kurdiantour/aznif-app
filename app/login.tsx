import { useProfile } from "@/lib/profile";
import { claimNewAccountLeaderboardConsent } from "@/lib/leaderboardVisibility";
import {
  signInWithEmail,
  signInWithFacebook,
  signInWithGoogle,
  signUpWithEmail,
  updateMyProfile,
} from "@/lib/supabaseAuth";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { FontAwesome, Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export default function LoginScreen() {
  const router = useRouter();
  const { refreshProfile, session, authLoading } = useProfile();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadSavedEmail() {
      const savedEmail = await AsyncStorage.getItem(SAVED_EMAIL_KEY);
      if (savedEmail && isMounted) setEmail(savedEmail);
    }

    void loadSavedEmail();

    return () => {
      isMounted = false;
    };
  }, [router]);

  useEffect(() => {
    if (!authLoading && session) {
      router.replace("/(tabs)/play");
    }
  }, [authLoading, router, session]);

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
          ? await signUpWithEmail(cleanEmail, password, cleanUsername)
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

      if (authMode === "signup") {
        try {
          await updateMyProfile({ username: cleanUsername });
          await refreshProfile();
        } catch (error) {
          console.warn("[auth] Signed in, but profile setup failed", error);
        }
      }

      await claimNewAccountLeaderboardConsent();

      await AsyncStorage.setItem(SAVED_EMAIL_KEY, cleanEmail);
      router.replace("/(tabs)/play");
    } catch (error) {
      console.warn("[auth] login failed", error);
      setMessage("هەڵەیەک ڕوویدا. تکایە دووبارە هەوڵ بدەوە.");
    } finally {
      setIsLoading(false);
    }
  };

  if (authLoading || session) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color="#f8d774" size="large" />
      </View>
    );
  }

  const isSignup = mode === "signup";
  const availableWidth = Math.max(width - insets.left - insets.right, 0);
  const availableHeight = Math.max(height - insets.top - insets.bottom, 0);
  const isHorizontalLayout = availableWidth > availableHeight;
  const edgeSpacing = clamp(
    Math.min(availableWidth * 0.025, availableHeight * 0.04),
    8,
    24,
  );
  const panelPadding = clamp(availableHeight * 0.025, 8, 18);
  const sectionGap = clamp(availableHeight * 0.025, 7, 14);
  const fieldGap = clamp(availableHeight * 0.018, 6, 11);
  const controlHeight = clamp(availableHeight * 0.1, 40, 52);
  const panelWidth = Math.min(
    Math.max(availableWidth - edgeSpacing * 2, 0),
    isHorizontalLayout ? 760 : 430,
  );

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setMessage(null);

    try {
      const result = await signInWithGoogle();

      if (result.error) {
        setMessage("چوونەژوورەوە بە Google سەرکەوتوو نەبوو. تکایە دووبارە هەوڵ بدەوە.");
        return;
      }

      await claimNewAccountLeaderboardConsent();

      try {
        await refreshProfile();
      } catch (error) {
        console.warn("[auth] Signed in, but profile refresh failed", error);
      }
      router.replace("/(tabs)/play");
    } catch (error) {
      console.warn("[auth] Google sign-in failed", error);
      setMessage("چوونەژوورەوە بە Google سەرکەوتوو نەبوو. تکایە دووبارە هەوڵ بدەوە.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleFacebookSignIn = async () => {
    setIsLoading(true);
    setMessage(null);
    try {
      const result = await signInWithFacebook();
      if (result.error) {
        setMessage("Facebook sign-in failed. Please try again.");
        return;
      }
      await claimNewAccountLeaderboardConsent();
      try {
        await refreshProfile();
      } catch (error) {
        console.warn("[auth] Signed in, but profile refresh failed", error);
      }
      router.replace("/(tabs)/play");
    } catch (error) {
      console.warn("[auth] Facebook sign-in failed", error);
      setMessage("Facebook sign-in failed. Please try again.");
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
          <View
            style={[
              styles.fixedContent,
              {
                paddingLeft: insets.left + edgeSpacing,
                paddingRight: insets.right + edgeSpacing,
                paddingTop: insets.top + edgeSpacing,
                paddingBottom: insets.bottom + edgeSpacing,
              },
            ]}
          >
            <View style={[styles.panel, { width: panelWidth, padding: panelPadding }]}>
              <View
                style={[
                  styles.contentRow,
                  { gap: sectionGap },
                  !isHorizontalLayout && styles.contentStack,
                ]}
              >
                <View style={styles.formColumn}>
                  <View style={[styles.modeSwitch, { gap: fieldGap, marginBottom: fieldGap }]}>
                    <Pressable
                      style={[styles.modeButton, { minHeight: controlHeight }, !isSignup && styles.modeActive]}
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
                      style={[styles.modeButton, { minHeight: controlHeight }, isSignup && styles.modeActive]}
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

                  <View style={[styles.form, { gap: fieldGap }]}>
                    {isSignup ? (
                      <View style={[styles.inputWrap, { minHeight: controlHeight }]}>
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

                    <View style={[styles.inputWrap, { minHeight: controlHeight }]}>
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

                    <View style={[styles.inputWrap, { minHeight: controlHeight }]}>
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
                      style={[styles.primaryButton, { minHeight: controlHeight }, isLoading && styles.disabled]}
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
                      <View style={styles.secondaryLinks}>
                        <Pressable
                          style={styles.textButton}
                          onPress={() => router.push("/forgot-password")}
                          disabled={isLoading}
                        >
                          <Text style={styles.textButtonLabel}>
                            وشەی نهێنیت لەبیرکردووە؟
                          </Text>
                        </Pressable>
                        <Pressable
                          style={styles.textButton}
                          onPress={() => router.replace("/(tabs)/play")}
                          disabled={isLoading}
                          accessibilityRole="button"
                          accessibilityLabel="Continue as guest"
                        >
                          <Text style={styles.guestLinkLabel}>بەردەوامبوون وەک میوان</Text>
                        </Pressable>
                      </View>
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
                    {isSignup ? (
                      <Pressable
                        style={styles.textButton}
                        onPress={() => router.replace("/(tabs)/play")}
                        disabled={isLoading}
                        accessibilityRole="button"
                        accessibilityLabel="Continue as guest"
                      >
                        <Text style={styles.guestLinkLabel}>بەردەوامبوون وەک میوان</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>

                <View style={styles.guestColumn}>
                  <View style={[styles.authChoiceRow, { gap: fieldGap }]}>
                    <View style={styles.authChoiceCard}>
                      <View style={[styles.guestIcon, styles.googleIcon]}>
                        <FontAwesome name="google" size={21} color="#ffffff" />
                      </View>
                      <Text style={[styles.guestTitle, styles.googleText]}>Google</Text>
                      <Text style={styles.guestCopy} numberOfLines={2}>
                        بە هەژمارەکەتەوە بچۆ ژوورەوە
                      </Text>
                      <Pressable
                        style={[styles.guestButton, { minHeight: controlHeight }, styles.googleButton, isLoading && styles.disabled]}
                        onPress={() => void handleGoogleSignIn()}
                        disabled={isLoading}
                      >
                        <Text style={[styles.guestButtonText, styles.googleText]}>Google</Text>
                      </Pressable>
                    </View>

                    <View style={styles.authChoiceCard}>
                      <View style={[styles.guestIcon, styles.facebookIcon]}>
                        <FontAwesome name="facebook" size={22} color="#ffffff" />
                      </View>
                      <Text style={[styles.guestTitle, styles.englishText]}>Facebook</Text>
                      <Text style={styles.guestCopy} numberOfLines={2}>
                        بە هەژمارەکەتەوە بچۆ ژوورەوە
                      </Text>
                      <Pressable
                        style={[styles.guestButton, { minHeight: controlHeight }, isLoading && styles.disabled]}
                        onPress={() => void handleFacebookSignIn()}
                        disabled={isLoading}
                        accessibilityRole="button"
                        accessibilityLabel="Continue with Facebook"
                      >
                        <Text style={[styles.guestButtonText, styles.englishText]}>Facebook</Text>
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
  },
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#020617",
  },
  panel: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    backgroundColor: "rgba(4, 10, 25, 0.86)",
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

  facebookIcon: {
    backgroundColor: "#1877f2",
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
    fontSize: 13,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },
  secondaryLinks: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
  },
  guestLinkLabel: {
    color: "#a8b7d5",
    fontSize: 11,
    fontFamily: "SpedaRegular",
  },
  textButton: {
    alignSelf: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  textButtonLabel: {
    color: "#93c5fd",
    fontSize: 12,
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

  englishText: {
    fontFamily: "RobotoMedium",
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
