# PipelineStrip

A thin `surface-2` strip under the status bar showing Camera → AI → Gateway → Robot → Kết quả with milliseconds per step.

**Consumer provides:** `pipelineSteps` from config and the latest timings `{step: ms | null, failedAt?: step, reason?}`.

**States**
- Normal: step name in `text`, ms in mono.
- No data: `rb-pipe-step--empty`, value "—" in `muted`.
- Failed: `rb-pipe-step--failed` (warn tint + `triangle-alert` + short reason, e.g. "không thấy vật"); every later step shows "—".

**Rules:** arrows are `chevron-right` in `muted`; add a tooltip per step ("AI: nhận diện vật trong hình camera"). Keep it one line at 1440px.
