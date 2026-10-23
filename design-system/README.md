A calm, industrial interface for watching and commanding the SO-101 pick-and-place arm. It is read by people with a robotics background and by newcomers learning from the Tutorial tab, so every screen pairs standard robotics terms with plain-language help, and nothing on it is decorative.

## Principles

1. **Safety first, always reachable.** The red STOP sits first in the header on every tab, needs no confirmation, and is the only red control.
2. **Colour means something is abnormal.** The UI is neutral grey and white when all is well; status tints appear only on what needs attention. Joint hues identify joints, never status.
3. **Never colour alone.** Every status carries an icon and a word; every chart line has a named legend entry.
4. **Say what to do next.** Errors state what happened, whether the robot stopped, and the next action.
5. **Numbers line up.** All numbers, units, ids and joint names are set in mono.

## Content fundamentals

- **Language.** Vietnamese by default, English via the VI·EN toggle. All strings live in `strings/vi.ts` and `strings/en.ts`; components hold no literal text. Tab names stay "Monitoring" and "Tutorial".
- **Technical terms stay technical.** Joint names (`shoulder_pan`, `elbow_flex`…), units (°/s, rad/s), URDF, ACK/NACK are kept as-is in mono, each with a Vietnamese tooltip: "`shoulder_pan` — khớp xoay đế: quay cả cánh tay sang trái hoặc phải quanh trục đứng."
- **Voice.** Short, calm, factual. Address the operator directly with verbs: "Đợi task xong hoặc bấm STOP." No exclamation marks, no emoji, no "Oops". Sentence case everywhere; only the STOP label is uppercase.
- **Commands read as Vietnamese, are sent as English.** The history says "Gắp vịt đỏ bỏ vào hộp"; the preview shows the exact string sent: `pick the red duck and put it in the box`.
- **Numbers.** Format with the active locale (vi: `0,1 s`, `−41,0`; en: `0.1 s`, `−41.0`); use the true minus sign (−); fixed decimals per column (1 in degrees, 3 in radians); gripper always in "% mở". Missing data is an em dash "—", never 0 or blank.
- **Error copy pattern.** Title = what happened, specific ("Robot báo lỗi: quá tải ở khớp elbow_flex"); then **Robot:** its state now; **Việc cần làm:** the next step. If the state is unknown, say "Không rõ" and point to the physical emergency stop.
- **Disabled controls explain themselves.** A disabled Send always has its reason written beneath it.

## Visual foundations

### Colour
- **Ground and text.** Page `bg`; cards, status bar and viewport on `surface`; quiet fills (pipeline strip, table header, command preview) on `surface-2`. Body text `text`; labels, units, captions `muted`. Card and chip outlines use `border`; every interactive control outline uses `border-control` (3:1).
- **Header.** `header` slate with `on-header` and `on-header-muted`; the active tab gets `header-raised` and a 2px `primary` underline.
- **Action.** `primary` is the only action colour: primary buttons, the selected-tab underline, links, the focus ring, and the commanded ghost / planned path in 3D. Blue text on a tint is `info-text`, never `primary`.
- **STOP.** `stop` fill, `on-stop` label, `stop-edge` rim, `stop-hover` for hover and the Stopped state. Reserved.
- **Status levels** (from one `deriveStatus` function; the most severe wins):

| Level | Fill / outline / text | Icon | Lamp text |
| --- | --- | --- | --- |
| Emergency stop | `stop` / — / `on-stop` | `octagon-alert` | Dừng khẩn cấp |
| Needs action | `critical-bg` / `critical-line` / `critical-text` | `circle-x` | Cần xử lý |
| Waiting for user | `info-bg` / `info-line` / `info-text` | `hand` | Chờ người dùng |
| Attention | `warn-bg` / `warn-line` / `warn-text` | `triangle-alert` | Cần chú ý |
| OK | `ok-bg` / `ok-line` / `ok-text` | `circle-check` | Hệ thống ổn |

- **Joints.** One fixed colour per joint, used identically in the table swatch, both charts and the 3D highlight: `joint-shoulder_pan`, `joint-shoulder_lift`, `joint-elbow_flex`, `joint-wrist_flex`, `joint-wrist_roll`, `joint-gripper`. Map them by name (`var(--joint-${name})`). `joint-shoulder_lift` is 2.9:1 on `surface` — kept from the spec and flagged; its legend name carries identity.
- **3D and charts.** `robot-body`, `robot-ghost` at `opacity-ghost`, `ee-trail` fading to `opacity-trail-min`, `planned-path` dashed, `viewport-floor` / `viewport-grid`; charts use `chart-grid` and `chart-axis`. A selected joint stays full strength while the rest drop to `opacity-dim`. Never dim text.

### Type
- **Inter** (400/500/600/700) for the interface, **JetBrains Mono** (400/500) for every number, id, unit, millisecond, joint name and the command string. Both ship as files in `fonts/` with full Vietnamese coverage.
- Base 14px (`t-body`); card titles `t-card-title` 15/600; labels and buttons `t-label` 13/500; helper text, subtitles and legends `t-caption` 12; the floor is `t-micro` 11px — nothing smaller. Data uses `t-value` 13 mono, timestamps `t-meta` 12 mono. Tutorial reading text uses `t-doc-title`, `t-doc-heading`, `t-doc-body` (15/24, max 68 characters a line).

