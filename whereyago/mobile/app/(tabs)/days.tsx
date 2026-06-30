import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";

import { adventuresApi } from "../../src/api/adventures";
import { useAuth } from "../../src/auth/AuthContext";
import { Button } from "../../src/components/Button";
import { DayCard } from "../../src/components/DayCard";
import { tokens } from "../../src/theme/tokens";
import type { Adventure } from "../../src/types";

export default function MyDays() {
  const router = useRouter();
  const { token } = useAuth();
  const [days, setDays] = useState<Adventure[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setDays(await adventuresApi.list(token));
    } catch {
      // keep current list
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useFocusEffect(useCallback(() => void load(), [load]));

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
      contentContainerStyle={{ padding: tokens.space(4), flexGrow: 1 }}
      data={days}
      keyExtractor={(d) => String(d.id)}
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
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
        />
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No days yet — log the last great day you had.</Text>
          <Button title="Log a day" variant="ghost" onPress={() => router.push("/(tabs)/new")} />
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: tokens.color.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: tokens.color.background },
  empty: { flex: 1, justifyContent: "center", gap: tokens.space(4), paddingHorizontal: tokens.space(4) },
  emptyText: { color: tokens.color.textMuted, textAlign: "center" },
});
