# CBT App — Frontend Design Guidelines

This is a CBT (Cognitive Behavioural Therapy / Computer-Based Testing) app UI redesign.
Follow every rule in this file precisely. Do not deviate without explicit instruction.

---

## 🎨 Design Reference

The UI must be redesigned to match the aesthetic of the provided Google Drive redesign concept (Jessica Cipriano). Study these properties and replicate them faithfully:

### Color Palette (use as CSS variables)
```css
--primary: #1A73E8;          /* Bold blue — dominant brand color */
--primary-dark: #1557B0;     /* Darker blue for sidebar background */
--primary-light: #E8F0FE;    /* Soft blue tint for hover/active states */
--accent: #FFFFFF;           /* White cards and content areas */
--text-primary: #202124;     /* Near-black for headings and labels */
--text-secondary: #5F6368;   /* Grey for subtitles, metadata */
--text-on-primary: #FFFFFF;  /* White text on blue backgrounds */
--border: #E0E0E0;           /* Subtle card/table borders */
--bg: #F8F9FA;               /* Light grey page background */
--sidebar-bg: #1A56C4;       /* Deep blue sidebar */
--shadow-card: 0 2px 8px rgba(0,0,0,0.08);
--shadow-hover: 0 6px 20px rgba(26,115,232,0.18);
--radius-card: 16px;
--radius-btn: 10px;
--radius-pill: 50px;
```

### Typography
- **Headings**: `DM Sans` or `Plus Jakarta Sans` (bold, clean, modern — not Inter)
- **Body / Labels**: `Nunito` or `Figtree`
- **Never use**: Inter, Roboto, Arial, system-ui

### Layout Structure
The app must adopt a **sidebar layout** for web/desktop views:

```
┌─────────────────────────────────────────────────┐
│  SIDEBAR (fixed, left, deep blue)               │
│  - App logo / brand name at top                 │
│  - Primary CTA button (e.g. "Start New Exam")   │
│  - Nav links with icons (My Exams, Categories,  │
│    Recent, Starred, Trash, Settings, etc.)      │
│  - Progress / stats detail at bottom            │
│  - User profile at very bottom                  │
├─────────────────────────────────────────────────┤
│  TOPBAR (white, subtle shadow)                  │
│  - Search bar (centered, rounded pill)          │
│  - Notification icon, Help icon, Settings icon  │
│  - User avatar (right side)                     │
├─────────────────────────────────────────────────┤
│  MAIN CONTENT AREA (light grey bg)              │
│  - Page title + icon                            │
│  - Quick Access / Recent Exams section (cards)  │
│  - All Exams list (table style)                 │
└─────────────────────────────────────────────────┘
```

**IMPORTANT**: Any content currently in the app's `<nav>` or `<header>` (navigation links, user info, category filters, etc.) must be moved into the sidebar. The header should only contain: search bar, notification/settings icons, and user avatar.

---

## 🃏 Exam Cards (Critical — Match Reference Exactly)

Exam cards must look like the "Quick Access" folder cards in the reference image:

- **Shape**: Rounded rectangle, `border-radius: 16px`, white background, subtle box shadow
- **Top section**: Solid blue (`--primary`) rounded area with decorative abstract blob shapes layered inside — use CSS `clip-path`, organic `border-radius` values, or pseudo-elements to create the bubbly, overlapping shape decorations seen in the reference
- **Card content**:
  - Small caps label at top (e.g. `CATEGORY`, `SUBJECT`)
  - Exam title in bold below
  - Metadata row: last attempt date, number of questions, score badge
- **Hover state**: `transform: translateY(-3px)` + stronger shadow
- **The featured/first card** must use full `--primary` blue background with white text — larger than others
- Each card must have a unique blob shape composition — no two cards look identical

### Card Decorative Blob Shapes (CSS)
```css
.card-header::before,
.card-header::after {
  content: '';
  position: absolute;
  background: rgba(255,255,255,0.15);
  border-radius: 50% 30% 60% 40% / 40% 60% 30% 50%;
}
/* Vary size, position, and border-radius per card for uniqueness */
```

---

## 📋 Exam List Table

Replicate the "All Files" table from the reference for the exam/question list:

- Columns: **Name** | **Category** | **Last Attempted** | **Score** | **Actions**
- Colored file-type icon left of each row name
- Row hover: `background: var(--primary-light)`
- Action icons right side: share icon + `...` menu (use Lucide icons)
- No heavy borders — bottom border only (`1px solid var(--border)`)
- Column headers: small uppercase, letter-spaced, `--text-secondary`

---

## 🔘 Buttons & Controls

- **Primary CTA**: White text, `--primary` background, pill shape, bold label, shadow
- **Secondary**: Outlined blue border, blue text, white background
- **Icon buttons** (topbar): Circular, light grey bg, hover fills `--primary-light`
- **View toggle** (grid/list): Two small icon buttons, active one highlighted blue

