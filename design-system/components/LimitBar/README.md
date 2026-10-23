# LimitBar

A 56 × 8px meter showing where a joint sits inside its range; the end zones (outside `nearLimitRatio`, 0.9) turn amber when the joint enters them.

**Markup:** `<span class="rb-limit" role="meter" aria-valuemin aria-valuemax aria-valuenow>` with `rb-limit__mark` at `left: <ratio>%`. Near the edge add `is-near` and follow it with a `triangle-alert` icon (wrap both in `rb-limit-wrap`) — the icon is the non-colour cue.
