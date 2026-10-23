# ErrorBanner

Appears under the status bar only when something is wrong and answers three questions: what happened, did the robot stop, what to do next.

**Markup:** `rb-banner` (critical) or `rb-banner rb-banner--warn` with `role="alert"`, an icon, a `rb-banner__title` sentence, and a `dl.rb-banner__facts` with exactly two rows: **Robot** (its state now) and **Việc cần làm** (the next action). Optional `rb-banner__actions` (e.g. "Xem hướng dẫn" linking to the Tutorial section).

**Rules**
- Never auto-dismisses and has no close button; it disappears when the condition clears.
- Critical for robot error, USB lost, web disconnected, stop not confirmed, E-stop. Warn for stale data.
- Write the title as a plain sentence with the specific joint or device name; never "Đã xảy ra lỗi".
- If the robot state is unknown, say so and point to the physical emergency stop.
