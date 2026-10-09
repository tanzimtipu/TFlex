## Animation System (Phase 15)

All UI animations must use the centralized motion system. Do NOT hardcode animation values.

### Motion Tokens (src/renderer/styles/animations.css)

**Duration tokens:**
- `--motion-duration-micro: 150ms` - tooltips, micro-feedback
- `--motion-duration-fast: 200ms` - buttons, toggles, hovers
- `--motion-duration-standard: 250ms` - dialogs, popovers, panels
- `--motion-duration-panel: 280ms` - sidebar open/close
- `--motion-duration-layout: 350ms` - large layout changes
- `--motion-theme-crossfade: 400ms` - theme transitions

**Easing tokens:**
- `--motion-ease-standard: cubic-bezier(0.4, 0, 0.2, 1)`
- `--motion-ease-enter: cubic-bezier(0, 0, 0.2, 1)`
- `--motion-ease-exit: cubic-bezier(0.4, 0, 1, 1)`
- `--motion-ease-layout: cubic-bezier(0.4, 0, 0.2, 1)`

**Scale tokens:**
- `--motion-scale-press: 0.97` - button press
- `--motion-scale-enter: 0.95` - dialog/popover enter
- `--motion-scale-exit: 0.98` - dialog/popover exit

### Animation Patterns by Component

**Dialogs/Modals:**
- Open: Bloom In (scale 0.95→1, opacity 0→1, 200ms)
- Close: Bloom Out (reverse)
- Backdrop: Fade In/Out (180ms)
- Use: `AnimatedDialog` wrapper

**Popovers/Menus:**
- Open: Pop In (scale 0.95→1, 180ms)
- Dropdown: Drop Reveal (translateY -8px→0, 180ms)
- Tooltip: Micro Fade Lift (120ms)
- Menu Item Hover: Soft Material Highlight (150ms)
- Use: `usePopAnimation()` hook

**Sidebars/Panels:**
- Open: Slide In (translateX -100%→0, 280ms)
- Close: Slide Out (translateX 0→-100%, 220ms)
- Resize: Elastic Resize (300ms)
- Use: `AnimatedPanel` wrapper

**Tabs:**
- Switch: Crossfade (200ms)
- Indicator: Liquid Glide (transform translateX, 200ms)
- Use: `AnimatedTab` wrapper

**Buttons/Controls:**
- Hover: Luminous Hover (subtle lift, 150ms)
- Press: Soft Compression (scale 0.97, 100ms)
- Release: Spring Return (scale 1, 200ms)
- Toggle: Selection Fill (150ms)
- Use: `useScaleAnimation()` + token `--motion-scale-press`

**Thumbnails:**
- Select: Selection Bloom (border + shadow, 150ms)
- Hover: Lift (translateY -4px, 150ms)
- Drag: Floating Lift (scale 1.05, 200ms)

**Selection surfaces (PAGES panel summary card / dock selection chip):** (TFL-1589)
- Appear: Scale Fade In (scale 0.95→1, opacity 0→1, FAST 200ms)
- Dismiss: Scale Fade Out (reverse to 0.98, opacity→0, MICRO 150ms)
- Value change: Crossfade (opacity only, FAST in / MICRO out)
- Verb group swap: `AnimatePresence mode="wait"` (old dissolves, new blooms)
- Use: `useSelectionPopAnimation()` + `useContentCrossfadeAnimation()`

**Enter-only CSS surfaces with an exit (compact Inspector drawer, compact ContextPanel drawer, Activity Shelf panel):** (TFL-1620)
- Enter: unchanged CSS keyframe on class add (`inspector-drawer-in` / `context-drawer-in` / `activity-shelf-panel-in`)
- Dismiss: `animation: <name>-out ... var(--motion-duration-micro) var(--motion-ease-exit) both` on the `--leaving` modifier
- The drawer `--leaving` class pins `pointer-events: none` so a closing surface never eats the click underneath
- Use: `useExitTransition(active, MOTION_DURATION.micro)` holds the surface one exit band, then releases it; the Animations-OFF / reduced-motion path releases instantly with no held frame

**Theme Transitions:**
- Switch: Crossfade (400ms)
- Uses View Transitions API when available
- PDF content NEVER animates (stays white)
- All themes use IDENTICAL timing

### Animation Rules

1. **NO hardcoded values** - import from `motionTokens.ts`
2. **Same motion across themes** - only visual properties (shadow, highlight) differ
3. **Transform/opacity only** - no layout thrashing
4. **Respect reduced-motion** - check `prefers-reduced-motion`
5. **60fps target** - keep animations under 16ms frame budget
6. **PDF protection** - never animate PDF content (page colors, text)

### Component Checklist

When adding any animated component:
- [ ] Uses centralized tokens
- [ ] Same timing in light/dark/frosted themes
- [ ] Reduced motion fallback
- [ ] 60fps verified
- [ ] PDF content unaffected

### Files

- `src/renderer/styles/animations.css` - token definitions
- `src/renderer/hooks/useAnimations.ts` - animation hooks
- `src/renderer/hooks/useExitTransition.ts` - exit state machine for enter-only CSS surfaces (TFL-1620)
- `src/renderer/hooks/motionTokens.ts` - JS constants
- `src/renderer/components/AnimatedDialog.tsx` - dialog wrapper
- `src/renderer/components/AnimatedPanel.tsx` - panel wrapper
- `src/renderer/components/AnimatedTab.tsx` - tab wrapper

