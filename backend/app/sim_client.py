"""SimPort over HTTP to the real MuJoCo `app.py` (path 5, port 8000). PHASE 2, NOT WRITTEN YET.

Owner: SoftDev (Trieu) with IoT (Chung). Until then run with `SO101_SIM_LINK=mock`.

What to implement (spec 7): one `httpx.AsyncClient(base_url=settings.sim_url)`,
never `requests` (rule 2). The runner already wraps every call in a timeout.

| Method          | Call (provisional names, Q4, Q7)            | Returns                      |
|-----------------|---------------------------------------------|------------------------------|
| get_state       | GET  /api/state                             | ports.parse_sim_state(json)  |
| reset           | POST /api/reset  {"seed", "run_id"}         | ResetResult                  |
| stop            | POST /api/stop                              | None                         |
| release_hold    | POST /api/release                           | None; SimRejected on refusal |
| get_evaluation  | GET  /api/evaluation                        | ports.parse_evaluation(json) |
| get_frame       | GET  /api/camera/{overhead|wrist}           | JPEG bytes                   |

Errors: connection or HTTP 5xx -> SimError; a refusal (4xx) -> SimRejected;
a malformed `/api/state` is raised by `parse_sim_state` as SimBadPayload.

`tools/mock_sim.py` serves this same API (`uvicorn tools.mock_sim:app --port 8000`),
and `tests/test_ports_contract.py` holds the checks a real client must also pass.
"""

from __future__ import annotations

from .ports import Evaluation, ResetResult, SimState
from .settings import Settings

_TODO = "sim_client.py is Phase 2 (spec 7). Use SO101_SIM_LINK=mock for now."


class SimClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        raise NotImplementedError(_TODO)

    async def get_state(self) -> SimState:
        raise NotImplementedError(_TODO)

    async def reset(self, seed: int, run_id: int) -> ResetResult:
        raise NotImplementedError(_TODO)

    async def stop(self) -> None:
        raise NotImplementedError(_TODO)

    async def release_hold(self) -> None:
        raise NotImplementedError(_TODO)

    async def get_evaluation(self) -> Evaluation | None:
        raise NotImplementedError(_TODO)

    async def get_frame(self, camera: str) -> bytes:
        raise NotImplementedError(_TODO)

    async def aclose(self) -> None:
        return None
