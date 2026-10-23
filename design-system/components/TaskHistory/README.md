# TaskHistory

The "Lịch sử task" card: newest first, the running task pinned on top in `info-bg`.

**Each item (`rb-task`):** id (`#13`, mono 500), status at right (icon + word: Đang chạy `info-text`, Xong `ok-text`, Thất bại `critical-text`, Đã dừng `warn-text`), the command in plain Vietnamese, start time and duration (times in mono), and a failure reason line when failed.

**Empty state:** `rb-empty` — "Chưa có task nào trong phiên này." plus how to start one.
