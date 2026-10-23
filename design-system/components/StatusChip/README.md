# StatusChip

One status fact as icon + label + value; the first chip of the status bar is the overall lamp.

**Lamp levels** (from `deriveStatus`, most severe wins):

| Level | Class | Icon | vi text |
| --- | --- | --- | --- |
| Emergency stop | `rb-chip--estop` | `octagon-alert` | Dừng khẩn cấp |
| Needs action | `rb-chip--critical` | `circle-x` | Cần xử lý |
| Waiting for user | `rb-chip--info` | `hand` | Chờ người dùng |
| Attention | `rb-chip--warn` | `triangle-alert` | Cần chú ý |
| OK | `rb-chip--ok` | `circle-check` | Hệ thống ổn |

**Detail chips** (Connection, Robot, Task, Tracking) are neutral (`surface-2`, `border`) when normal and take the tone of their own level only when abnormal. Stale data: add `is-stale` (dashed `border-control` outline, value in `muted`) and the `rb-tag--warn` "Dữ liệu cũ" tag.

**Rules**
- Never colour alone: every chip has an icon and a word. Numbers inside chips go in `rb-chip__num` (mono).
- Values: Web Đang kết nối / Đã kết nối / Mất kết nối / Lỗi; USB ổn / Mất / Không rõ; Robot Sẵn sàng / Đang chạy / Đã dừng / Lỗi / Không rõ; Task Rảnh / Đang chạy / Xong / Thất bại / Đã dừng; Tracking Tốt / Chậm / Có thể bị kẹt.
- Give each chip a tooltip (`rb-tip`) that explains the term in plain Vietnamese.
