# FirstVisitHint

A one-line `info` strip shown on the first visit only: "Lần đầu dùng? Mở trang Tutorial…" with an "Mở Tutorial" button and a close icon.

**Consumer provides:** a remembered "dismissed" flag (per browser) and the Tutorial tab handler. Place it under the pipeline strip, above the main columns. Don't show it again once dismissed or once the Tutorial was opened.
