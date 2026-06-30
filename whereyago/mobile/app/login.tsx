import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Text } from "react-native";

import { ApiError } from "../src/api/client";
import { useAuth } from "../src/auth/AuthContext";
import { Button } from "../src/components/Button";
import { Input } from "../src/components/Input";
import { Screen } from "../src/components/Screen";
import { tokens } from "../src/theme/tokens";

export default function Login() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!email || !password) {
      Alert.alert("Missing info", "Enter your email and password.");
      return;
    }
    setLoading(true);
    try {
      await signIn(email.trim(), password);
      router.replace("/(tabs)/discover");
    } catch (error) {
      Alert.alert("Login failed", error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen scroll>
      <Text style={styles.logo}>whereyago</Text>
      <Text style={styles.subtitle}>Days worth copying.</Text>

      <Input
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="you@example.com"
      />
      <Input
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="••••••••"
      />
      <Button title="Log in" onPress={submit} loading={loading} />

      <Link href="/register" style={styles.link}>
        No account? Sign up
      </Link>
    </Screen>
  );
}

const styles = StyleSheet.create({
  logo: { fontSize: tokens.font.xxl, fontWeight: "800", color: tokens.color.text, marginTop: tokens.space(8) },
  subtitle: { color: tokens.color.textMuted, marginBottom: tokens.space(8), fontSize: tokens.font.md },
  link: { color: tokens.color.primary, textAlign: "center", marginTop: tokens.space(5), fontWeight: "600" },
});
