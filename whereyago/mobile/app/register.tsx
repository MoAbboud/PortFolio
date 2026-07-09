import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Text } from "react-native";

import { ApiError } from "../src/api/client";
import { useAuth } from "../src/auth/AuthContext";
import { Button } from "../src/components/Button";
import { Input } from "../src/components/Input";
import { Screen } from "../src/components/Screen";
import { tokens } from "../src/theme/tokens";

export default function Register() {
  const { signUp } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!email || !username || password.length < 8) {
      Alert.alert("Check your details", "Email, a username, and a password of at least 8 characters are required.");
      return;
    }
    setLoading(true);
    try {
      await signUp(email.trim(), username.trim(), password);
      router.replace("/(tabs)/home");
    } catch (error) {
      Alert.alert("Sign up failed", error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen scroll>
      <Text style={styles.logo}>Create your account</Text>

      <Input
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="you@example.com"
      />
      <Input
        label="Username"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        placeholder="yourname"
      />
      <Input
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="at least 8 characters"
      />
      <Button title="Sign up" onPress={submit} loading={loading} />

      <Link href="/login" style={styles.link}>
        Already have an account? Log in
      </Link>
    </Screen>
  );
}

const styles = StyleSheet.create({
  logo: { fontSize: tokens.font.xl, fontWeight: "800", color: tokens.color.text, marginTop: tokens.space(8), marginBottom: tokens.space(6) },
  link: { color: tokens.color.primary, textAlign: "center", marginTop: tokens.space(5), fontWeight: "600" },
});
