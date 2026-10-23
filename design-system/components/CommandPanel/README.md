# CommandPanel

The "Ra lệnh" card: template, object, exact command preview, Send, and the lifecycle of the last command.

**Consumer provides:** templates and objects from config, the built string, connection/robot/task state for the disable rules, and the command lifecycle from acks.

**Send is disabled (with the reason written under it) when:** disconnected · data stale · robot error · robot stopped (needs Sẵn sàng) · a task is running. One reason at a time, the most important first.

**After Send:** show LifecycleStepper (Đã gửi → Đã nhận → Đang chạy → Xong / Thất bại). On NACK show `rb-nack` with the reason and keep Send enabled for a corrected retry. Never auto-resend.
