import { Redirect, Tabs } from "expo-router";
import { Pressable, Text } from "react-native";

import { useAuth } from "../../src/auth/AuthContext";
import { tokens } from "../../src/theme/tokens";

export default function TabsLayout() {
  const { token, loading, signOut } = useAuth();

  if (loading) return null;
  if (!token) return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: tokens.color.primary,
        headerRight: () => (
          <Pressable onPress={() => void signOut()} style={{ paddingHorizontal: tokens.space(4) }}>
            <Text style={{ color: tokens.color.primary, fontWeight: "600" }}>Log out</Text>
          </Pressable>
        ),
      }}
    >
      <Tabs.Screen name="discover" options={{ title: "Discover" }} />
      <Tabs.Screen name="days" options={{ title: "My Days" }} />
      <Tabs.Screen name="new" options={{ title: "Log a Day" }} />
    </Tabs>
  );
}