### Layout and spacing
- 4px base. Cards sit `space-3` (12px) apart with a 12px page gutter; card content is padded `space-4` (16px).
- Desktop target 1440 × 900, fluid. Rows: header (`size-header`) + status bar + pipeline strip stay sticky; an error banner appears under them only when something is wrong; then three columns — left `col-left` (Command, Task history), centre flexible (3D card at `viewer-height`, two camera tiles), right `col-right` (Joint table, Trajectory charts). Below `bp-stack` (1024px) the columns stack.
- Control heights: STOP `size-stop` (44px minimum), buttons `size-control` 32px, selects `size-field` 36px, Send `size-control-lg` 40px, chips `size-chip` 28px, joint rows `size-row` 44px.

### Shape, borders, shadows
- Radii: `radius-sm` 4px (checkboxes, swatches, limit bar, tags), `radius-md` 6px (buttons, inputs, chips, task items), `radius-lg` 8px (cards, banners, camera tiles, viewport). `radius-full` only for status dots.
- 1px borders everywhere; no gradients; no shadows except `shadow-popover` on tooltips and menus. Never a coloured left-border accent on a card.

### Motion and states
- No animation beyond instant hover and focus colour changes: no spinners (the `loader-circle` icon is static), no transitions, no pulsing. Respect `prefers-reduced-motion`.
- **Focus:** every control shows `focus-ring` (2px white gap + 2px `primary`), visible on light cards and on the dark header, STOP included.
- **Hover:** secondary controls take `surface-2`; primary takes `primary-hover`; header items take `header-raised`.
- **Disabled:** `disabled-bg` with a `muted` label, plus the written reason.
- **Selected:** `selected-bg` with `info-text` (segments) or full-strength text (table rows).
- **Stale data:** values switch to `muted`, chips get a dashed `border-control` outline, and a "Dữ liệu cũ" tag appears; Send is disabled.

## Iconography

- **Lucide** (ISC licence; `lucide-react` in the app), 24-unit grid, 2px stroke, round caps, `currentColor`. Default 16px; 14px inside tags and steppers; 20px in STOP and banners. Always decorative (`aria-hidden`) next to a word, or labelled with `aria-label` when alone.
- Fixed meanings — don't reuse an icon for something else:

| Meaning | Icon |
| --- | --- |
| STOP / stopped task | `circle-minus` |
| OK, done | `circle-check`, `check` |
| Attention, near limit, frozen camera, failed pipeline step | `triangle-alert` |
| Needs action, failed, rejected | `circle-x` |
| Emergency stop | `octagon-alert` |
| Waiting for user | `hand` |
| Running / current step (static) | `loader-circle` |
| Pending step | `circle` |
| Connection / lost | `wifi`, `wifi-off`, `unplug` |
| Robot, Task, Tracking, Updated | `bot`, `list-checks`, `crosshair`, `clock` |
| Send, Ready, Live resume | `send`, `play` |
| Download log, Reset view, Swap camera | `download`, `rotate-ccw`, `maximize-2` |
| Help, info, dismiss | `circle-help`, `info`, `x` |
| Camera, no camera | `camera`, `camera-off` |
| Pipeline arrow | `chevron-right` |

- No emoji, no illustrations. There is no logo: the header shows the project name from config in plain type.

## Using this system

- Load the compiled tokens, then `components/bundle.css`; all component classes are prefixed `rb-` and take every value from tokens. The component cards show the exact markup for each state; the React app should mirror these class names (or port them to CSS modules) rather than restyle.
- Joint colours, thresholds and labels must come from the same config the app uses (`trackingWarnDeg`, `nearLimitRatio`, `staleAfterMs`, `fpsWarn`…), so the Tutorial and the screen never disagree.

## Intentional additions

Beyond the spec's palette: `border-subtle` (row dividers, grids), `border-control` (3:1 control outlines), `header-raised`, `header-line`, `on-header-muted`, `primary-hover`, `stop-hover`, `stop-edge` (STOP rim on the dark header), the `-line` outline per status, `disabled-bg`, the 3D/chart aliases, and `focus-ring` — each needed to meet contrast or to name a role the spec describes. Components beyond the spec's list: Card, Button, SegmentedControl, Field, Checkbox, Tooltip, LifecycleStepper, LimitBar, StatusChip and FirstVisitHint — the pieces the spec's screens are built from.

## Files in this folder

| Path | What |
| --- | --- |
| `tokens.json` | The source of every token (colours, type, spacing, radii, sizes, opacity, shadows). Edit this, not `tokens.css`. |
| `tokens.css` | CSS custom properties, `.t-*` type classes and `@font-face` rules, generated: `node design-system/scripts/build-tokens.mjs`. |
| `components/bundle.css` | All `rb-*` component classes; reads only tokens. |
| `components/<Name>/preview.html` · `README.md` | Exact markup for each component and its states, plus its usage rules. |
| `fonts/` | Inter and JetBrains Mono `.woff2` (Vietnamese included), OFL licences. |
| `assets/Icons/` | The Lucide icons used, drawn in `text` ink for reference; in code use `lucide-react`. |
| `index.html` | Gallery of every preview — open it through a local server (`npx serve design-system`). |

This folder is a copy of the **SO-101 Monitor** design system artifact on claude.ai. The repo copies of `preview.html` add two `<link>` tags (to `tokens.css` and `bundle.css`) so they open on their own.
