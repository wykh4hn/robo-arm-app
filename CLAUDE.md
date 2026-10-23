# robo-arm-app — notes for Claude Code

Frontend (React 18 + TypeScript + Vite) that monitors and commands an SO-101 robot arm doing pick-and-place ("pick [object] and put it in the box"). Frontend only; data comes from an in-browser mock transport.

## Sources of truth
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
