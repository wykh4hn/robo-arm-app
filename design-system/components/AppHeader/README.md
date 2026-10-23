# AppHeader

The dark slate bar that holds STOP, the Monitoring | Tutorial tabs, the project name and the VI·EN toggle; it stays at the top of every tab.

**Consumer provides:** active tab, `projectName` from config (subtitle "Tay robot SO-101 · gắp vật bỏ vào hộp"), current language, and the STOP state.

**Anatomy:** `rb-header` (`header` ground, `size-header` 56px) → `rb-stop` → optional `rb-hbtn` *Sẵn sàng* (only after a confirmed stop) → `rb-header__tabs` with `rb-htab[role=tab]` (active: `header-raised` fill + 2px `primary` underline) → `rb-header__project` (name `t-app-title` in `on-header`, subtitle `t-caption` in `on-header-muted`) → `rb-lang` (pressed segment inverts to `on-header` fill).

**Do:** keep tab labels in English ("Monitoring", "Tutorial") as in the spec; keep the header, status bar and pipeline sticky together (`rb-top`).
**Don't:** add more buttons to the header — it holds safety and navigation only.
