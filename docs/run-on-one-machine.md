# Chạy simulator và web trên một máy (máy của nhóm IoT)

Một máy chạy hai chương trình. Laptop khác hoặc iPad chỉ cần mở trình duyệt.

| Chương trình | Repo | Cổng | Ai mở |
|---|---|---|---|
| MuJoCo `so101sim/board_server/app.py` (local mode) | Robo-Arm-COS40005 | 8000, chỉ trong máy | BE; người kiểm tra |
| BE + web | robo-arm-app (repo này) | 8001 | Trình duyệt, iPad |

- **Trang 8000** là dashboard riêng của simulator (trạng thái, 2 camera, góc khớp, nút "Đặt lại", "Gắp bóng đỏ", "Dừng/HOLD"). Dùng để IoT kiểm tra simulator.
- **Trang 8001** là web console của SoftDev. Hai camera trên đó lấy từ chính MuJoCo, qua BE.
- **Khi web đang chạy một lượt, đừng bấm nút trên trang 8000.** Bấm "Đặt lại" ở đó thì web kết thúc lượt với lý do "MuJoCo bị đặt lại từ nơi khác"; bấm "Dừng/HOLD" thì lượt thành "MuJoCo tự dừng". Cả hai trường hợp đều cần bấm Sẵn sàng.

## Chuẩn bị một lần

Khuyên dùng **Ubuntu WSL2**, vì IoT đã chạy MuJoCo ở đó (`so101sim/README_VI.md`). Đặt cả hai repo trong thư mục Linux (`~/`), **không** trong `/mnt/c/...`: SQLite của BE cần ổ Linux, và đọc file nhanh hơn.

```bash
cd ~
git clone https://github.com/henryhoang207/Robo-Arm-COS40005.git
git clone https://github.com/wykh4hn/robo-arm-app.git
# Python cho MuJoCo (nếu IoT chưa có sẵn ~/.venvs/so101sim)
python3 -m venv ~/.venvs/so101sim
~/.venvs/so101sim/bin/pip install -r Robo-Arm-COS40005/so101sim/requirements.txt
# Node 20+ để build web một lần, ví dụ qua nvm: nvm install 22
```

Cũng chạy được trong **Git Bash trên Windows**, với `python` thay cho `python3`. Khi đó script tự đặt `MUJOCO_GL=glfw`, vì server MuJoCo mặc định đặt `egl`, mà EGL chỉ có trên Linux.

## Mỗi lần demo: một lệnh

```bash
cd ~/robo-arm-app
git pull
SIM_DIR=~/Robo-Arm-COS40005 SIM_PYTHON=~/.venvs/so101sim/bin/python scripts/demo.sh
```

Script `scripts/demo.sh` làm 4 bước, và dừng với một câu báo lỗi rõ ràng nếu bước nào hỏng:
1. **MuJoCo.**
   - Nếu cổng 8000 trống, script bật `so101sim/board_server/app.py --mode local --no-viewer`. Log ghi ở `backend/data/mujoco.log`.
   - Nếu MuJoCo đang chạy sẵn, script dùng luôn.
   - Nếu cổng 8000 đang là `so101sim/app.py` (bản cũ, sai server), script báo lỗi.
2. **Web.** Build `dist/` nếu chưa có. Đặt `REBUILD=1` để build lại sau khi `git pull`.
3. **Python của BE.** Tạo `backend/.venv`, cài thư viện, tạo `.env` nếu chưa có.
4. **BE ở cổng 8001**, nối MuJoCo thật (`SO101_SIM_LINK=real`). Tay robot do controller tham chiếu của MuJoCo lái (`SO101_BOARD_LINK=reference`), **không phải AI**; web ghi rõ điều này.

Ctrl+C tắt BE, và tắt luôn MuJoCo nếu chính script đã bật nó.

Tuỳ chọn: `SIM_FLAGS="--no-cameras"` nếu máy không vẽ được camera; `BE_PORT=8002` nếu cổng 8001 bận.

## Mở từ iPad hoặc laptop khác (cùng Wi-Fi)

Mở `http://<IP của máy chạy demo>:8001`. Chỉ cần mở cổng **8001**. Cổng 8000 của MuJoCo luôn chỉ nghe trong máy.

**WSL2:** WSL có IP riêng, nên Windows phải chuyển cổng. Chạy trong PowerShell (Run as administrator):

```powershell
$wsl = (wsl hostname -I).Trim().Split(" ")[0]
netsh interface portproxy add v4tov4 listenport=8001 listenaddress=0.0.0.0 connectport=8001 connectaddress=$wsl
New-NetFirewallRule -DisplayName "SO101 web 8001" -Direction Inbound -LocalPort 8001 -Protocol TCP -Action Allow
ipconfig   # lấy IPv4 của Wi-Fi, mở http://<IPv4>:8001 trên iPad
```

IP của WSL đổi sau mỗi lần khởi động lại máy. Khi đó chạy lại hai dòng đầu: xoá bản cũ bằng `netsh interface portproxy delete v4tov4 listenport=8001 listenaddress=0.0.0.0`, rồi thêm bản mới.

**Windows (Git Bash):** chỉ cần dòng `New-NetFirewallRule`.

## Kiểm tra trước khi demo

- [ ] `http://localhost:8000/api/state` có `"schema_version": 2` và `"mode": "local"`.
- [ ] `http://localhost:8001`: đèn "Hệ thống ổn", chip Board ghi "local · tham chiếu, không phải AI".
- [ ] Hai ô camera có hình. Máy không có GPU thì camera chậm và hiện "Hình bị đứng"; điều đó không ảnh hưởng tới lượt chạy.
- [ ] Chọn một profile FP16, bấm **Gửi lệnh**: lượt chạy kết thúc với "Xong" sau khoảng 13 s.
- [ ] Gửi lần nữa, bấm **STOP** giữa chừng: nút hiện "Đã dừng"; bấm **Sẵn sàng** thì robot về "Sẵn sàng".
- [ ] iPad mở được `http://<IP>:8001`.

## Chưa làm được trên máy này

- **AI trên board lái tay robot:** ở board mode, MuJoCo trả 403 cho mọi lệnh của BE, nên BE không gửi được STOP/RESET. Chờ IoT mở một đường điều khiển cho BE (Chung, câu 1).
- **Cảnh bóng vào bát** (quyết định 0009): chưa có API.
