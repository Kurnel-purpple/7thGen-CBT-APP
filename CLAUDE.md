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

---

## 📝 Create Exam Modal (Desktop & Tablet Only)

The Create Exam modal follows the multi-step form aesthetic from the Web Forms reference (clean white card, stepped progress indicator at top, structured field rows). Use the existing dashboard color scheme — NOT the orange from the reference image.

### Modal Shell
- White background card, `border-radius: 20px`, large shadow (`0 16px 48px rgba(0,0,0,0.14)`)
- Max width: `720px`, centered on screen with a dark scrim overlay behind
- Modal header: title ("Create Exam") left-aligned, close `×` icon top-right (Lucide `X`)
- Multi-step progress indicator directly below the header (see Steps Chain below)
- Scrollable content area below the steps chain
- Sticky footer with "Save & Continue" / "Back" buttons at the bottom of the modal

### Steps Progress Chain (Desktop & Tablet)
Replicate the "Basic Details — Contact Details — Verification" chain from the reference image, adapted for exam creation steps. Style rules:
- Horizontal chain of steps connected by a line
- Each step has an **icon above** (not a number) — use a Lucide dropdown/chevron-down icon (`ChevronDown`) to indicate the field below is selectable/changeable
- Below the icon: the step label in small bold text
- Active step: icon and label in `--primary` blue, connector line filled blue up to that step
- Completed step: icon filled `--primary`, label in `--text-primary`
- Inactive step: icon and label in `--text-secondary`, connector line in `--border`
- The three chain items for the exam selector row are: **School Level** | **Target Class** | **Subject**
- This chain occupies its own dedicated row in the form (Row 2 — see layout below)
- Clicking any chain item opens its respective dropdown inline below the chain

### Form Layout — Row by Row (Desktop & Tablet)

**Row 1 — Exam Identity:**
```
[ Term (25% width) ]          [ Scheduled Date ]  [ Scheduled Time ]
```
- Term input: `width: 25%` — compact, not full-width
- Scheduled Date + Scheduled Time: placed to the right of Term, flexed, `justify-content: flex-end`, `gap: 12px`
- The entire row is `display: flex`, `align-items: flex-end`, `justify-content: space-between`
- Date and time inputs use the existing date/time picker components — do not replace them

**Row 2 — Selector Chain:**
```
[ School Level ▾ ] ———— [ Target Class ▾ ] ———— [ Subject ▾ ]
```
- Full-width row
- Rendered as the steps chain described above
- Each item shows its currently selected value as the label below the chevron icon
- Clicking opens a styled dropdown (white bg, `--border`, shadow, `border-radius: 12px`)

**Row 3 — Numeric Settings:**
```
[ Duration (50%) ]  [ Passing Score (50%) ]  [ Scramble Questions ]
```
- Duration and Passing Score inputs: each `~25% width` (half of what they currently are)
- They sit side by side on the left of the row
- **Scramble Question Order**: displayed to the right of these two inputs in the same row
  - Label: "Scramble Questions" in bold, `--text-primary`
  - Uses **radio inputs** (not checkbox): two options inline — `No` (default, pre-selected) and `Yes`
  - Radio button style: custom styled — selected option shows a filled `--primary` blue dot, unselected shows an empty circle with `--border`
  - When "Yes" is selected, behaviour matches the existing checkbox scramble logic exactly
  - Layout: label on top, `[ ● No ]  [ ○ Yes ]` radio pair below it

**Row 4 — General Instructions:**
- Remains exactly as-is — full width textarea, no changes

**Row 5 — Theory Section Instructions:**
- Remains exactly as-is — no changes

**Row 6 — Questions Area:**
- Remains exactly as-is — no changes

---

## ➕ Add Question Modal (Desktop & Tablet Only)

### Question Type + Add Media Row
Currently the Question Type select occupies the entire second row after the Question Number. Restructure as:

