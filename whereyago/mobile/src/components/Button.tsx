import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";

import { tokens } from "../theme/tokens";

interface ButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "danger";
}

export function Button({
  title,
  onPress,
  loading = false,
  disabled = false,
  variant = "primary",
}: ButtonProps) {
  const isPrimary = variant === "primary";
  const isDanger = variant === "danger";
  const textColor = isPrimary || isDanger ? tokens.color.primaryText : tokens.color.primary;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        isPrimary && styles.primary,
        isDanger && styles.danger,
        variant === "ghost" && styles.ghost,
        (pressed || disabled || loading) && styles.dim,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text style={[styles.text, { color: textColor }]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 50,
    borderRadius: tokens.radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: tokens.space(4),
  },
  primary: { backgroundColor: tokens.color.primary },
  danger: { backgroundColor: tokens.color.danger },
  ghost: { backgroundColor: "transparent", borderWidth: 1, borderColor: tokens.color.border },
  dim: { opacity: 0.65 },
  text: { fontSize: tokens.font.md, fontWeight: "600" },
});
