import React from 'react';
import { View, Text } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

// Barra de navegación inferior para los menús generales de la app.
// Los menús de cada finca viven en las pantallas de la finca (parte superior),
// fuera de este layout de pestañas.
export default function GeneralTabsLayout() {
  const c = useColors();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.mutedForeground,
        tabBarStyle: {
          backgroundColor: c.card,
          borderTopColor: c.border,
        },
        tabBarLabelStyle: {
          fontFamily: 'Inter_500Medium',
          fontSize: 11,
        },
        tabBarIcon: ({ color, focused }) => {
          const icon = route.name === 'index' ? 'home' : 'grid';
          return (
            <View
              style={{
                alignItems: 'center',
                justifyContent: 'center',
                width: 36,
                height: 28,
                borderRadius: 14,
                backgroundColor: focused ? c.primaryTint : 'transparent',
              }}
            >
              <Feather name={icon} size={20} color={color} />
            </View>
          );
        },
      })}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Fincas',
          tabBarIcon: ({ color, focused }) => (
            <View
              style={{
                alignItems: 'center',
                justifyContent: 'center',
                width: 40,
                height: 30,
                borderRadius: 15,
                backgroundColor: focused ? c.primaryTint : 'transparent',
              }}
            >
              <Feather name="home" size={21} color={color} />
            </View>
          ),
        }}
      />
    </Tabs>
  );
}
