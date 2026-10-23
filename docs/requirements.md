Build the complete frontend of a web app that monitors and commands an SO-101 robot arm doing pick-and-place ("pick [object] and put it in the box"). Frontend only: no backend, no login, no cloud. All data comes from an in-browser mock that can later be swapped for a real WebSocket. The attached screenshot is the visual source of truth for layout and style.

## 1. Context and users
- Audience: showcases for people with a robotics background, plus newcomers who learn from a Tutorial tab and tooltips. Use standard robotics terms (shoulder_pan, rad/s, URDF) with plain-language tooltips.
- An expert reviewer asked for 4 things, which are the core of the page: (1) real-time 3D geometry of the robot, (2) position and velocity of each joint, (3) trajectory, (4) Stop and command.
- Quality bar: clean, calm, industrial, readable. No flashy effects.

## 2. Out of scope (do NOT build)
Login/roles, maintenance/manual jog tab, temperature, speech-to-text, a physics simulator (the simulator is a separate app), backend, AWS, real network calls.

## 3. Tech
- React 18+, TypeScript (strict), Vite. Zustand (one store). three + @react-three/fiber + @react-three/drei + urdf-loader for 3D. uPlot for time-series charts (small React wrapper). Vitest + Testing Library. ESLint + Prettier. CSS modules or Tailwind, all design tokens in one file.
- Scripts: dev, build, lint, typecheck, test. Target latest Chrome and Edge.

