# Mobile Header Layout - FINAL v3 ✅

## Visual Layout

### Mobile View (< 600px):

```
┌────────────────────────────────────────────────────────┐
│  Row 1 (Top Block):                                    │
│  ┌─────────────────────────────┐    ┌───────────────┐  │
│  │ [IMG]  Create New Exam      │    │ [← svg icon]  │  │
│  └─────────────────────────────┘    └───────────────┘  │
│                                                        │
│  Row 2 (Bottom Block):                                 │
│  ┌─────────────────────────────┐    ┌───────────────┐  │
│  │ [🚪 Logout]                 │    │ 🌙 [Mode]     │  │
│  └─────────────────────────────┘    └───────────────┘  │
└────────────────────────────────────────────────────────┘
```

## Implementation Details

### Row 1: `.header-top-row`
- **Left**: `.logo` group (Image + Title).
- **Right**: `.btn-back-dashboard` (SVG Icon).

### Row 2: `.mobile-user-row`
- **Left**: Logout Button (`.btn-logout-mobile`). 
  - Replaced the static Teacher Name.
  - Styled as a button with border and hover effects.
  - Invokes `auth.logout()`.
- **Right**: Dark Mode Toggle (Injected by `utils.js`).

## Styles
```css
.btn-logout-mobile {
    padding: 6px 12px;
    border: 1px solid var(--border-color);
    background: transparent;
    border-radius: 6px;
    display: flex;
    align-items: center;
    gap: 5px;
}
```

---
**Status**: ✅ LOGOUT BUTTON ADDED
