# Field

Label above control: `rb-field` with `rb-field__label` (13px/500, `muted`) and a `rb-select` (36px `size-field`, `border-control`, chevron) or the read-only `rb-preview-cmd`.

**Command preview:** `<output class="rb-preview-cmd">` in mono on `surface-2` shows the exact string that will be sent, built by the config template (default `pick the {object} and put it in the box`). It is read-only and updates as the object changes.

**Rules:** objects come from config (vịt đỏ, vịt vàng, khối lập phương, hộp nhỏ màu hồng). While a task runs, leave the selects usable but Send disabled — or disable the selects too, with the reason written under Send. Helper text uses `rb-help`.
