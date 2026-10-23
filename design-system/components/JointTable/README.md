# JointTable

"Trạng thái khớp": one row per joint — Position, Velocity, Command, Error |cmd − pos|, Limit — in the joint's fixed colour.

**Consumer provides:** per joint `{state, action, velocity?}`, limits from URDF or config, the unit (độ/rad), the selected joint, and the tracking quality.

**Rules**
- Joint cell: `rb-joint__swatch` in `joint-<name>`, technical name in mono, Vietnamese description below in `t-micro`/`muted` (xoay đế, nâng vai, gập khuỷu, gập cổ tay, xoay cổ tay, kẹp · % mở).
- Numbers: mono, right-aligned, fixed decimals (1 in degrees, 3 in rad), true minus sign "−", locale decimal (vi: comma).
- Gripper is always in % open and excluded from the error/tracking average ("—").
- Velocity without servo data: header tag "ước tính" and a footer note.
- Error above `trackingWarnDeg` → `is-warn` (`warn-text`).
- Clicking a row sets `aria-selected="true"` (`selected-bg`) and dims other joints in 3D and charts.
- Footer: tracking quality with icon + word ("Độ bám lệnh: Tốt · sai số TB 0,3° trên 5 khớp").
