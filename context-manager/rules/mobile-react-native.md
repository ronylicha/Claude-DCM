---
paths: "**/app/**/*.{tsx,ts}"
---
# React Native Mobile Rules

## Stack

- Expo 50/51+
- React Native 0.73+
- TypeScript (strict mode)
- Zustand (state management)
- TanStack Query (data fetching)
- React Navigation 6+
- Reanimated 3 (animations)
- Gesture Handler (gestures)

## Commands

```bash
npx expo start       # Start development
npx expo start --ios # iOS simulator
npx expo start --android # Android emulator
eas build            # Build production
eas submit           # Submit to stores
```

## Agents to Use

| Task | Agent |
|------|-------|
| General development, navigation | `react-native-dev` |
| UI components, animations | `react-native-ui` |
| API integration, cache, offline | `react-native-api` |
| Performance, debugging | `react-native-debug` |
| Full-stack with Supabase | `mobile-fullstack` |
| Design system, accessibility | `designer-ui-ux` |

## Backend Compatibility

| Backend | Agents to combine |
|---------|-------------------|
| Supabase | `supabase-*` + `react-native-*` |
| Laravel | `laravel-api` + `react-native-*` |

## Key Rules

- **ALWAYS** utiliser TypeScript strict pour les props et navigation params
- **ALWAYS** utiliser `StyleSheet.create()` - jamais de styles inline
- **ALWAYS** nettoyer les animations et subscriptions dans useEffect
- **ALWAYS** tester sur de vrais appareils (les simulateurs ne refletent pas les perfs reelles)
- **NEVER** utiliser `ScrollView` + `.map()` pour les listes longues - utiliser `FlatList`
- **NEVER** mutate state directement
- Create documentation in `.md` format (not OpenAPI)
- Test offline capabilities

---

## Styling - Regles

### StyleSheet.create (OBLIGATOIRE)

```tsx
const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#ffffff',
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    color: '#1a1a1a',
  },
});
```

### Styles Dynamiques

```tsx
<View style={[
  styles.card,
  variant === 'primary' ? styles.primary : styles.secondary,
  disabled && styles.disabled,
]} />
```

### Flexbox Layout

| Pattern | Style |
|---------|-------|
| Colonne (defaut) | `flexDirection: 'column', gap: 12` |
| Ligne | `flexDirection: 'row', alignItems: 'center', gap: 8` |
| Space between | `flexDirection: 'row', justifyContent: 'space-between'` |
| Centre | `flex: 1, justifyContent: 'center', alignItems: 'center'` |
| Remplir l'espace | `flex: 1` |

### Platform-Specific

```tsx
import { Platform, StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  card: {
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  text: {
    fontFamily: Platform.OS === 'ios' ? 'SF Pro Text' : 'Roboto',
  },
});
```

---

## Navigation - React Navigation 6+

### Typage des Routes (OBLIGATOIRE)

```tsx
type RootStackParamList = {
  Home: undefined;
  Detail: { itemId: string };
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
```

### Stack Navigator

```tsx
<NavigationContainer>
  <Stack.Navigator
    initialRouteName="Home"
    screenOptions={{
      headerStyle: { backgroundColor: '#6366f1' },
      headerTintColor: '#ffffff',
      headerTitleStyle: { fontWeight: '600' },
    }}
  >
    <Stack.Screen name="Home" component={HomeScreen} />
    <Stack.Screen
      name="Detail"
      component={DetailScreen}
      options={({ route }) => ({ title: `Item ${route.params.itemId}` })}
    />
  </Stack.Navigator>
</NavigationContainer>
```

### Tab Navigator

```tsx
<Tab.Navigator
  screenOptions={({ route }) => ({
    tabBarIcon: ({ focused, color, size }) => {
      const icons = {
        Home: focused ? 'home' : 'home-outline',
        Search: focused ? 'search' : 'search-outline',
        Profile: focused ? 'person' : 'person-outline',
      };
      return <Ionicons name={icons[route.name]} size={size} color={color} />;
    },
    tabBarActiveTintColor: '#6366f1',
    tabBarInactiveTintColor: '#9ca3af',
  })}
>
```

---

## Animations - Reanimated 3

### Valeurs Animees

```tsx
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

function AnimatedBox() {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = () => {
    scale.value = withSpring(1.2, {}, () => {
      scale.value = withSpring(1);
    });
  };

  return (
    <Pressable onPress={handlePress}>
      <Animated.View style={[styles.box, animatedStyle]} />
    </Pressable>
  );
}
```