```
[ Question Type (flex-grow) ]          [ + Add Media (icon + text) ]
```
- `display: flex`, `justify-content: space-between`, `align-items: center`
- Question Type: takes available space on the left (`flex: 1`)
- Add Media: moved to this same row, right-aligned — styled as a **ghost action** (see Ghost CTAs below), NOT a button

---

## 👻 Ghost CTAs — Icon + Text Actions (Desktop, Tablet & Mobile)

The following call-to-action elements must NOT be rendered as full buttons. Instead render them as **bold icon + text pairs** in the relevant action color:

| CTA | Icon (Lucide) | Color |
|-----|--------------|-------|
| `+ Add Question` | `PlusCircle` | `--primary` blue |
| `Remove` (question/option) | `Trash2` | `#EA4335` (red) |
| `+ Add Instruction` | `PlusCircle` | `--primary` blue |
| `+ Add Media` | `Paperclip` or `Image` | `--text-secondary` grey |
| `+ Add Option` | `Plus` | `--primary` blue |

**Ghost CTA styling:**
```css
.ghost-cta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 700;
  font-size: 14px;
  color: var(--cta-color);   /* set per item from table above */
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 0;
  transition: opacity 0.15s ease;
}
.ghost-cta:hover { opacity: 0.75; }
.ghost-cta svg { width: 16px; height: 16px; stroke-width: 2.5; }
```
- No background, no border, no pill shape
- Icon and text share the same color
- Hover: slight opacity reduction — no background fill
- Apply this pattern consistently everywhere these actions appear in the modal

---

## 📵 Mobile Forms — Do Not Change

The forms and modals on **mobile screens (< 768px) must remain exactly as they currently are**, with the following exceptions only:

- Ghost CTAs (icon + text actions) apply on mobile too — remove button styling from `+ Add Question`, `Remove`, `+ Add Instruction` on mobile as well
- In the Selector Chain (Row 2), on mobile the labels shorten:
  - "School Level" → **"Level"**
  - "Target Class" → **"Class"**
  - "Subject" stays as **"Subject"**
- All other mobile form layouts, field orders, input sizes, and structures stay unchanged


---

## 📝 Create Exam Modal

The Create Exam modal follows the multi-step form aesthetic from the Web Forms reference (clean white card, structured sections, clear visual hierarchy) but uses the dashboard's blue color scheme (`--primary: #1A73E8`) instead of orange.

### Modal Shell
- White background card, `border-radius: 20px`, large shadow
- Max width: `720px` on desktop, `100%` on mobile
- Scrollable modal body if content overflows
- Header: "Create Exam" title (bold, `--text-primary`) + X close button (top right)
- Footer: "Save & Continue" / "Publish Exam" primary CTA button (blue pill, centered or right-aligned)
- Subtle section dividers between logical groups

---

### 🖥️ Desktop & Tablet Layout (≥ 768px)

#### Row 1 — Term + Schedule
```
┌─────────────────────┬──────────────────┬──────────────────┐
│  Term               │  Scheduled Date  │  Scheduled Time  │
│  (25% width)        │  (37.5% width)   │  (37.5% width)   │
└─────────────────────┴──────────────────┴──────────────────┘
```
- Layout: `display: flex; justify-content: space-between; gap: 16px`
- **Term**: reduced to ~25% of the row width — it's a short value, doesn't need full width
- **Scheduled Date** and **Scheduled Time**: share the remaining 75%, placed to the right of Term
- All three items in one flex row, space-between

#### Row 2 — Level / Class / Subject Chain
Redesign these three dropdowns as a **segmented chain selector** inspired by the stepped progress indicator in the reference image:

```
     ▼                    ▼                    ▼
  [School Level]  ————  [Target Class]  ————  [Subject]
   Senior Secondary      JSS 3               Mathematics
```

