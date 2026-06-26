import { useProfile } from "@/lib/profile";
import {
  getCurrentUser,
  getOrCreateProfile,
  signInWithEmail,
  signUpWithEmail,
  updateMyProfile,
} from "@/lib/supabaseAuth";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

const SAVED_EMAIL_KEY = "domino_saved_email";

export default function LoginScreen() {
  const router = useRouter();
  const { refreshProfile } = useProfile();

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

        const user = await getCurrentUser();

        if (user && isMounted) {
          await getOrCreateProfile();
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

  const handleAuth = async () => {
    const cleanEmail = email.trim().toLowerCase();
    const cleanUsername = username.trim();

    if (!cleanEmail || !password) {
      setMessage("Please enter email and password.");
      return;
    }

    if (mode === "signup" && cleanUsername.length < 3) {
      setMessage("Username must be at least 3 characters.");
      return;
    }

    setIsLoading(true);
    setMessage(null);

    try {
      const result =
        mode === "signup"
          ? await signUpWithEmail(cleanEmail, password)
          : await signInWithEmail(cleanEmail, password);

      if (result.error) {
        setMessage(result.error.message);
        return;
      }

      const profile = await getOrCreateProfile();

      if (!profile) {
        setMessage(
          "Unable to sign in. Please verify your email and try again.",
        );
        return;
      }

      if (mode === "signup") {
        await updateMyProfile({ username: cleanUsername });
        await refreshProfile();
      }

      await AsyncStorage.setItem(SAVED_EMAIL_KEY, cleanEmail);
      router.replace("/(tabs)/lobby");
    } catch (error) {
      console.warn("[auth] login failed", error);

      setMessage(
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (checkingSession) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color="#7dd3fc" size="large" />
      </View>
    );
  }

  const isSignup = mode === "signup";

  return (
    <View style={styles.container}>
      <View style={styles.formCard}>
        {isSignup ? (
          <TextInput
            placeholder="Username"
            placeholderTextColor="#7f8fb2"
            style={styles.input}
            autoCapitalize="none"
            value={username}
            onChangeText={setUsername}
            editable={!isLoading}
          />
        ) : null}

        <TextInput
          placeholder="Email"
          placeholderTextColor="#7f8fb2"
          style={styles.input}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          editable={!isLoading}
        />

        <TextInput
          placeholder="Password"
          placeholderTextColor="#7f8fb2"
          style={styles.input}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          editable={!isLoading}
        />

        {message ? <Text style={styles.messageText}>{message}</Text> : null}

        <Pressable
          style={[styles.primaryButton, isLoading && styles.disabledButton]}
          onPress={handleAuth}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.primaryButtonText}>
              {isSignup ? "Create Account" : "Sign In"}
            </Text>
          )}
        </Pressable>

        <Pressable
          style={styles.switchButton}
          onPress={() => {
            setMode((current) => (current === "signin" ? "signup" : "signin"));

            setMessage(null);
          }}
          disabled={isLoading}
        >
          <Text style={styles.switchButtonText}>
            {isSignup
              ? "Already have an account? Sign in"
              : "New player? Create account"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#050b22",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },

  formCard: {
    width: "100%",
    maxWidth: 330,
    paddingHorizontal: 8,
  },

  input: {
    height: 40,
    borderRadius: 6,
    backgroundColor: "rgba(7, 26, 54, 0.78)",
    color: "#ffffff",
    paddingHorizontal: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(33, 65, 111, 0.65)",
    fontSize: 13,
    fontFamily: "RobotoMedium",
  },

  messageText: {
    color: "#fca5a5",
    fontSize: 12,
    fontFamily: "RobotoMedium",
    marginBottom: 10,
    textAlign: "center",
  },

  primaryButton: {
    alignSelf: "center",
    minWidth: 145,
    height: 40,
    paddingHorizontal: 20,
    borderRadius: 6,
    backgroundColor: "#2563eb",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },

  disabledButton: {
    opacity: 0.65,
  },

  primaryButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontFamily: "RobotoMedium",
  },

  switchButton: {
    marginTop: 16,
    alignItems: "center",
  },

  switchButtonText: {
    color: "#9fc2ff",
    fontSize: 12,
    fontFamily: "RobotoMedium",
  },
});
