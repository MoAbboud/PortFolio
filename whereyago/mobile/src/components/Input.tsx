import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";

import { tokens } from "../theme/tokens";

interface InputProps extends TextInputProps {
  label?: string;
}

export function Input({ label, style, ...rest }: InputProps) {
  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={tokens.color.textMuted}
        style={[styles.input, style]}
        {...rest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: tokens.space(4) },
  label: {
    fontSize: tokens.font.sm,
    fontWeight: "600",
    color: tokens.color.text,
    marginBottom: tokens.space(1.5),
  },
  input: {
    backgroundColor: tokens.color.surface,
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space(3.5),
    height: 48,
    fontSize: tokens.font.md,
    color: tokens.color.text,
  },
});
