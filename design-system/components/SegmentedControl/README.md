# SegmentedControl

A row of 2–4 mutually exclusive options in one `border-control` outline: view presets (Phối cảnh · Trên · Trước · Bên), units (độ · rad), chart tabs (Vị trí · Vận tốc · Sai số).

**Markup:** `rb-seg` containing buttons with `aria-pressed` (toggles) or `role="tab"` + `aria-selected` (tabs). Selected: `selected-bg` fill, `info-text` label, 600 weight — not `primary` text, which is under 4.5:1 on the tint.

**Rules:** labels are one or two words; no icons-only segments. Use it only for instant view changes, never for commands.
