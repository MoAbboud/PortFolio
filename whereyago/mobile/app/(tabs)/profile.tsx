import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";

import { adventuresApi } from "../../src/api/adventures";
import { useAuth } from "../../src/auth/AuthContext";
import { Button } from "../../src/components/Button";
import { DayCard } from "../../src/components/DayCard";
import { tokens } from "../../src/theme/tokens";
import type { Adventure } from "../../src/types";

export default function Profile() {
  const router = useRouter();
  const { user, token, signOut } = useAuth();
  const [adventures, setAdventures] = useState<Adventure[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setAdventures(await adventuresApi.list(token));
    } catch {
      // keep current list
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(useCallback(() => void load(), [load]));

  const initial = (user?.display_name ?? user?.username ?? "?").slice(0, 1).toUpperCase();
  const shared = adventures.filter((a) => a.is_shared).length;

  const header = (
    <View>
      <View style={styles.card}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
        <Text style={styles.name}>{user?.display_name ?? user?.username ?? "You"}</Text>
        <Text style={styles.email}>{user?.email}</Text>

        <View style={styles.statsRow}>
          <Stat label="Adventures" value={adventures.length} />
          <View style={styles.divider} />
          <Stat label="Shared" value={shared} />
        </View>
      </View>
      <Text style={styles.section}>My adventures</Text>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.bg}
      contentContainerStyle={{ padding: tokens.space(4) }}
      data={adventures}
      keyExtractor={(a) => String(a.id)}
      ListHeaderComponent={header}
      renderItem={({ item }) => (
        <DayCard
          day={item}
          onPress={() =>
            router.push({
              pathname: "/day/[id]",
              params: { id: String(item.id), data: JSON.stringify(item) },
            })
          }
        />
      )}
      ListEmptyComponent={
        <Text style={styles.empty}>No adventures yet — tap the ➕ tab to log one.</Text>
      }
      ListFooterComponent={
        <View style={styles.footer}>
          <Button title="Log out" variant="ghost" onPress={() => void signOut()} />
        </View>
      }
    />
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: tokens.color.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: tokens.color.background },
  card: {
    backgroundColor: tokens.color.surface,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.color.border,
    padding: tokens.space(5),
    alignItems: "center",
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: tokens.color.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: tokens.space(3),
  },
  avatarText: { color: tokens.color.primaryText, fontSize: tokens.font.xxl, fontWeight: "800" },
  name: { fontSize: tokens.font.xl, fontWeight: "800", color: tokens.color.text },
  email: { color: tokens.color.textMuted, marginTop: 2 },
  statsRow: { flexDirection: "row", alignItems: "center", marginTop: tokens.space(4), gap: tokens.space(5) },
  stat: { alignItems: "center" },
  statValue: { fontSize: tokens.font.xl, fontWeight: "800", color: tokens.color.primary },
  statLabel: { color: tokens.color.textMuted, fontSize: tokens.font.sm },
  divider: { width: 1, height: 32, backgroundColor: tokens.color.border },
  section: { fontSize: tokens.font.lg, fontWeight: "700", color: tokens.color.text, marginTop: tokens.space(6), marginBottom: tokens.space(3) },
  empty: { color: tokens.color.textMuted, textAlign: "center", marginTop: tokens.space(6) },
  footer: { marginTop: tokens.space(6) },
});
