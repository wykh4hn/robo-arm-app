# robo-arm-app — SO-101 Monitor

Frontend for monitoring and commanding an **SO-101** robot arm doing pick-and-place
("pick [object] and put it in the box"): real-time 3D model from the URDF, joint position and
velocity, trajectories, STOP and command. React 19 + TypeScript (strict) + Vite, Zustand,
three.js / @react-three/fiber / drei / urdf-loader, uPlot, lucide-react.

Frontend only: all data comes from an in-browser mock (`MockTransport`) that emits the same
message shapes the backend will use (`src/types/messages.ts`).

- `docs/requirements.md` — the spec · `docs/sketch.png` — layout sketch
- `design-system/` — SO-101 Monitor design system (tokens, fonts, `rb-*` component CSS, previews)
- `CLAUDE.md` — how Claude Code uses the above

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
npm test           # Vitest
npm run format     # Prettier
```

Node 20+; targets current Chrome and Edge. Browse the design system with `npx serve design-system`.

## Scenarios

Add `?scenario=<name>` to the URL (e.g. `http://localhost:5173/?scenario=robot-error`), or in
`npm run dev` press **Ctrl+Shift+D** for the dev panel (the page reloads).

| Scenario           | What happens                                                                     |
| ------------------ | -------------------------------------------------------------------------------- |
| `running`          | Default: task #13 runs a ~20 s pick-and-place cycle, then the robot is idle.     |
| `idle`             | Robot ready, nothing running.                                                    |
| `slow-tracking`    | State lags 600 ms and sags under load → tracking "Chậm".                         |
| `joint-stuck`      | Measured state freezes at 1 s while the command moves on → "Có thể bị kẹt".      |
| `usb-lost`         | USB lost at 3 s. Press "Kết nối lại USB", then "Sẵn sàng".                       |
| `robot-error`      | Overload on `elbow_flex` at 3 s; robot stops, task fails.                        |
| `stop-ok`          | Press STOP: "Đang dừng…" → "Đã dừng" after the ACK (300 ms) → press "Sẵn sàng".  |
| `stop-no-ack`      | Press STOP: no ACK → "Chưa xác nhận dừng", use the physical emergency stop.      |
| `stale`            | All messages stop at 3 s (socket still open) → "Dữ liệu cũ", Send disabled.      |
| `camera-frozen`    | Overview camera freezes at 2 s (4 fps) → "Hình bị đứng".                         |
| `cmd-nack`         | Every command is rejected (NACK: object not found).                              |
| `web-disconnected` | Link drops at 3 s, retries, reconnects, reloads state, then re-enables controls. |
| `estop`            | Physical emergency stop reported at 3 s.                                         |
| `no-urdf`          | Uses the placeholder kinematic chain and shows the notice.                       |
| `first-run`        | Clears localStorage → first-visit hint.                                          |
| `empty-history`    | No task history; telemetry without servo velocity ("ước tính").                  |

The scenario table (`src/transport/scenarios.ts`) also holds the expected status at given times;
`src/state/scenarios.test.ts` runs each scenario through the mock + store and checks
`deriveStatus`.

## URDF (3D model)

Put the SO-101 URDF and its `assets/` meshes in **`public/robot/so101/`** (path in
`config.urdfPath`, end-effector link in `config.eeLink`). The official files from
TheRobotStudio/SO-ARM100 (`Simulation/SO101`, Apache-2.0) are already included. If they are
missing or invalid, the app renders a placeholder chain of cylinders and says so.

Data values (LeRobot degrees, gripper % open) are mapped to URDF radians per joint with
`config.jointMap {sign, offsetDeg, scale}` and `config.gripperMap`. **TODO (hardware team):**
calibrate these; URDF and LeRobot zero positions differ (e.g. `shoulder_pan` may need its sign
flipped).

## Structure

```
src/app         App shell, header + tabs, monitoring layout, first-visit hint, dev panel
src/components  StopButton, StatusBar, ErrorBanner, PipelineStrip, CommandPanel, TaskHistory,
                RobotViewer3D, JointTable, TrajectoryCharts (+ UPlotChart), CameraTile, TutorialPage
src/three       URDF loading + placeholder chain, R3F scene (ghost, trail, plan), labels
src/state       Zustand store, deriveStatus, trackingQuality, velocity estimation
src/transport   Transport interface, MockTransport + motion cycle, WebSocketTransport stub, scenarios
src/types       messages.ts — every message type
src/config      all tunables; levels.ts maps status levels to icons/classes (also used by the Tutorial)
src/strings     vi.ts (default), en.ts — all UI text
src/utils       exportLog (CSV + JSON), units (mapping, number format), time, css, storage
```

Styling: `design-system/tokens.css` + `design-system/components/bundle.css` are imported once;
components use the `rb-*` classes from the previews. `src/styles/app.css` adds layout glue using
tokens only.

## Connecting the real backend

`createTransport()` in `src/transport/index.ts` returns the mock today. Implement
`WebSocketTransport` (currently throws "not implemented") for `VITE_BACKEND_URL` (see
`.env.example`).

## Assumptions

- Telemetry joint values are LeRobot degrees (gripper % open); velocity is deg/s
  (`config.servoVelocityUnit` can switch to raw `steps/s`, 4096 steps/rev). Without servo
  velocity the UI estimates it (finite difference + exponential smoothing) and labels it "ước tính".
- Planned path: tasks carry joint waypoints (`plan`, `pickIndex`, `dropIndex`); the viewer turns
  them into end-effector positions with the robot model (forward kinematics), so the path always
  matches the displayed geometry.
- The status chip shows Web latency from an optional `link.latencyMs` in status messages.
- Banners have no close button (design system rule) and stay until the condition clears; they
  never disappear on a timer.
- Charts are always in degrees (gripper %), so a fixed Y range holds; the unit toggle applies to
  the joint table.
- The gripper is excluded from the near-limit warning (fully open/closed is normal use) and from
  tracking quality.
- NACK / failure reasons are shown exactly as the backend sends them.
- Severity mapping: Needs action — web lost, USB lost, robot error, stop not confirmed, possibly
  stuck; Waiting — stopped, needs Ready; Attention — stale, frozen camera, slow tracking,
  rejected command, reconnecting.