---

## 🔷 Sidebar Specs

- Background: `--sidebar-bg` (deep blue `#1A56C4`)
- Active nav item: White background pill, blue icon + dark text
- Inactive nav item: Semi-transparent white text + icon, subtle hover
- CTA button at top: White bg, blue bold text, pill shape, full-width
- Bottom: Progress bars / stats in lighter blue tones, upgrade/settings link
- Width: `240px` desktop, icon-only collapse on mobile

---

## 🖼 Icons

- Use **Lucide React** or **Phosphor Icons** — never emojis for UI
- Sidebar icons: 20px, consistent stroke weight
- Topbar icons: 18–20px inside circular button containers
- Table file-type icons: colored SVGs (blue = .doc, green = .xlsx, red = .pdf, orange = .jpg)

---

## 📐 Spacing & Layout

- Card grid gap: `16px`, min card width `200px`, CSS grid responsive
- Main content padding: `32px` desktop / `16px` mobile
- Section titles: uppercase, letter-spaced, `12px`, `--text-secondary`
- Quick Access row has right chevron `>` for "see all"
- Topbar height: `64px` sticky
- Sidebar: `100vh` fixed

---

## ✅ Preserving Existing CBT App Functionality

When restyling, the following MUST be preserved — only visuals change:

- All existing routes and page structure
- Exam categories and filtering logic
- User authentication and profile display
- Exam attempt history and scoring data
- Timer functionality on exam pages
- Question navigation (prev/next, flagging questions)
- Results and analytics views
- All existing state management and API calls

**Do NOT remove or break any functionality — only restyle.**

---

## 📸 Screenshot-Driven Development

### Verification Loop
- After every significant UI change, use **Playwright MCP** to take a screenshot
- Navigate to local dev server (e.g. `localhost:3000`) and call `browser_take_screenshot`
- Compare screenshot against the reference image — identify every deviation
- Fix and re-screenshot — loop until it matches the reference
- Never mark a task complete without screenshot verification

### Replicating Reference Screenshots
- Treat any provided screenshot as a **pixel-level spec**
- Match: layout, spacing, border-radius, shadows, colors, font weights, icon placement, proportions
- Do not improvise or "improve" the reference design
- If ambiguous, match as closely as possible

---

## ❌ Never Do

- Use Inter, Roboto, Arial, or system fonts
- Use emojis as UI icons
- Keep nav links in the top header — they belong in the sidebar
- Use purple gradients or generic SaaS dashboard aesthetics
- Use flat card designs without the decorative blob shapes
- Break or remove any existing app functionality while restyling
- Assume UI looks correct without taking a screenshot first

---

## 🎓 Student Dashboard — Three-Panel Exam Layout

The student dashboard uses a **chat-app inspired three-panel layout** (based on the CMAR reference screenshot). This replaces the traditional card grid for students browsing exams.

### Overall Structure
```
┌──────────┬──────────────────────────┬────────────────────┐
│ NAV      │  EXAM LIST PANEL         │  EXAM DETAIL ASIDE │
│ SIDEBAR  │  (left, scrollable)      │  (right, fixed)    │
│          │                          │                    │
│ (deep    │  Search/filter bar       │  Student name/pic  │
│  blue,   │  ─────────────────────   │  ────────────────  │
│  fixed)  │  Grouped exam rows:      │  Term              │
│          │  - Subject + Term badge  │  Subject           │
│          │  - "3rd Term · 40 Qs"   │  Duration          │
│          │  - Status dot            │  No. of Questions  │
│          │  ─────────────────────   │  Pass Mark         │
│          │                          │  Status badge      │
│          │  CENTER PANEL            │  Deadline          │
│          │  ──────────────────────  │                    │
│          │  Exam title + subject    │                    │
│          │  Full instructions       │                    │
│          │  [ Start Exam ] CTA      │                    │
│          │  [ Practice Mode ]       │                    │
│          │  Past attempts history   │                    │
└──────────┴──────────────────────────┴────────────────────┘
```

### Left Panel — Exam List
- Width: `~280px`, fixed, independently scrollable
- Background: White, subtle right border (`1px solid var(--border)`)
- Top: pill-shaped search bar (light grey bg) + filter/sort dropdown
- **Exam rows are LIST ITEMS — not cards**:
  - Colored subject icon (Lucide) + bold subject name + Term pill badge
  - Subtitle: e.g. `"3rd Term · 40 questions"`
  - Right: status dot (green = available, grey = upcoming, orange = attempted)
  - Selected row: `--primary-light` bg + `3px solid var(--primary)` left border
  - Hover: subtle `--primary-light` tint
  - Rows grouped by term/subject with sticky uppercase grey group headers
  - Separated by `1px` bottom border only — no card borders

