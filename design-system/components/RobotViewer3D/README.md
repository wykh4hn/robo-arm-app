# RobotViewer3D

"Mô hình 3D · thời gian thực": the SO-101 built from its URDF, driven by measured joint state, with the commanded ghost, end-effector trail, planned path and pick/drop markers.

**Consumer provides:** the URDF (path in config; fallback placeholder chain of cylinders + `rb-notice`), joint state and action mapped through `jointMap {sign, offsetDeg, scale}`, EE position from `config.eeLink`, optional plan points and pick/drop positions.

**Visual encoding**
| Layer | Token | Style |
| --- | --- | --- |
| Measured robot | `robot-body` + joint rings in `joint-<name>` | solid, lit |
| Commanded ghost | `robot-ghost` | `opacity-ghost` (0.3), toggle "Bóng lệnh" |
| EE trail 10 s | `ee-trail` | dotted, fading to `opacity-trail-min` |
| Planned path | `planned-path` | dashed 6/4 |
| Floor | `viewport-floor`, `viewport-grid` | flat |
| Pick / drop | `text` | dashed ring + label "Vịt đỏ · điểm gắp", "Hộp · điểm thả" |

**Chrome:** view presets in a SegmentedControl in the card head; layer checkboxes in `rb-viewer__toolbar`; "Đặt lại góc nhìn" top-left; EE readout `rb-readout` top-right ("Đầu kẹp (mm) x 182 · y −41 · z 96"); legend row under the viewport.

**Rules:** render on demand (frameloop "demand"); no animation beyond following the data; the static picture in the preview is a stand-in for the three.js canvas, which goes in `.rb-viewport > canvas`.
