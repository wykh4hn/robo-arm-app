# iPad layout decisions

## Scope

The iPad page is an additive tablet layout based on the existing MonitoringScreen preview. The original desktop preview, design tokens, component previews and source documentation are retained unchanged.

## Landscape

- Two-column layout.
- The visual column receives the larger share of horizontal space.
- The 3D preview and two camera tiles remain together in the visual column.
- The right column uses three tabs: Control & History, Joint Status, and Trajectory & Charts.
- The command area keeps the object selector and send action; the template and command-preview fields are hidden in the tablet layout.

## Portrait

- Single-column layout.
- The visual area appears before the tabbed control and telemetry panel.
- The tabbed panel remains available below the robot view.

## Touch and viewport behavior

- Main buttons, segmented controls and tabs use tablet-sized hit areas.
- The STOP control remains in the sticky header.
- Camera swap controls exchange the current camera placeholder and the main viewport illustration.
- Safe-area padding is applied to the tablet page.
- A triple tap on the project name opens the development scenario panel; `?dev=1` opens it directly.

## Preserved source content

- Existing project name placeholders, including `[Tên dự án]`, are retained as supplied.
- Existing VI/EN controls and original UI copy are retained; no new localization system is claimed.
- Existing design tokens, CSS bundle, HTML previews and original Desktop MonitoringScreen are not rewritten.

## Current limitations

The source snapshot contains static HTML previews. It does not include the production React application, URDF assets, a live 3D renderer, camera streams, application state store or backend protocol implementation. The iPad page therefore changes layout and preview interactions only; it does not create robot-control functionality or live telemetry.

## Layout refinement — 2026-11-10

- Landscape prioritizes the observation workspace: the 3D viewer and two camera tiles occupy approximately two-thirds of the available width; the tabbed control and telemetry panel occupies the remaining third.
- Portrait places the complete observation workspace first, with the 3D viewport above two side-by-side camera tiles. The tabbed control and telemetry workspace follows below it.
- Control, Joint Status, and Charts remain separate tabs. Task history stays within Control and is height-limited so it does not dominate the panel.
- Joint and chart panels remain in the tabbed workspace rather than being placed below the main two-column layout.
- Touch controls retain a minimum 44px target. The 3D viewport keeps touch gestures from scrolling the page while interacting with the viewer.
- The existing desktop preview, original project-name placeholder, tokens, component markup, and design-system source files are retained.
- The current robot viewer and camera areas remain design-system previews/placeholders. This layout work does not add a production URDF renderer, camera stream, or robot connection.


## React application integration

The iPad adaptive layout is now integrated into the React MonitoringPage rather than relying only on the standalone HTML preview.

- Desktop keeps the original three-column MonitoringPage.
- Tablet widths use a visual-first layout with the shared RobotViewer3D and camera components.
- Landscape uses a two-column composition with the visual area wider than the control area.
- Portrait stacks the visual area above the control tabs.
- Control, Joint Status, and Charts are presented as one tab group.
- The existing Zustand store, transport, telemetry types, task handling, chart data, URDF loader, and robot model are reused.
- The previous standalone iPad HTML/CSS/JavaScript preview is retained under design-system for reference.
- The main application chooses the adaptive layout by viewport width; no separate iPad app or second robot renderer is created.

The tablet layout uses the same robot and telemetry state as Desktop. Camera and model rendering remain owned by the existing React components.