### Center Panel — Exam View
- Background: `var(--bg)` light grey
- Default empty state: illustration + "Select an exam to get started"
- When exam selected:
  - Large bold exam title + subject/term breadcrumb
  - Divider
  - Full instructions in readable body text
  - **"Start Exam"** — large pill button, `--primary` blue, prominent
  - **"Practice Mode"** — secondary outlined button below (if applicable)
  - Previous attempts section: date, score, duration as a compact list

### Right Aside — Exam Metadata
- Width: `~260px`, fixed, white bg, subtle left border
- Student profile pic + name at very top (like the reference screenshot)
- Divider
- Metadata rows with Lucide icons (16px, blue) + label + value:
  - Term | Subject | Duration | Number of Questions | Pass Mark | Status | Deadline
  - Label: `--text-secondary`, small | Value: bold, `--text-primary`
  - Thin divider between each row

### Interaction Rules
- Clicking an exam row simultaneously:
  1. Highlights that row (blue left border + light bg)
  2. Loads exam instructions + actions in center panel
  3. Loads exam metadata in right aside
- All three panels update without page navigation (SPA — no full reload)
- Mobile: collapse to single-panel with back button navigation between panels

---

## 📱 Mobile Responsiveness

Every view must be fully responsive. Use these breakpoints:

```css
/* Breakpoints */
--bp-mobile:  480px;   /* Small phones */
--bp-tablet:  768px;   /* Tablets / large phones landscape */
--bp-desktop: 1024px;  /* Laptops and up */
--bp-wide:    1280px;  /* Wide desktop */
```

### Mobile Layout Rules (< 768px)

**Sidebar:**
- Hidden off-screen by default (`transform: translateX(-100%)`)
- Opens as a **slide-in drawer** from the left on hamburger menu tap
- Overlay/scrim darkens the content area behind it when open
- Close on tap outside or on the X button
- Full width on small phones (`100vw`), `280px` on larger phones

**Topbar (mobile):**
- Shows: hamburger menu icon (left) + app logo (center) + avatar/notification (right)
- Search bar collapses to a search icon — tapping it expands a full-width search bar below the topbar
- Height: `56px` on mobile

**Teacher Dashboard (mobile):**
- **Quick Access is NOT shown in the main content area on mobile** — it is moved into the sidebar drawer
  - Inside the mobile sidebar drawer, add a "Quick Access" section below the nav links
  - Render the Quick Access exam cards as a compact vertical list within the drawer (icon + name + term badge per row)
  - Tapping a Quick Access item closes the drawer and navigates to that exam
- Exam list table: collapses to a stacked card list — each row becomes a compact card showing name, date, score badge, and action `...` menu
- Hide less important table columns (Category, File Size) — show only Name + Last Modified + Score

**Student Dashboard — Three-Panel (mobile):**
- All three panels stack into a **single-panel view with navigation**:
  1. Default view: Exam List panel (full screen)
  2. Tapping an exam row: slides to Center Panel (full screen) with a `← Back` button top-left
  3. Tapping an info/details icon: slides to Right Aside (full screen) with a `← Back` button
- Use CSS transitions (`transform: translateX`) for smooth panel sliding — not page reloads
- Bottom navigation bar (mobile only): icons for Home, My Exams, Results, Profile
  - `56px` tall, white bg (light) / `--dm-surface` (dark), subtle top border
  - Active icon: `--primary` blue fill

**Exam / Question Page (mobile):**
- Timer: sticky at top, always visible
- Question text: full width, large readable font (`18px minimum`)
- Answer options: stacked full-width buttons — no grid layout
- Navigation (prev/next/flag): fixed bottom bar, always visible
- Flag button clearly labeled, not hidden in a menu

### Tablet Layout (768px – 1024px)

**Sidebar:**
- Collapsed to icon-only by default (`64px` wide)
- Hovering or tapping expands to full `240px` with labels
- Does not overlay content — pushes content area

**Student Dashboard:**
- Two panels visible: Exam List (left, `260px`) + Center Panel (rest of width)
- Right Aside hidden — its content folds into the bottom of the center panel as a collapsible "Exam Details" accordion section

**Teacher Dashboard:**
- Cards: 2-column grid
- Table: all columns visible, slightly reduced padding

### Touch & Interaction (Mobile)
- All tap targets: minimum `44px × 44px`
- Swipe right on the main content area to open the sidebar drawer
- Swipe left on center panel (student dashboard) to open right aside
- No hover-only states — ensure all hover interactions have tap equivalents
- Use `active:` states for buttons (slight scale down: `transform: scale(0.97)`)

---

## 🌙 Dark Mode

Dark mode is a **first-class feature** — not an afterthought. It must be implemented using CSS custom properties and toggled via a class on `<html>` or `<body>` (e.g. `class="dark"`). Respect `prefers-color-scheme` as the default, with a manual toggle override saved to `localStorage`.

