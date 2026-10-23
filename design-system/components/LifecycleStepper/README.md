# LifecycleStepper

A compact inline stepper for one command: Đã gửi → Đã nhận → Đang chạy → Xong / Thất bại.

**Step classes:** `rb-step--done` (`check`, `ok-text`), `rb-step--current` (`loader-circle`, `info-text`, `aria-current="step"`), pending (`circle`, `muted`), `rb-step--failed` (`circle-x`, `critical-text`, with the reason).

**Rules:** "Đã nhận" only after ACK; never show Xong before the robot reports done. The icon is static — no spinning (motion is limited to instant colour changes).
