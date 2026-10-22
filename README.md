# Robot arm monitoring (SO-101) — frontend

A web page for supervising an SO-101 robot arm that picks an object and puts it into a box, driven by an AI model. This repo is the frontend only, built with React 19, TypeScript (strict), Vite, Zustand and uPlot.

There is no backend yet. All data comes from an in-browser **mock** (`MockTransport`), which uses the same message shapes the real WebSocket backend will use.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build into dist/
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
npm test           # Vitest
npm run format     # Prettier
```

Requires Node 20+ and targets current Chrome and Edge.

## Switching scenarios

Add `?scenario=<name>` to the URL, for example `http://localhost:5173/?scenario=usb-lost`.
In dev builds you can also press **Ctrl+Shift+D** to open the hidden dev panel and choose a scenario (the page reloads).

| Scenario           | What happens                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------- |
| `running`          | Default. A task runs normally.                                                            |
| `idle`             | Robot is ready and no task is running.                                                    |
| `slow-tracking`    | State lags action by 400 ms, so tracking becomes "Chậm".                                  |
| `joint-stuck`      | After 2 s the state freezes while the action keeps changing ("Có thể kẹt").               |
| `usb-lost`         | After 3 s USB is lost. Press "Kết nối lại", then "Sẵn sàng".                              |
| `robot-error`      | After 3 s the robot reports error E21 and stops.                                          |
| `stop-ok`          | Press Stop. The ACK arrives after 300 ms, then "Sẵn sàng" is required.                    |
| `stop-no-ack`      | Press Stop. No ACK arrives, so the page warns you to use the physical E-stop.             |
| `stale`            | After 3 s all messages stop: values dim, "Dữ liệu cũ", Send is disabled.                  |
| `camera-frozen`    | After 2 s the panoramic camera freezes, and the object camera runs at 6 FPS.              |
| `cmd-nack`         | Every command is rejected, with a reason.                                                 |
| `web-disconnected` | The connection drops at 3 s, reconnects, and refreshes state before re-enabling controls. |
| `estop`            | After 3 s the physical emergency stop is reported.                                        |
| `first-run`        | Clears localStorage, so the "Lần đầu dùng?" hint shows.                                   |
| `empty-history`    | No task history.                                                                          |

The same table (`src/transport/scenarios.ts`) also holds the expected status at given times. `src/state/scenarios.test.ts` runs every scenario end-to-end through the mock and the store, and checks the result with `deriveStatus`.

## Structure

```
src/app          App shell, header + tabs, monitoring page, first-run hint, dev panel
src/components   StopButton, StatusBar, StatusLamp, ErrorBanner, PipelineStrip, TaskHistory,
                 CameraTile, CommandBox, MovementPanel, JointChart, TutorialPage, Icon, Tooltip
src/state        Zustand store (one global store), deriveStatus, trackingQuality, types
src/transport    protocol (message shapes), Transport interface, MockTransport,
                 WebSocketTransport stub, scenarios
src/config       all tunables (thresholds, objects, templates, pipeline steps, charts) + status level icons
src/strings      vi.ts (default), en.ts — all UI text
src/styles       tokens.css (all design tokens), global.css
src/utils        exportLog (CSV + JSON), time, storage
```

Key rules:

- **All status logic** lives in the pure `deriveStatus(state)` function (`src/state/deriveStatus.ts`). The lamp, chips, banner, Send gating and tests all use it.
- **Tracking quality** comes from the pure `trackingQuality()` function. It averages |action − state| over the 5 arm joints (gripper excluded) within `trackingWindowMs`. The level changes only after a threshold has been crossed continuously for `trackingHoldMs`.
- **Freshness** is measured from the time the browser received each message, never from the sender's `ts`.
- **Stop** has no confirmation dialog. The page shows "Đã dừng" only after `stop_ack`. If there is no ACK within `ackTimeoutMs`, the page warns you to use the physical E-stop. After a stop, the robot needs "Sẵn sàng" and then a new command.
- **Commands** each have an id and wait for an ACK or NACK. They are never resent automatically.

## Connecting the real backend

`src/transport/index.ts#createTransport` returns the mock today. Implement `WebSocketTransport` (it currently throws "not implemented") and return it when `VITE_BACKEND_URL` is set (see `.env.example`). The messages it must produce and accept are listed in `src/transport/protocol.ts`.

Camera streams: set `url` for each camera in `src/config/index.ts` to an MJPEG URL. When `url` is empty, the tile shows a neutral placeholder.

## Assumptions

- Threshold values in `src/config` are placeholders to calibrate on the real robot. Joint units are a normalised scale (`config.jointUnit = 'normalized'`).
- Status severity mapping:
  - **Needs action (red):** USB lost, robot error, web disconnected, stop not confirmed, joint possibly stuck.
  - **Waiting for user (blue):** stopped and waiting for "Sẵn sàng".
  - **Attention (amber):** stale data, camera frozen or low FPS, slow tracking, command rejected or not confirmed, task failed, reconnecting.
- After **Kết nối lại** (USB), the mock reports the robot as `stopped`, so the user must still press **Sẵn sàng**.
- A banner message that has cleared stays visible, marked "Đã hết", until the user closes it.
- Task durations use the sender's `startedTs`/`endedTs`.
- NACK and failure reasons are shown exactly as the backend sends them.