### Regles Animations

- **TOUJOURS** executer les animations sur le UI thread (worklets)
- **TOUJOURS** nettoyer les animations dans useEffect
- Utiliser `withSpring` pour les animations naturelles
- Utiliser `withTiming` pour les animations lineaires
- `runOnUI` pour les operations sur le thread UI

---

## Gestures - Gesture Handler

### Pan Gesture

```tsx
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

function DraggableCard() {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  const gesture = Gesture.Pan()
    .onUpdate((e) => {
      translateX.value = e.translationX;
      translateY.value = e.translationY;
    })
    .onEnd(() => {
      translateX.value = withSpring(0);
      translateY.value = withSpring(0);
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.card, animatedStyle]} />
    </GestureDetector>
  );
}
```

### Gestion des Conflits

- Wrapper les gestures avec `GestureDetector`
- Utiliser `simultaneousHandlers` pour les gestures simultanees
- Composer avec `Gesture.Race()` ou `Gesture.Simultaneous()`

---

## Performance - Regles

### Listes (CRITIQUE)

| Pattern | Utiliser |
|---------|----------|
| Liste longue | `FlatList` avec `keyExtractor` |
| Grille | `FlatList` avec `numColumns` |
| Liste heterogene | `SectionList` |
| INTERDIT | `ScrollView` + `.map()` pour > 20 items |

```tsx
<FlatList
  data={items}
  keyExtractor={(item) => item.id}
  renderItem={({ item }) => <ItemCard item={item} />}
  getItemLayout={(data, index) => ({
    length: ITEM_HEIGHT,
    offset: ITEM_HEIGHT * index,
    index,
  })}
  removeClippedSubviews
  maxToRenderPerBatch={10}
  windowSize={5}
/>
```

### Optimisation des Composants

- `React.memo` pour les composants de liste
- `useCallback` pour les handlers passes en props
- Eviter les objets/arrays crees a chaque render dans les props
- Utiliser `useMemo` pour les calculs couteux

### Images

- Utiliser `expo-image` ou `react-native-fast-image`
- Specifier `width` et `height` pour eviter les layout shifts
- Utiliser des placeholder avec `blurhash`

### Safe Areas

- **TOUJOURS** utiliser `SafeAreaView` ou `useSafeAreaInsets`
- Tester sur les appareils avec notch/encoche

---

## Data Fetching - Patterns

### TanStack Query (recommande)

```tsx
function useProducts() {
  return useQuery({
    queryKey: ['products'],
    queryFn: fetchProducts,
    staleTime: 5 * 60 * 1000,
  });
}
```

### Offline-First

- Utiliser `@tanstack/query-persist-client-plugin` pour le cache offline
- Tester les scenarios sans connexion
- Afficher l'etat de connectivite a l'utilisateur

---

## TypeScript - Regles Mobile

- Typer tous les navigation params avec `ParamList`
- Typer les props de composants avec `interface`
- Utiliser les types de React Native (`ViewStyle`, `TextStyle`, `ImageStyle`)
- Strictement typer les reponses API

---

## Testing

- Jest + React Native Testing Library
- Tester le comportement utilisateur
- Mocker les modules natifs (`jest.mock('react-native-reanimated')`)
- Tester sur de vrais appareils avant release

---

## Problemes Courants

| Probleme | Solution |
|----------|----------|
| Conflit de gestures | `simultaneousHandlers` |
| Erreurs de types navigation | Definir `ParamList` pour tous les navigators |
| Jank d'animation | Deplacer sur le UI thread avec `runOnUI` |
| Memory leaks | Cleanup dans useEffect |
| Fonts custom | `expo-font` ou `react-native-asset` |
| Safe area | Tester sur appareils avec notch |
| Keyboard avoiding | `KeyboardAvoidingView` avec `behavior` platform-specific |

---

## Anti-Patterns (INTERDIT)

| Anti-Pattern | Correction |
|-------------|------------|
| Styles inline | `StyleSheet.create()` |
| `ScrollView` + `.map()` pour listes | `FlatList` |
| Animations sur le JS thread | Reanimated worklets (UI thread) |
| State mutation directe | Nouvelle reference (spread/map/filter) |
| `key={index}` dans FlatList | `keyExtractor={(item) => item.id}` |
| Ignorer Safe Areas | `SafeAreaView` / `useSafeAreaInsets` |
| Pas de types navigation | `ParamList` type pour chaque navigator |
| Images sans dimensions | Specifier `width` et `height` |
