# 📍 whereyago — Mobile App

The whereyago interface: an **Expo + React Native + TypeScript** app (file-based routing via expo-router) that talks to the [backend API](../backend). This is the thing users actually tap — it replaces the curl/Swagger testing.

## 🧱 Architecture

Clean layers, same spirit as the backend:

```
app/                       expo-router screens (the "pages")
  _layout.tsx              providers (Auth, SafeArea) + navigation stack
  index.tsx                redirects to login or the tabs based on session
  login / register         auth screens
  (tabs)/                  Discover · My Days · Log a Day
  day/[id].tsx             day detail (itinerary + Google Maps links)

src/
  api/      client.ts      ← the ONLY place that calls fetch (typed, adds auth header)
            auth.ts days.ts ← one function per endpoint, fully typed
  auth/     AuthContext.tsx ← session state; JWT stored in the secure keychain
  components/               ← reusable UI (Button, Input, Screen, DayCard)
  theme/    tokens.ts        ← design tokens = your single "skin" (see Rebranding)
  config.ts logger.ts types.ts
```

Why it's set up this way: screens never call `fetch` directly — they call typed functions in `src/api`, which go through one `request()` helper. Swap the backend, add a header, or change error handling in **one file**.

## 🔐 Config & security
- The API URL comes from `EXPO_PUBLIC_API_URL` (see `.env.example`) — **not hard-coded**. It's not a secret.
- The auth **token is stored in the device keychain** via `expo-secure-store`, never plain storage.
- No passwords or tokens are ever logged.

## 🚀 Run it

**Prerequisites:** the backend running (`cd ../backend && docker compose up`) and the **Expo Go** app on your phone (App Store / Play Store).

```bash
cd whereyago/mobile
cp .env.example .env
# Edit .env → set EXPO_PUBLIC_API_URL (see the gotcha below)
npm install        # already done if you scaffolded here
npx expo start     # press the keys it shows, or scan the QR with Expo Go
```

### ⚠️ The #1 gotcha: `localhost` won't work from your phone
Your phone is a *different device* than your computer, so `localhost` on the phone means the phone — not your PC. Point `EXPO_PUBLIC_API_URL` at your computer's address:

| Running on | `EXPO_PUBLIC_API_URL` |
|---|---|
| **Physical phone (Expo Go)** | `http://<YOUR-PC-LAN-IP>:8000/api/v1` — e.g. `http://192.168.1.50:8000/api/v1` |
| Android emulator | `http://10.0.2.2:8000/api/v1` |
| iOS simulator | `http://localhost:8000/api/v1` |

Find your PC's LAN IP with `ipconfig` (look for "IPv4 Address", usually `192.168.x.x`). Your phone and PC must be on the **same Wi-Fi**. After changing `.env`, restart `npx expo start`.

## 🎨 Rebranding (your custom theme)
Open [`src/theme/tokens.ts`](src/theme/tokens.ts) and change the values — start with `color.primary`. Every screen and component reads from there, so the whole app reskins at once. Fonts, spacing, and corner radius live in the same file. (This is the "unique brand" layer you wanted — we can build it out into full light/dark themes whenever you're ready.)

## 📜 Scripts
```bash
npm start          # expo start
npm run android    # open on Android
npm run ios        # open on iOS (macOS only)
npm run typecheck  # tsc --noEmit
```

## 🗺️ What's here vs. next
**Working now:** register/login (secure token), Discover feed, My Days, Log a Day (title, vibe, stops), Day detail with per-stop **Google Maps reviews/directions** links, delete your own day, logout.

**Next:**
- An **interactive map** on the day detail (`react-native-maps`) — deferred for now because it needs a Google Maps key on Android; the screen currently deep-links to Google Maps instead (free, no key).
- "Share to Discover" (needs a small backend endpoint to flip `is_shared`).
- Live weather + place autocomplete when logging a day.
- App icon & splash screen, then a build via EAS.
