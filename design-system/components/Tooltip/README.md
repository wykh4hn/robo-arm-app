# Tooltip

A small dark popover (`tooltip-bg`, `on-tooltip`, 12px, `shadow-popover` — the only shadow in the system) that explains a technical term in plain Vietnamese.

**Where:** status chips, pipeline steps, 3D toggles, table headers (Vị trí, Sai số, Giới hạn), joint names. Mark the trigger with `rb-term` (dotted underline) and make it focusable; link with `aria-describedby`; show on hover and focus, hide on Escape.

**Writing:** keep the technical term in mono as the lead (`<b>shoulder_pan</b>`), then one plain sentence. Max ~260px wide.
