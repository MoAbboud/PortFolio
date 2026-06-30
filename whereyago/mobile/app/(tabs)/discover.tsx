import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";

import { adventuresApi } from "../../src/api/adventures";
import { DayCard } from "../../src/components/DayCard";
import { tokens } from "../../src/theme/tokens";
import type { Adventure } from "../../src/types";

export default function Discover() {
  const router = useRouter();
  const [days, setDays] = useState<Adventure[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setDays(await adventuresApi.discover());
    } catch {
      // keep current list; pull to retry
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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
      contentContainerStyle={{ padding: tokens.space(4) }}
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
      ListHeaderComponent={<Text style={styles.lead}>Days other people loved. Tap one, then go live it.</Text>}
      ListEmptyComponent={<Text style={styles.empty}>No shared days yet. Log one and share it to inspire others!</Text>}
    />
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: tokens.color.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: tokens.color.background },
  lead: { color: tokens.color.textMuted, marginBottom: tokens.space(4) },
  empty: { color: tokens.color.textMuted, textAlign: "center", marginTop: tokens.space(10) },
});
