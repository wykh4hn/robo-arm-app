# iPad integration checklist

- Desktop MonitoringPage structure retained for widths above 1100px.
- Tablet layout added to the existing React MonitoringPage at widths up to 1100px.
- Existing RobotViewer3D and CameraTile components reused.
- Existing Zustand state and transport contracts retained.
- Tablet tabs: Control, Joint Status, Charts.
- Landscape visual area is wider than the tab panel.
- Portrait places visual monitoring above the tabs.
- Existing standalone iPad preview files are retained under design-system.
- Run `npm install` then `npm start` from this project root.
- Test desktop, iPad landscape, and iPad portrait with browser device emulation and Safari.