- Three items connected by a horizontal line (like a stepper/progress chain)
- Above each item: a **dropdown chevron icon** (`ChevronDown` from Lucide, 18px, `--primary` blue) centered above the label — this signals to users that the value is selectable/changeable
- Below the icon: the **label** in small uppercase grey (`--text-secondary`, `11px`, letter-spaced)
- Below the label: the **current value** in bold (`--text-primary`, `15px`)
- The connecting line between items: `1px solid var(--border)`, centered vertically on the icon row
- Active/selected item: icon and value in `--primary` blue, subtle `--primary-light` background pill behind the icon
- The entire chain item is clickable — opens a dropdown to change the value
- On mobile (`< 768px`): labels shorten — "School Level" → **"Level"**, "Target Class" → **"Class"**, "Subject" stays as "Subject"

#### Row 3 — Duration + Passing Score + Scramble Questions
```
┌───────────────┬───────────────┬──────────────────────────┐
│  Duration     │  Passing Score│  Scramble Question Order │
│  (25% width)  │  (25% width)  │  (50% width)             │
└───────────────┴───────────────┴──────────────────────────┘
```
- **Duration** and **Passing Score**: each takes ~25% width — they only hold numbers, no need for full-width inputs
- **Scramble Question Order**: takes remaining ~50%, displayed as an inline radio group:
  ```
  Scramble Question Order
  ● No   ○ Yes
  ```
  - Default selected: **No**
  - Radio inputs styled as pill toggles or custom radio buttons using `--primary` blue for the selected state
  - When **Yes** is selected, behaves exactly as the current checkbox implementation does
  - Label above, radio options inline below

#### Rows 4+ — Unchanged
- General Instructions textarea: remains as-is
- Theory Section Instructions textarea: remains as-is
- Questions area: remains as-is (with modifications to Add Question modal below)

---

### ➕ Add Question Modal — Desktop & Tablet Layout

#### Row 1
- Question Number (auto, read-only label)

#### Row 2 — Question Type + Add Media (space-between)
```
┌──────────────────────────┬──────────────────────────┐
│  Question Type           │  + Add Media             │
│  (dropdown, ~50% width)  │  (icon-text CTA, right)  │
└──────────────────────────┴──────────────────────────┘
```
- `display: flex; justify-content: space-between; align-items: center`
- **Question Type**: dropdown taking roughly half the row
- **Add Media**: moved here from its own row — rendered as an **icon-text CTA** (see CTA style below), right-aligned

---

### 🎨 Icon-Text CTAs (Not Buttons)

The following actions should NOT be rendered as full buttons. Instead render them as **bold icon + text pairs** styled with the action's semantic color. They are clickable inline elements, not `<button>` components with backgrounds.

| Action | Icon (Lucide) | Color |
|---|---|---|
| `+ Add Question` | `PlusCircle` | `--primary` blue |
| `Remove` | `Trash2` | `#EA4335` (red/danger) |
| `+ Add Instruction` | `Plus` | `--primary` blue |
| `+ Add Media` | `Paperclip` or `Image` | `--primary` blue |

**Styling rules:**
```css
.icon-text-cta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 700;
  font-size: 14px;
  color: var(--cta-color);   /* blue or red depending on action */
  cursor: pointer;
  background: none;
  border: none;
  padding: 4px 0;
  transition: opacity 0.15s ease;
}
.icon-text-cta:hover {
  opacity: 0.75;
}
```
- Icon: 16px, same color as text, bold stroke
- No background, no border, no pill shape
- Hover: slight opacity reduction only
- Apply this style to ALL secondary/additive/destructive actions in the modal

**This applies on desktop, tablet, AND mobile.**

---

### 📱 Mobile Behaviour for Create Exam Modal (< 768px)

- **The form layout on mobile remains as-is** — do NOT apply the desktop row restructuring to mobile, EXCEPT for the following which apply on all screen sizes:
  - Icon-text CTAs (no buttons for Add Question, Remove, Add Instruction, Add Media)
  - "School Level" label → **"Level"**, "Target Class" label → **"Class"** on mobile
  - Scramble Question Order radio inputs (No/Yes) instead of checkbox — on all screen sizes
- All other mobile form layouts stay unchanged from current implementation

