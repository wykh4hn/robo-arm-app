# StatusBar

The white row under the header: overall lamp, Connection, Robot, Task and Tracking chips, and "Cập nhật x s trước" on the right.

**Consumer provides:** the output of `deriveStatus(state)` (the same object feeds lamp, chips, banner and tests) and the time since the browser received the last message.

**Anatomy:** `rb-statusbar` (`surface`, bottom `border`, `space-2` gaps, wraps) → lamp chip → detail chips → `rb-statusbar__updated` (`t-caption`, `muted`, number in mono).

**Rules**
- `role="status" aria-live="polite"` on the bar; the ErrorBanner is the assertive one.
- When no message arrives for `staleAfterMs` (1.5 s): Robot becomes "Không rõ", chips get `is-stale`, the "Dữ liệu cũ" tag appears before the timestamp, and Send is disabled.
- Order never changes, so users learn where to look.