## 4. Layout (desktop target 1440x900, fluid)
Rows (header + status bar + pipeline stay visible at the top):
1. Header (dark slate): STOP button (left, red, >= 44px tall, on every tab), tabs "Monitoring" | "Tutorial", project name (config), VI/EN toggle.
2. Status bar: overall lamp + chips: Connection (Web latency ms, USB), Robot state, Task (#id, short description, elapsed), Tracking quality; right side "Updated x s ago" (time since the browser received the last message).
3. Pipeline strip: Camera -> AI -> Gateway -> Robot -> Result with ms per step; "—" when a step has no data. Failed step: icon + warning style; later steps "—".
4. Main: 3 columns (flex-wrap; stack below 1024px):
   - Left (~300px): Command card, then Task history.
   - Centre (widest): 3D model card (~360px tall), then two camera tiles side by side.
   - Right (~460px): Joint state table, then Trajectory charts card.
An error banner appears under the status bar only when something is wrong: what happened, whether the robot stopped, what to do next. It does not auto-dismiss.

## 5. 3D model (expert point 1)
- Load the official SO-101 URDF + meshes from TheRobotStudio/SO-ARM100 (Simulation/SO101) placed in public/robot/so101/ (path in config). If the files are missing, render a simple placeholder kinematic chain (cylinders) so the app still runs, and show a notice.
- Two robot instances from one loaded URDF: "measured" (solid) driven by joint state, and "commanded" ghost (blue, ~30% opacity) driven by joint action. Toggle ghost on/off.
- Unit mapping is mandatory: data joint values are converted to URDF joint angles per joint with config {sign, offsetDeg, scale}; gripper percent -> gripper joint angle via config. Zero positions of URDF and LeRobot differ (e.g. shoulder_pan may need its sign flipped), so put a clear TODO to calibrate with the hardware team.
- Camera presets: Perspective, Top, Front, Side, plus OrbitControls and "Reset view". Toggles: ghost, end-effector trail, planned path, axes, joint labels.
- Overlay: end-effector position (mm) computed from the URDF link named in config.eeLink. Legend explaining solid/ghost/trail/planned.
- Render on demand (frameloop "demand", invalidate on new data) to keep it light.

## 6. Joint state (expert point 2)
Table, one row per joint (shoulder_pan, shoulder_lift, elbow_flex, wrist_flex, wrist_roll, gripper), each with a fixed colour used everywhere (3D highlight, table, charts):
columns: Joint (technical name + short Vietnamese description), Position, Velocity, Command, Error |cmd - pos|, Limit bar (position within joint range from URDF limits or config; amber near the edge, threshold in config).
- Units toggle degrees/radians; gripper shown in % open.
- Velocity: use servo velocity from data if present; otherwise finite difference of position with exponential smoothing, and label it "estimated". STS3215 encoder: 4096 steps/rev (config).
- Tracking quality (pure function trackingQuality): mean |action - state| over the 5 arm joints (exclude gripper: when holding an object the command closes further than the measured position, which is normal) over trackingWindowMs; levels Good / Slow / Possibly stuck; a level changes only after being exceeded continuously for trackingHoldMs.
- Clicking a row highlights that joint in the 3D model (emissive tint) and in the charts, dimming the others.

## 7. Trajectory (expert point 3)
- In 3D: end-effector trail of the last 10 s, fading with age. Optional planned path (dashed) when the mock provides plan points; optional pick and drop markers when the task provides positions.
- Charts card: tabs Position / Velocity / Error. Position = two charts like LeRobot Dataset Visualizer: chart A shoulder_pan, shoulder_lift, elbow_flex; chart B wrist_flex, wrist_roll, gripper. Action dashed, state solid, same colour per joint. Legend with a checkbox per joint and current values. Sliding 10 s window; hover pauses and shows values; "Live" button resumes.
- "Download log" button: CSV (t_ms, joint, action, state, velocity) and JSON events (tasks, commands, acks, errors) of the current session.

## 8. Stop and command (expert point 4)
- STOP: no confirmation. States STOP -> Stopping -> Stopped; "Stopped" only after an ack. No ack within ackTimeoutMs -> "Not confirmed: use the physical emergency stop". After a stop the robot never restarts by itself, not even after reconnect: the user presses "Ready", then sends a new command.
- Command card: dropdown "Command template" (now one: "Gắp [vật] bỏ vào hộp"), dropdown "Object" (config list: vịt đỏ, vịt vàng, khối lập phương, hộp nhỏ màu hồng), read-only preview of the exact string sent (template build function in config, default "pick the {object} and put it in the box"), Send button.
- Send is disabled, with the reason written below, when: disconnected, data stale, robot error or stopped, or a task is running.
- Lifecycle stepper: Sent -> Received -> Running -> Done/Failed; show NACK reasons. Never show success before ACK; never auto-resend a movement command.
- Task history: newest first, running task pinned; each item: id, command, status (icon + text), start time, duration, failure reason when failed.

## 9. Status logic
- One pure function deriveStatus(state) feeds the lamp, chips, banner and tests. Levels (most severe wins): Emergency stop (only if data has it), Needs action (red), Waiting for user (blue), Attention (amber), OK (green).
- Values: Web Connecting/Connected/Disconnected/Failed; USB Plugged/Lost/Unknown; Robot Ready/Moving/Stopped/Error/Unknown; Task Idle/Running/Done/Failed/Stopped.
- Stale data (no message for staleAfterMs): dim values, label "Stale data", Robot = Unknown, disable Send.
- Colour only for abnormal states: detail chips are neutral grey when normal. Never colour alone: every status has an icon and text.

## 10. Cameras
Two equal tiles under the 3D card: "Object view (top-down)" and "Overview". Each shows name, FPS, frame age; overlay "Frozen image" when the frame is older than cameraFrozenAfterMs or FPS < fpsWarn. Source: MJPEG <img> from config URL; placeholder when none. A button on each tile swaps that camera with the 3D model in the large slot; layout only changes on user action.

## 11. Tutorial tab
A real page: purpose of the screen; how to read the status bar (levels and icons generated from the same config); how to read the 3D model (solid, ghost, trail, planned); how to read the joint table and charts; how to send a command; Stop vs physical E-stop; what to do for USB lost, robot error, frozen camera, rejected command, stale data; glossary. First visit shows a dismissible hint "First time? Open the Tutorial". Tooltips on status chips, pipeline steps, 3D toggles, table headers.

## 12. Visual design (match the screenshot)
- Tokens: bg #EEF1F4, surface #FFFFFF, surface-2 #F6F8FA, border #CBD2D9, text #1F2933, muted #52606D, header #1F2A37, primary #1F6FEB. Status: ok text #146C2E on #E6F4EA, warn #92400E on #FEF3C7, critical #B71C1C on #FDECEA, info #1A56C4 on #E8F0FE. STOP #D32F2F, white bold text.
- Joint colours: shoulder_pan #2563EB, shoulder_lift #EA7A0C, elbow_flex #0D9488, wrist_flex #7C3AED, wrist_roll #DB2777, gripper #64748B.
- Fonts: Inter (UI), JetBrains Mono (numbers, ids, ms). Base 14px, min 11px.
- Radius 6-8px, 1px borders, no gradients, no shadows except popovers, no animations beyond instant hover/focus colour. Respect prefers-reduced-motion. Visible focus rings. Text contrast >= 4.5:1.

## 13. Mock data and scenarios
- Transport interface (connect, send, stop, subscribe) with MockTransport now and a WebSocketTransport stub. Backend URL from VITE_BACKEND_URL (unused for now). Put all message types in src/types/messages.ts.
- Mock emits: telemetry at 10 Hz {ts, joints: {name: {action, state, velocity?}}}; status on change + heartbeat every 500 ms {ts, link: {web, usb}, robot: {state, error?}, task: {id, state}}; task events (with optional pick/drop positions and plan points); command ack/nack; stop ack; camera meta; pipeline timings.
- Motion: a realistic ~20 s pick-and-place cycle (rest -> reach -> open gripper -> grasp -> carry -> release over box -> home), smooth joint trajectories; state lags action by ~200-300 ms; while holding, gripper state stops short of the command.
- Scenarios via ?scenario=<name> and a dev-only panel (Ctrl+Shift+D): running, idle, slow-tracking, joint-stuck, usb-lost, robot-error, stop-ok, stop-no-ack, stale, camera-frozen, cmd-nack, web-disconnected (reconnect, refresh state before re-enabling controls), estop, no-urdf. Each must produce the UI described above. Also first-run and empty-history states.

## 14. Config (one file, placeholder values to calibrate on the real robot)
staleAfterMs 1500, ackTimeoutMs 2000, fpsWarn 8, cameraFrozenAfterMs 3000, trackingWindowMs 1000, trackingHoldMs 1500, trackingWarnDeg 8, trackingStuckDeg 20, nearLimitRatio 0.9, stepsPerRev 4096, urdfPath, eeLink, jointMap (sign, offsetDeg, scale per joint), objects, templates, pipelineSteps, cameras, projectName.

## 15. Strings and accessibility
All UI text in strings/vi.ts and strings/en.ts (default vi). No hard-coded text in components. Fully keyboard operable, especially STOP. Status changes via aria-live="polite"; error banner assertive. Semantic HTML (real buttons, labels, tables).

## 16. Structure
src/app, src/components (StopButton, StatusBar, ErrorBanner, PipelineStrip, CommandPanel, TaskHistory, RobotViewer3D, JointTable, TrajectoryCharts, CameraTile, TutorialPage), src/three (urdf loading, joint mapping, trail), src/state (store, deriveStatus, trackingQuality, velocity), src/transport (Transport, MockTransport, WebSocketTransport stub, scenarios), src/types, src/config, src/strings, src/utils (exportLog, units, time). Unit-test deriveStatus, trackingQuality, velocity estimation, joint unit mapping and exportLog.

## 17. Way of working
1. Reply first with a short plan and at most 5 blocking questions (do not ask about anything specified here).
2. Build in steps, committing after each: scaffold + tokens + static layout; store + mock + types + pure functions with tests; 3D viewer (placeholder chain first, then URDF); joint table + charts; command + history + Stop; cameras; Tutorial + strings; scenarios + dev panel; polish + README.
3. Done when: build, lint, typecheck and tests pass; every scenario behaves as specified; no status shown by colour alone; STOP works by keyboard on both tabs; the app runs without URDF files; README explains running, switching scenarios and where to put the URDF. List your assumptions at the end.