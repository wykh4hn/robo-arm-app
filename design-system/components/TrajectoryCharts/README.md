# TrajectoryCharts

"Quỹ đạo khớp theo thời gian": two uPlot charts over a sliding 10 s window — A: shoulder_pan, shoulder_lift, elbow_flex; B: wrist_flex, wrist_roll, gripper — with tabs Vị trí / Vận tốc / Sai số.

**Encoding:** state = solid 2px line, action = dashed 1.5px (5/4) line, both in `joint-<name>`. Grid `chart-grid`, zero line `chart-axis`, ticks 11px mono `muted`. Y range fixed per tab (position ±100°) so lines don't jump.

**Interaction**
- Legend per chart: checkbox + swatch + mono name + current value.
- Hover pauses the window, draws a dashed cursor and shows a tooltip with "đo / lệnh" values; the header button becomes "Trở lại trực tiếp".
- A selected joint keeps full strength; others drop to `opacity-dim`.
- "Tải log" downloads CSV (t_ms, joint, action, state, velocity) and JSON events.

**Note:** `joint-shoulder_lift` is 2.9:1 on white — the legend name, not the colour, identifies it.
