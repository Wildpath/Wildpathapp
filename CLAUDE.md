# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Server

```bash
python3 -m http.server 5500
```

Open `http://localhost:5500/wildpath.html`. No build step, no npm, no transpilation — the app runs directly as static files.

## Repository Structure

Four files comprise the entire application:

| File | Lines | Purpose |
|---|---|---|
| `wildpath.html` | ~2,000 | Single HTML document — login overlay, every screen, every overlay/modal |
| `app.js` | ~10,900 | All JavaScript logic, state, event handlers, screen builders |
| `data.js` | ~573 | Hard-coded `spots` array (5 California demo locations with full metadata) |
| `styles.css` | ~1,450 | Design system variables, animations, component styles |

Backup files (`wildpath.html.bak2`, `wildpath.html.bak3`) can be ignored.

## Architecture

**No backend, no build tools, no modules.** All data lives in `localStorage`. External APIs: Mapbox GL JS v3.6.0 (map rendering), Nominatim (geocoding/autocomplete), Open-Meteo (weather), Overpass API (OSM trails/peaks).

### Screen Navigation

`showTab(tabName)` hides all screens then shows the target. Screens are `<div class="screen">` elements with IDs: `screen-home`, `map-screen`, `community-screen`, `profile-screen`, `explore-screen`. Overlays (detail page, modals) use `position:absolute` inside their parent screen.

### Data Persistence

All state is stored in `localStorage` using the `CK` constant object defined around line 6886 of `app.js`:

```js
const CK = {
  posts: 'wildpath-posts',
  communities: 'wildpath-communities',
  messages: 'wildpath-messages',
  follows: 'wildpath-follows',
  notifs: 'wildpath-notifications',
  profiles: 'wildpath-user-profiles',
  // ... etc
};
```

Use the typed helpers — never call `localStorage` directly:
- `getPosts()` / `setPosts(arr)` — feed posts
- `getCommunities()` / `setCommunities(arr)` — community list
- `getMessages()` / `setMessages(obj)` — DM conversations keyed by `uid1__uid2`
- `getUserProfile(uid)` / `setUserProfile(uid, data)` — per-user profiles
- `_cgGet(key)` / `_cgSet(key, val)` — raw JSON localStorage wrappers used by the above

### Spot Data

`spots` (from `data.js`) + `userSpots` (from `localStorage('wp_user_spots')`) are always spread together: `[...spots, ...userSpots]`. Each spot has: `id`, `name`, `lat`/`lng`, `type`, `heroGradient`, `rating`, `difficulty`, `permits`, `weather`, `reviews_data`, `gear`, `hazards`, `insiderTips`, and more.

### Auth

On load, `window.onload` checks `wildpath-current-user` and `wildpath-guest` in localStorage. Logged-in state is accessed via `_currentUser` (the parsed user object) and `_myUid()` (returns the user's `id`). `isGuest()` returns true for unauthenticated visitors.

## CSS Design System

Custom properties in `styles.css`:

```css
--bg0: #161916   /* darkest background */
--bg1: #1C201C
--bg2: #222822
--bg3: #2A302A
--accent: #B8E87A  /* lime green — primary CTA color */
--txt0: #F0EDE8   /* primary text */
--txt1: #C8C4BC
--txt2: #8A887F
--txt3: #545250   /* muted/disabled */
--nav-h: 72px     /* bottom nav height — use in calc() for safe areas */
--r: 16px         /* standard border-radius */
```

## Key Patterns

**Adding a new screen overlay:** Use `position:absolute;inset:0;z-index:NNN;display:none;flex-direction:column` — show/hide by toggling `style.display` between `'none'` and `'flex'`. Z-index layers: bottom-nav=200, screen overlays=300, community pages=500–560, auth=99999.

**Community full-page slides:** Elements with class `comm-full-page` use CSS `transform:translateX(100%)` and gain class `open` to slide in. See `.comm-full-page` in `styles.css`.

**Feed (TikTok-style):** `_feedPosts[]` array, `_feedPostIdx` (current post), `_feedMediaIdx` (current slide within post). `_renderFeedPost(idx)` redraws the active post. `_buildFeedSlides(post)` builds horizontal slides including a Mapbox map slide as the last slide when `post.spotId` exists. `_updateFeedDots(total, current, hasMapSlide)` renders dot indicators with a map-pin SVG for the last dot when the post has a location.

**Map:** The Mapbox GL JS map instance is `map` (global). `leafletMap` is a compatibility shim that translates Leaflet-style API calls (`.flyTo`, `.fitBounds`) to Mapbox equivalents. Always use `[...spots, ...userSpots]` when querying spot data.

## Git Workflow Rules

Remote: `https://github.com/Wildpath/Wildpathapp.git` (branch: `main`)

**After every successful change** (bug fix, feature, design update) — commit with a clear descriptive message and push immediately. Do not wait to be asked.

**Before any large or risky change** — commit the current working state first so there is always a safe checkpoint.

**If the user reports something is broken** — immediately offer to revert to the last working commit before debugging.

**Never end a session with uncommitted working code** — always commit and push before finishing.

Commit message format: short imperative phrase describing what changed (e.g. `Fix feedToggleSave saving posts without spotId`, `Remove Trip Planner feature`, `Add Explore tab to bottom nav`).
