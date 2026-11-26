# robo-arm-app — notes for Claude Code

Web app that monitors and commands a robot arm doing LIBERO pick-and-place tasks: a React 18 + TypeScript + Vite frontend and a FastAPI backend (`backend/`, port 8001).

Architecture (details in `docs/communication-plan.md` §1): Web ⇄ WebSocket `/ws` ⇄ BE ⇄ HTTP `127.0.0.1:8000` ⇄ LIBERO sim (Franka, contract `franka_ee_v1`) ⇄ TCP 5050 ⇄ Board (runner + model). The BE only calls the sim's Operator API (state poll, reset, stop, resume, heartbeat); it never talks to the Board and never runs the model. The web picks a task (`suite`, `task_id`), not a profile. The old SO-101 path (6 joints, mock sim/board, `/api/evaluation`) is gone. The in-browser `MockTransport` (`?scenario=…`) is for UI dev and tests only.

## Sources of truth
- **Communication (Web ↔ BE ↔ LIBERO sim ↔ Board):** `docs/communication-plan.md` — read it first for any BE/transport work; it overrides `docs/backend-spec.md` §6, §7, §9.1.
- **Behaviour and scope:** `docs/requirements.md`. Follow its build steps, scenarios, config list and "Done when" checklist.
- **Layout sketch:** `docs/sketch.png`.
- **Visual design:** `design-system/`. Read `design-system/README.md` before any UI work, then the `components/<Name>/README.md` of each component you build.

## Using the design system
- Import `design-system/tokens.css` once at the app root (it also declares the fonts). Use its CSS variables for every colour, space, radius, size and font — never hard-code a hex value, px spacing or font name in components.
- Rebuild each component from its `design-system/components/<Name>/preview.html`: same structure, same `rb-*` class names and states (or a CSS module that copies `components/bundle.css` rule for rule). Don't restyle.
- Joint colours: `var(--joint-${jointName})`. Status levels, icons and wording: the tables in `design-system/README.md`.
- Icons: `lucide-react`, with the meanings fixed in the README's Iconography table.
- Fonts: self-host from `design-system/fonts/` (already wired in `tokens.css`); no Google Fonts.
- All UI text goes in `src/strings/vi.ts` and `src/strings/en.ts` (default vi), following the README's content rules.
- To change a token, edit `design-system/tokens.json` and run `node design-system/scripts/build-tokens.mjs`.

## Must not break
- STOP is a real `<button>`, first in the header on every tab, no confirmation, keyboard-operable, never disabled.
- No status shown by colour alone: icon + word every time.
- No animations beyond instant hover/focus colour changes.
