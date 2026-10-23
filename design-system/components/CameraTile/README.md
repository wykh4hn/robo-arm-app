# CameraTile

A camera feed tile: name, FPS and frame age in the head, the MJPEG image on `camera-bg`, and a button that swaps this camera with the 3D model in the large slot.

**States**
- Live: image fills the area (`object-fit: cover`).
- Frozen (frame older than `cameraFrozenAfterMs` or FPS < `fpsWarn`): `is-frozen` greys the image and shows `rb-tag--warn` "Hình bị đứng" top-left.
- Not configured: `camera-off` icon + "Chưa có URL camera trong config".

**Rules:** two equal tiles under the 3D card ("Nhìn vật (trên xuống)", "Toàn cảnh"); layout changes only on user action; the swap button needs an `aria-label`.
