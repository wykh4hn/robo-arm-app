# Button

`rb-btn` is the one button shape: 32px (`size-control`), `radius-md`, 13px/500 label, optional 16px Lucide icon before the label.

| Variant | Class | Use |
| --- | --- | --- |
| Primary | `rb-btn--primary` | The single main action of a card: **Gửi lệnh** (with `--lg --block`, 40px), **Sẵn sàng**. |
| Secondary | *(base)* | Tải log, Xem hướng dẫn, Đặt lại góc nhìn. `border-control` outline. |
| Quiet | `rb-btn--quiet` | Low-priority icon actions inside tiles (swap camera, close hint). |
| Icon | `rb-btn--icon` | Square 32px; always with `aria-label`. |
| Live | `rb-btn--live` | Chart "Trực tiếp" toggle (`info` tint + dot); when paused show a secondary "Trở lại trực tiếp" with `play`. |

**Disabled:** prefer `aria-disabled="true"` (stays focusable so the reason is read) → `disabled-bg`, `muted` label. Always write the reason right below with `rb-help` + `info` icon, e.g. "Đang có task chạy (#13). Đợi task xong hoặc bấm STOP."

STOP is not a Button variant — use StopButton.
