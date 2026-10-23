# StopButton

The software STOP: always the first control in the header, on every tab, never behind a confirmation.

**Markup:** `<button class="rb-stop" data-state="…">` with a Lucide icon and the label. Height `size-stop` (44px, never less), min-width 120px, `stop` fill, `on-stop` label in `t-stop` (16px/700, uppercase), 1px `stop-edge` rim so it reads on `header`.

**States (consumer sets `data-state`)**

| `data-state` | Label (vi) | Icon | When |
| --- | --- | --- | --- |
| *(none)* | STOP | `circle-minus` | Default. |
| `stopping` | Đang dừng… | `loader-circle` | Pressed; waiting for the stop ack. |
| `stopped` | Đã dừng | `circle-check` | Only after the ack arrives. `stop-hover` fill. Show the header **Sẵn sàng** (`rb-hbtn`) button beside it. |
| `unconfirmed` | Chưa xác nhận dừng | `triangle-alert` | No ack within `ackTimeoutMs` (2 s). Pair with the critical ErrorBanner telling the user to press the physical E-stop. |

**Rules**
- One press sends stop; pressing again re-sends. No confirmation dialog, no hold-to-confirm.
- It stays enabled in every state, including disconnected — the click is logged even if the link is down.
- After a stop the robot never restarts by itself: the user presses **Sẵn sàng**, then sends a new command.
- Keyboard: a real `<button>`, first in tab order, `focus-ring` visible on the dark header. Announce state changes through the status bar's `aria-live` region.
- Red (`stop`) is reserved for this button and the Emergency-stop lamp; no other control is red.