### Dark Mode Color Palette

```css
[data-theme="dark"] {
  /* Backgrounds — layered depth */
  --bg:              #0F1117;   /* Deepest — page background */
  --dm-surface:      #1A1D27;   /* Cards, panels, sidebar */
  --dm-surface-2:    #22263A;   /* Elevated cards, modals, dropdowns */
  --dm-surface-3:    #2C3150;   /* Hover states, selected rows */

  /* Sidebar */
  --sidebar-bg:      #111827;   /* Very dark navy — not pure black */

  /* Primary brand blue — stays the same, slightly brightened */
  --primary:         #4D8EF0;
  --primary-dark:    #1A73E8;
  --primary-light:   #1E2D4A;   /* Muted blue tint for hover in dark mode */

  /* Text */
  --text-primary:    #E8EAED;   /* Near-white for headings */
  --text-secondary:  #9AA0AC;   /* Muted grey for labels, metadata */
  --text-on-primary: #FFFFFF;

  /* Borders */
  --border:          #2E3347;   /* Subtle dark borders */

  /* Shadows — more glow-based in dark mode */
  --shadow-card:     0 2px 12px rgba(0,0,0,0.4);
  --shadow-hover:    0 6px 24px rgba(77,142,240,0.2);

  /* Status colors — slightly desaturated for dark bg */
  --success:         #34A853;
  --warning:         #F9AB00;
  --danger:          #EA4335;
}
```

### Dark Mode — Component Rules

**Sidebar (dark mode):**
- Background: `--sidebar-bg` (`#111827`) — very dark navy, NOT pure black
- Active nav item: `--dm-surface-2` background pill, `--primary` blue icon, `--text-primary` label
- Inactive nav item: `--text-secondary` icon and label, hover adds `--dm-surface-3` bg
- CTA button: `--primary` blue background, white text (inverted from light mode)
- Dividers: `--border`

**Topbar (dark mode):**
- Background: `--dm-surface` (`#1A1D27`)
- Bottom border: `1px solid var(--border)`
- Search bar: `--dm-surface-2` background, `--text-secondary` placeholder, white text on focus
- Icon buttons: `--dm-surface-2` bg, `--text-secondary` icon color

**Cards (dark mode):**
- Background: `--dm-surface`
- Card header (blue section): Keep `--primary` blue but slightly darker/muted (`#1557B0`)
- Blob shapes: `rgba(255,255,255,0.08)` — more subtle than light mode
- Text: `--text-primary` for titles, `--text-secondary` for metadata
- Border: `1px solid var(--border)`
- Shadow: `--shadow-card`

**Exam List Rows (dark mode — student dashboard):**
- Default bg: `--dm-surface`
- Hover: `--dm-surface-3`
- Selected: `--primary-light` (`#1E2D4A`) + `3px solid var(--primary)` left border
- Group headers: `--text-secondary`
- Dividers: `--border`

**Right Aside (dark mode):**
- Background: `--dm-surface`
- Left border: `1px solid var(--border)`
- Metadata row icons: `--primary` blue
- Labels: `--text-secondary` | Values: `--text-primary` bold

**Tables (dark mode):**
- Background: `--dm-surface`
- Row hover: `--dm-surface-3`
- Column headers: `--text-secondary`
- Row dividers: `--border`

**Buttons (dark mode):**
- Primary CTA: `--primary` background (`#4D8EF0`), white text — same as light
- Secondary: `--border` border, `--primary` text, transparent background
- Icon buttons: `--dm-surface-2` bg, `--text-secondary` icon

**Modals / Dropdowns (dark mode):**
- Background: `--dm-surface-2`
- Border: `1px solid var(--border)`
- Shadow: `0 8px 32px rgba(0,0,0,0.6)`

### Dark Mode Toggle
- Toggle button: moon/sun icon (Lucide `Moon` / `Sun`), placed in the topbar near the user avatar
- Saves preference to `localStorage` key `"theme"`
- On load: check `localStorage` first, then fall back to `prefers-color-scheme`
- Smooth transition on toggle: `transition: background-color 0.2s ease, color 0.2s ease` on `body`
- Do NOT flash on page load — apply theme class before first paint (use inline script in `<head>`)

### Dark Mode — What NOT to Do
- Never use pure black (`#000000`) as a background — use layered dark navies
- Never use pure white text (`#FFFFFF`) for body text — use `#E8EAED`
- Never invert images or icons — use `filter: none` on dark mode icons
- Never keep light-mode shadows (they disappear on dark bg) — replace with glow shadows
- Never use the same blue hover tint (`#E8F0FE`) in dark mode — use `#1E2D4A` instead
- Ensure all text passes WCAG AA contrast ratio on dark backgrounds