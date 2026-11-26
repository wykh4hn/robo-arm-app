# Chương 5. Chữ hai ngôn ngữ và khung giao diện

## Mục tiêu

- Có bộ chữ **tiếng Việt và tiếng Anh**, đổi qua lại bằng nút VI/EN.
- Dựng khung trang: **header** có nút STOP và tab, **thanh trạng thái**, **banner lỗi** và **dải pipeline**.
- Chạy được các kịch bản và **thấy** đèn đổi màu, banner hiện lên khi có sự cố.

## Khái niệm cần nắm

- **Không viết chữ cứng trong component.** Mọi chữ hiển thị nằm trong hai file `vi.ts` và `en.ts`. Component lấy chữ qua hook `useT()`. Lợi ích: đổi ngôn ngữ chỉ là đổi bộ chữ; sửa câu chữ không phải đụng code giao diện.
- **Kiểu bắt buộc khớp.** `vi.ts` khai báo cấu trúc; `en.ts` được gán kiểu `Strings = typeof vi`. Thiếu một khoá tiếng Anh là báo lỗi ngay lúc gõ.
- **Dùng bộ thiết kế có sẵn.** Mỗi thành phần có một thư mục `design-system/components/<Tên>/` chứa `preview.html` (HTML mẫu đúng cấu trúc) và `README.md` (quy tắc). Bạn **sao đúng cấu trúc và class `rb-*`** từ đó thay vì tự đặt kiểu. Nhờ vậy giao diện đồng nhất và đạt chuẩn truy cập.
- **Component chỉ vẽ.** Component nhận `derived` (kết quả của `deriveStatus`) rồi hiển thị. Nó không tự quyết định "có lỗi không".
- **Không chỉ dùng màu.** Mọi trạng thái đều có **biểu tượng và chữ**. Người mù màu và người nhìn ảnh đen trắng vẫn hiểu.
- **Truy cập (accessibility)**: dùng thẻ đúng nghĩa (`<button>`, `<nav>`, `<main>`), vùng thông báo `aria-live` để trình đọc màn hình đọc khi trạng thái đổi, `role="alert"` cho lỗi, bàn phím điều khiển được mọi thứ.

## Làm

### 5.1. Chữ hai ngôn ngữ

Tạo thư mục `src/strings/` rồi tạo file chữ tiếng Việt. Đây là file **dữ liệu**, dài nhưng không có logic. Bạn sẽ dùng dần hết các nhóm khoá qua các chương tiếp theo, nên gõ trọn bây giờ để khỏi quay lại:

**Tạo file `src/strings/vi.ts`**

```ts file=src/strings/vi.ts
export const vi = {
  appTitle: 'SO-101 Monitor',
  skipToMain: 'Bỏ qua tới nội dung chính',
  projectSub: 'Tay robot SO-101 · gắp vật bỏ vào hộp',
  lang: { label: 'Ngôn ngữ', vi: 'VI', en: 'EN' },

  stop: {
    idle: 'STOP',
    stopping: 'Đang dừng…',
    stopped: 'Đã dừng',
    unconfirmed: 'Chưa xác nhận dừng',
    note: 'Dùng nút dừng khẩn cấp vật lý trên robot.',
    ready: 'Sẵn sàng',
    announce: {
      idle: '',
      stopping: 'Đã gửi lệnh dừng, đang chờ xác nhận.',
      stopped: 'Robot đã dừng. Bấm Sẵn sàng trước khi gửi lệnh mới.',
      unconfirmed: 'Chưa xác nhận dừng. Dùng nút dừng khẩn cấp vật lý.',
    },
  },
  tabs: { label: 'Trang', monitoring: 'Monitoring', tutorial: 'Tutorial' },

  levels: {
    estop: 'Dừng khẩn cấp',
    action: 'Cần xử lý',
    waiting: 'Chờ người dùng',
    attention: 'Cần chú ý',
    ok: 'Hệ thống ổn',
  },
  levelMeaning: {
    estop: 'Nút dừng khẩn cấp vật lý đang được nhấn; motor đã bị cắt.',
    action: 'Có lỗi làm robot dừng hoặc không điều khiển được.',
    waiting: 'Robot đã dừng an toàn và chờ bạn.',
    attention: 'Có điều bất thường nhẹ; robot vẫn làm việc được.',
    ok: 'Mọi thứ bình thường.',
  },
  levelTodo: {
    estop: 'Kiểm tra an toàn, nhả nút, rồi bấm Sẵn sàng.',
    action: 'Đọc thông báo đỏ và làm theo "Việc cần làm".',
    waiting: 'Bấm Sẵn sàng rồi gửi lệnh mới.',
    attention: 'Để ý ô có màu; không cần dừng robot.',
    ok: 'Không cần làm gì.',
  },

  status: {
    label: 'Trạng thái hệ thống',
    connection: 'Kết nối',
    robot: 'Robot',
    task: 'Task',
    tracking: 'Độ bám lệnh',
    web: 'Web',
    usb: 'USB',
    webLost: 'Web mất · thử lại lần {n}',
    webConnecting: 'Web đang kết nối',
    webSyncing: 'Web · đang tải lại trạng thái',
    updated: 'Cập nhật {n} trước',
    noData: 'Chưa có dữ liệu',
    stale: 'Dữ liệu cũ',
    unknown: 'Không rõ',
    stoppedReady: 'Đã dừng · bấm Sẵn sàng',
    seconds: '{n} s',
    tips: {
      connection: 'Web: trình duyệt ↔ gateway, kèm độ trễ ms. USB: gateway ↔ tay robot.',
      robot: 'Trạng thái do robot báo về: sẵn sàng, đang chạy, đã dừng hoặc lỗi.',
      task: 'Task đang chạy: số thứ tự, việc đang làm và thời gian đã chạy.',
      tracking:
        'Robot đi theo lệnh sát tới đâu: trung bình |lệnh − vị trí đo| của 5 khớp tay trong 1 s gần nhất.',
      updated: 'Thời gian từ lúc trình duyệt nhận tin nhắn cuối cùng.',
    },
    announce: 'Trạng thái: {level}.',
  },
  values: {
    usb: { plugged: 'ổn', lost: 'mất', unknown: 'không rõ' },
    robot: {
      ready: 'Sẵn sàng',
      moving: 'Đang chạy',
      stopped: 'Đã dừng',
      error: 'Lỗi',
      unknown: 'Không rõ',
      estop: 'Dừng khẩn cấp',
    },
    task: {
      idle: 'Rảnh',
      running: 'Đang chạy',
      done: 'Xong',
      failed: 'Thất bại',
      stopped: 'Đã dừng',
    },
    tracking: { good: 'Tốt', slow: 'Chậm', stuck: 'Có thể bị kẹt' },
  },
  taskPhase: {
    reach: 'Đang tiến tới {object}',
    grasp: 'Đang gắp {object}',
    carry: 'Đang mang {object} tới hộp',
    release: 'Đang thả {object} vào hộp',
    home: 'Đang về vị trí nghỉ',
  },

  banner: {
    robotLabel: 'Robot',
    todoLabel: 'Việc cần làm',
    openTutorial: 'Xem hướng dẫn',
    reconnectUsb: 'Kết nối lại USB',
    ready: 'Sẵn sàng',
    errorCodes: {
      OVERLOAD: 'quá tải ở khớp {joint}',
      OVERHEAT: 'quá nhiệt ở khớp {joint}',
      default: 'mã {code}',
    },
    titles: {
      estop: 'Nút dừng khẩn cấp vật lý đang được nhấn',
      webDown: 'Mất kết nối tới gateway',
      usbLost: 'Mất kết nối USB với tay robot',
      robotError: 'Robot báo lỗi: {detail}',
      stopUnconfirmed: 'Chưa xác nhận lệnh dừng sau {s} s',
      stale: 'Dữ liệu cũ: không nhận được tin nhắn trong {s} s',
      trackingStuck: 'Robot có thể bị kẹt: vị trí đo không theo kịp lệnh',
    },
    robot: {
      estop: 'Đã dừng bởi nút dừng khẩn cấp. Robot không tự chạy lại.',
      webDown: 'Không rõ — robot có thể vẫn đang chạy task.',
      usbLost: 'Không rõ — gateway không còn điều khiển được tay robot.',
      robotError: 'Đã dừng — task bị huỷ.',
      stopUnconfirmed: 'Không rõ — robot có thể vẫn đang chuyển động.',
      stale: 'Không rõ. Nút Gửi lệnh tạm khoá.',
      trackingStuck: 'Vẫn nhận lệnh nhưng không di chuyển theo.',
    },
    todo: {
      estop: 'Kiểm tra an toàn quanh robot, nhả nút dừng khẩn cấp, rồi bấm Sẵn sàng.',
      webDown:
        'Nếu cần dừng ngay, dùng nút dừng khẩn cấp vật lý. Khi có lại kết nối, giao diện tải lại trạng thái rồi mới mở khoá điều khiển.',
      usbLost:
        'Kiểm tra cáp USB giữa gateway và tay robot, rồi bấm Kết nối lại USB. Nếu robot còn chuyển động, dùng nút dừng khẩn cấp vật lý.',
      robotError: 'Gỡ vật cản, kiểm tra dây servo, rồi bấm Sẵn sàng và gửi lệnh mới.',
      stopUnconfirmed: 'Bấm nút dừng khẩn cấp vật lý trên robot ngay.',
      stale: 'Kiểm tra mạng và gateway. Giao diện tự mở khoá khi dữ liệu mới về.',
      trackingStuck: 'Bấm STOP, kiểm tra vật cản hoặc dây vướng quanh tay robot.',
    },
  },

  hint: {
    strong: 'Lần đầu dùng?',
    text: 'Mở trang Tutorial để biết cách đọc màn hình và khi nào cần bấm STOP.',
    open: 'Mở Tutorial',
    close: 'Đóng gợi ý',
  },

  pipeline: {
    title: 'Chuỗi xử lý',
    steps: { camera: 'Camera', ai: 'AI', gateway: 'Gateway', robot: 'Robot', result: 'Kết quả' },
    tips: {
      camera: 'Camera: thời gian lấy và gửi một khung hình.',
      ai: 'AI: nhận diện vật trong hình camera và tính lệnh khớp.',
      gateway: 'Gateway: bộ điều khiển trung gian chuyển lệnh xuống tay robot.',
      robot: 'Robot: thời gian tay robot nhận và thực hiện lệnh.',
      result: 'Kết quả: robot báo task xong hay thất bại.',
    },
    ms: '{n} ms',
    none: '—',
  },

  command: {
    title: 'Ra lệnh',
    template: 'Mẫu lệnh',
    templates: { pick_into_box: 'Gắp [vật] bỏ vào hộp' },
    templateVi: { pick_into_box: 'Gắp {object} bỏ vào hộp' },
    object: 'Vật thể',
    objects: {
      red_duck: 'vịt đỏ',
      yellow_duck: 'vịt vàng',
      cube: 'khối lập phương',
      pink_box: 'hộp nhỏ màu hồng',
    },
    preview: 'Lệnh sẽ gửi',
    send: 'Gửi lệnh',
    blocked: {
      estop: 'Nút dừng khẩn cấp đang được nhấn. Nhả nút rồi bấm Sẵn sàng.',
      disconnected: 'Mất kết nối tới gateway. Đợi kết nối lại.',
      syncing: 'Đang tải lại trạng thái sau khi kết nối lại.',
      stale: 'Dữ liệu cũ. Đợi dữ liệu mới về.',
      usbLost: 'Mất kết nối USB với tay robot.',
      robotError: 'Robot đang báo lỗi. Xử lý lỗi rồi bấm Sẵn sàng.',
      stopping: 'Đang chờ robot xác nhận lệnh dừng.',
      stopped: 'Robot đã dừng. Bấm Sẵn sàng trước khi gửi lệnh mới.',
      busy: 'Đang có task chạy (#{task}). Đợi task xong hoặc bấm STOP.',
      pending: 'Đang chờ robot xác nhận lệnh trước.',
    },
    stepperLabel: 'Tiến trình lệnh',
    steps: {
      sent: 'Đã gửi',
      waiting: 'Đã gửi · chờ xác nhận',
      accepted: 'Đã nhận',
      running: 'Đang chạy',
      ran: 'Đã chạy',
      done: 'Xong',
      doneIn: 'Xong · {s}',
      failed: 'Thất bại',
      failedReason: 'Thất bại · {reason}',
      stopped: 'Đã dừng',
      rejected: 'Bị từ chối',
      noAck: 'Không có xác nhận',
    },
    nackTitle: 'Robot từ chối lệnh:',
    nackTail: 'Lệnh chưa được thực hiện; sửa rồi gửi lại.',
    noAckText:
      'Không nhận được ACK sau 2 s. Lệnh không được gửi lại tự động; kiểm tra robot trước khi gửi lại.',
  },

  history: {
    title: 'Lịch sử task',
    sub: 'Mới nhất ở trên',
    started: 'Bắt đầu',
    empty1: 'Chưa có task nào trong phiên này.',
    empty2: 'Chọn vật thể ở thẻ Ra lệnh rồi bấm Gửi lệnh.',
  },

  viewer: {
    title: 'Mô hình 3D · thời gian thực',
    sub: 'Dựng từ URDF SO-101 theo vị trí đo của từng khớp',
    presetsLabel: 'Góc nhìn',
    presets: { perspective: 'Phối cảnh', top: 'Trên', front: 'Trước', side: 'Bên' },
    layersLabel: 'Lớp hiển thị',
    layers: {
      ghost: 'Bóng lệnh',
      trail: 'Vệt đầu kẹp',
      plan: 'Quỹ đạo dự kiến',
      axes: 'Hệ trục',
      labels: 'Tên khớp',
    },
    layerTips: {
      ghost:
        'Tay robot "bóng" màu xanh theo lệnh (action). Đi trước tay thật một chút là bình thường.',
      trail: 'Đường đầu kẹp đã đi trong 10 s gần nhất; càng cũ càng mờ.',
      plan: 'Đường robot định đi tiếp, kèm điểm gắp và điểm thả.',
      axes: 'Hệ trục gốc robot: đỏ = x, xanh lá = y, xanh dương = z.',
      labels: 'Hiện tên kỹ thuật của từng khớp trên mô hình.',
    },
    reset: 'Đặt lại góc nhìn',
    ee: 'Đầu kẹp (mm)',
    eeValue: 'x {x} · y {y} · z {z}',
    legend: {
      measured: 'Tư thế đo được',
      commanded: 'Tư thế đang ra lệnh',
      trail: 'Vệt đầu kẹp 10 s',
      plan: 'Quỹ đạo dự kiến',
    },
    noUrdf: 'Không tải được URDF ở {path}. Đang hiển thị chuỗi khớp đơn giản thay thế.',
    loading: 'Đang tải mô hình URDF…',
    noWebgl: 'Trình duyệt không hỗ trợ WebGL nên không vẽ được mô hình 3D.',
    pick: '{object} · điểm gắp',
    drop: 'Hộp · điểm thả',
    canvasLabel: 'Mô hình 3D tay robot SO-101',
  },

  joints: {
    title: 'Trạng thái khớp',
    unitLabel: 'Đơn vị góc',
    units: { deg: 'độ', rad: 'rad' },
    cols: {
      joint: 'Khớp',
      position: 'Vị trí',
      velocity: 'Vận tốc',
      command: 'Lệnh',
      error: 'Sai số',
      limit: 'Giới hạn',
    },
    unitSuffix: { deg: '°', rad: 'rad', degS: '°/s', radS: 'rad/s', pct: '%' },
    colTips: {
      position: 'Vị trí đo được của khớp (state).',
      velocity: 'Tốc độ quay của khớp; từ servo, hoặc ước tính từ vị trí.',
      command: 'Vị trí AI đang ra lệnh cho khớp (action).',
      error: '|lệnh − vị trí|. Chuyển vàng khi vượt ngưỡng {warn}°.',
      limit: 'Khớp đang ở đâu trong hành trình (theo URDF). Vàng khi gần hết hành trình.',
    },
    estimated: 'ước tính',
    desc: {
      shoulder_pan: 'xoay đế',
      shoulder_lift: 'nâng vai',
      elbow_flex: 'gập khuỷu',
      wrist_flex: 'gập cổ tay',
      wrist_roll: 'xoay cổ tay',
      gripper: 'kẹp · % mở',
    },
    jointTips: {
      shoulder_pan: 'khớp xoay đế: quay cả cánh tay sang trái hoặc phải quanh trục đứng.',
      shoulder_lift: 'khớp nâng vai: nâng hoặc hạ cả cánh tay.',
      elbow_flex: 'khớp khuỷu: gập hoặc duỗi cẳng tay.',
      wrist_flex: 'khớp cổ tay: gập đầu kẹp lên hoặc xuống.',
      wrist_roll: 'khớp xoay cổ tay: xoay đầu kẹp quanh trục của nó.',
      gripper: 'kẹp: độ mở của ngón kẹp, tính bằng % (0 = đóng hết).',
    },
    quality: 'Độ bám lệnh: {level}',
    qualityDetail: ' · sai số TB {err} trên 5 khớp',
    qualityIdle: 'Độ bám lệnh: — (robot đang đứng yên)',
    velocityServo: 'Vận tốc đo từ servo.',
    velocityEstimated: 'Vận tốc ước tính từ vị trí (sai phân, có làm mượt).',
    gripperNote:
      'Kẹp không tính vào độ bám lệnh, vì khi giữ vật lệnh luôn đóng sâu hơn vị trí thật.',
    nearLimit: 'gần giới hạn',
    limitAria: '{joint}: {pct}% hành trình',
  },

  charts: {
    title: 'Quỹ đạo khớp theo thời gian',
    live: 'Trực tiếp',
    backToLive: 'Trở lại trực tiếp',
    download: 'Tải log',
    tabsLabel: 'Loại biểu đồ',
    tabs: { position: 'Vị trí', velocity: 'Vận tốc', error: 'Sai số' },
    keyState: 'Nét liền: vị trí đo',
    keyAction: 'Nét đứt: lệnh',
    keyVelocity: 'Nét liền: vận tốc đo',
    keyError: 'Nét liền: |lệnh − vị trí|',
    groups: { arm: 'Cánh tay', wrist: 'Cổ tay và kẹp' },
    measured: 'đo',
    commanded: 'lệnh',
    chartAria: 'Biểu đồ {group}: {joints}',
    toggle: 'Hiện {joint}',
  },

  camera: {
    names: { object: 'Nhìn vật (trên xuống)', overview: 'Toàn cảnh' },
    meta: '{fps} fps · {age} s',
    metaNone: '— fps · —',
    frozen: 'Hình bị đứng',
    noUrl: 'Chưa có URL camera trong config',
    swap: 'Đổi chỗ với mô hình 3D',
    swapBack: 'Đưa mô hình 3D về ô lớn',
  },

  tutorial: {
    title: 'Hướng dẫn sử dụng',
    tocLabel: 'Mục lục',
    toc: {
      purpose: 'Màn hình này để làm gì',
      status: 'Đọc thanh trạng thái',
      model: 'Đọc mô hình 3D',
      joints: 'Bảng khớp và biểu đồ',
      command: 'Gửi một lệnh',
      stop: 'STOP và nút dừng khẩn cấp',
      incidents: 'Khi có sự cố',
      glossary: 'Thuật ngữ',
    },
    purpose:
      'Màn hình Monitoring cho bạn xem tay robot SO-101 đang làm gì theo thời gian thực và ra lệnh "gắp một vật bỏ vào hộp". Bốn thứ quan trọng nhất: mô hình 3D, vị trí và vận tốc từng khớp, quỹ đạo, và nút STOP.',
    statusIntro:
      'Ô đầu tiên là đèn tổng: luôn hiện mức nặng nhất đang xảy ra. Các ô còn lại màu xám khi bình thường và chỉ đổi màu khi có chuyện. Mỗi mức luôn có biểu tượng và chữ.',
    statusCols: { level: 'Mức', meaning: 'Ý nghĩa', todo: 'Bạn cần làm gì' },
    statusChips:
      'Sau đèn tổng là Kết nối (Web và USB), Robot, Task và Độ bám lệnh. Bên phải là "Cập nhật … trước": thời gian từ lúc trình duyệt nhận dữ liệu cuối cùng. Quá {stale} s không có dữ liệu thì số liệu chuyển sang "Dữ liệu cũ".',
    model: {
      measured: 'Tay robot thật đang ở đâu, dựng từ vị trí đo của từng khớp.',
      commanded:
        '"Bóng" màu xanh: nơi robot đang được bảo đi tới. Bóng đi trước tay thật một chút là bình thường.',
      trail: 'Đường đầu kẹp vừa đi qua; càng cũ càng mờ.',
      plan: 'Đường robot định đi tiếp: tới điểm gắp rồi sang điểm thả.',
      controls:
        'Kéo chuột để xoay, cuộn để phóng to, hoặc chọn Phối cảnh / Trên / Trước / Bên. "Đặt lại góc nhìn" đưa camera về ban đầu.',
    },
    joints: [
      'Mỗi khớp có một màu cố định, dùng giống nhau ở bảng, biểu đồ và mô hình 3D. Sai số là khoảng cách giữa lệnh và vị trí đo; chuyển vàng khi vượt {warn}°. Thanh Giới hạn chuyển vàng và có dấu cảnh báo khi khớp vượt {near}% hành trình.',
      'Trên biểu đồ, nét liền là vị trí đo, nét đứt là lệnh. Rê chuột để tạm dừng và đọc giá trị; bấm "Trở lại trực tiếp" để chạy tiếp. Bấm một dòng trong bảng để làm nổi khớp đó.',
    ],
    command: [
      'Chọn mẫu lệnh và vật thể, kiểm tra dòng "Lệnh sẽ gửi", rồi bấm Gửi lệnh. Theo dõi các bước:',
      'Nút Gửi lệnh bị khoá khi mất kết nối, dữ liệu cũ, robot lỗi hoặc đã dừng, hay đang có task chạy — lý do luôn ghi ngay bên dưới nút. Lệnh không bao giờ tự gửi lại.',
    ],
    stopSoft: {
      title: 'STOP trên màn hình',
      body: 'Nút đỏ đầu tiên trên thanh trên cùng, có ở mọi trang. Bấm một lần là gửi lệnh dừng qua phần mềm, không hỏi lại; dùng được bằng bàn phím (Tab rồi Enter). Chỉ hiện "Đã dừng" khi robot xác nhận. Không có xác nhận sau 2 s thì dùng nút vật lý.',
    },
    stopHard: {
      title: 'Nút dừng khẩn cấp vật lý',
      body: 'Nút trên robot hoặc bộ nguồn, cắt điện motor. Luôn hoạt động kể cả khi mất mạng hay phần mềm treo. Dùng khi có nguy hiểm thật.',
    },
    stopAfter:
      'Sau khi dừng, robot không bao giờ tự chạy lại, kể cả sau khi kết nối lại: bấm Sẵn sàng, rồi gửi lệnh mới.',
    incidentCols: { see: 'Bạn thấy', todo: 'Việc cần làm' },
    incidents: {
      usbLost: {
        see: 'Mất kết nối USB với tay robot',
        todo: 'Kiểm tra cáp USB, bấm "Kết nối lại USB", rồi bấm Sẵn sàng. Robot có thể còn giữ tư thế; dùng nút vật lý nếu cần.',
      },
      robotError: {
        see: 'Robot báo lỗi',
        todo: 'Robot đã tự dừng. Đọc tên khớp trong thông báo, gỡ vật cản, kiểm tra dây servo, rồi bấm Sẵn sàng.',
      },
      frozen: {
        see: 'Hình bị đứng',
        todo: 'Camera không gửi hình mới. Kiểm tra cáp camera; mô hình 3D vẫn đúng vì dựa trên số liệu khớp.',
      },
      rejected: {
        see: 'Bị từ chối',
        todo: 'Đọc lý do NACK dưới nút Gửi lệnh (ví dụ: không thấy vật), sửa rồi gửi lại.',
      },
      stale: {
        see: 'Dữ liệu cũ',
        todo: 'Không có tin nhắn mới quá {stale} s. Số liệu trên màn hình có thể sai; kiểm tra mạng.',
      },
    },
    glossary: [
      { term: 'URDF', def: 'Tệp mô tả hình dạng và các khớp của robot; dùng để dựng mô hình 3D.' },
      {
        term: 'shoulder_pan … gripper',
        def: 'Tên kỹ thuật của 6 khớp: xoay đế, nâng vai, gập khuỷu, gập cổ tay, xoay cổ tay, kẹp.',
      },
      { term: 'action / state', def: 'Lệnh AI gửi cho robot / vị trí robot đo được thực tế.' },
      { term: 'rad, rad/s', def: 'Radian: đơn vị góc (1 rad ≈ 57,3°) và tốc độ quay.' },
      { term: 'ACK / NACK', def: 'Robot xác nhận đã nhận lệnh / từ chối lệnh kèm lý do.' },
      { term: 'Gateway', def: 'Bộ điều khiển trung gian giữa máy chủ AI và tay robot.' },
      { term: 'Độ bám lệnh', def: 'Robot đi theo lệnh sát tới đâu: Tốt, Chậm hoặc Có thể bị kẹt.' },
      { term: 'Đầu kẹp (end-effector)', def: 'Đầu ngón kẹp; vị trí x, y, z tính bằng mm.' },
      { term: 'E-stop', def: 'Nút dừng khẩn cấp vật lý: cắt điện motor, không qua phần mềm.' },
    ],
  },

  dev: {
    title: 'Dev panel',
    scenario: 'Kịch bản',
    hint: 'Ctrl+Shift+D để ẩn/hiện. Đổi kịch bản sẽ tải lại trang.',
    close: 'Đóng',
  },
};

export type Strings = typeof vi;
```


Cấu trúc theo **tính năng**, mỗi nhóm ứng với một phần giao diện:

- `stop`, `tabs`, `levels`, `levelMeaning`, `levelTodo`: nút STOP, tab, các mức trạng thái (cũng dùng cho trang Tutorial).
- `status`, `values`, `taskPhase`: thanh trạng thái, các giá trị Web/USB/Robot/Task, câu mô tả đang làm gì.
- `banner`: banner lỗi, mỗi lỗi có ba phần: **tiêu đề** (chuyện gì xảy ra), **robot** (đã dừng chưa), **todo** (cần làm gì).
- `pipeline`, `command`, `history`: dải pipeline, hộp ra lệnh, lịch sử task.
- `viewer`, `joints`, `charts`, `camera`: mô hình 3D, bảng khớp, biểu đồ, camera.
- `tutorial`, `dev`: trang hướng dẫn, bảng dev.

Cách viết chữ (theo `design-system/README.md`): ngắn, bình tĩnh, nói rõ việc cần làm. Không dấu chấm than, không emoji. Lỗi nêu **cụ thể** ("Robot báo lỗi: quá tải ở khớp elbow_flex") và luôn có "Việc cần làm". Chỗ có `{n}`, `{code}` là **chỗ điền giá trị** khi chạy.

Giờ tạo file tiếng Anh. **Thử tự dịch trước**: bạn tạo `src/strings/en.ts` rỗng với dòng đầu `import type { Strings } from './vi'; export const en: Strings = { ... }`, rồi để TypeScript chỉ ra từng khoá còn thiếu (`npm run typecheck`). Khi muốn đối chiếu hoặc bỏ qua việc dịch, mở bản dưới:

<details>
<summary>Mở để xem toàn bộ <code>src/strings/en.ts</code> (bản dịch tiếng Anh)</summary>

**Tạo file `src/strings/en.ts`**

```ts file=src/strings/en.ts
import type { Strings } from './vi';

export const en: Strings = {
  appTitle: 'SO-101 Monitor',
  skipToMain: 'Skip to main content',
  projectSub: 'SO-101 arm · pick an object, put it in the box',
  lang: { label: 'Language', vi: 'VI', en: 'EN' },

  stop: {
    idle: 'STOP',
    stopping: 'Stopping…',
    stopped: 'Stopped',
    unconfirmed: 'Stop not confirmed',
    note: 'Use the physical emergency stop on the robot.',
    ready: 'Ready',
    announce: {
      idle: '',
      stopping: 'Stop sent, waiting for confirmation.',
      stopped: 'Robot stopped. Press Ready before sending a new command.',
      unconfirmed: 'Stop not confirmed. Use the physical emergency stop.',
    },
  },
  tabs: { label: 'Pages', monitoring: 'Monitoring', tutorial: 'Tutorial' },

  levels: {
    estop: 'Emergency stop',
    action: 'Needs action',
    waiting: 'Waiting for user',
    attention: 'Attention',
    ok: 'System OK',
  },
  levelMeaning: {
    estop: 'The physical emergency stop is pressed; motor power is cut.',
    action: 'A fault stopped the robot or it cannot be controlled.',
    waiting: 'The robot stopped safely and is waiting for you.',
    attention: 'Something is slightly off; the robot can still work.',
    ok: 'Everything is normal.',
  },
  levelTodo: {
    estop: 'Check it is safe, release the button, then press Ready.',
    action: 'Read the red message and follow "What to do".',
    waiting: 'Press Ready, then send a new command.',
    attention: 'Watch the tinted item; no need to stop the robot.',
    ok: 'Nothing to do.',
  },

  status: {
    label: 'System status',
    connection: 'Connection',
    robot: 'Robot',
    task: 'Task',
    tracking: 'Tracking',
    web: 'Web',
    usb: 'USB',
    webLost: 'Web lost · retry {n}',
    webConnecting: 'Web connecting',
    webSyncing: 'Web · reloading state',
    updated: 'Updated {n} ago',
    noData: 'No data yet',
    stale: 'Stale data',
    unknown: 'Unknown',
    stoppedReady: 'Stopped · press Ready',
    seconds: '{n} s',
    tips: {
      connection: 'Web: browser ↔ gateway, with latency in ms. USB: gateway ↔ robot arm.',
      robot: 'State reported by the robot: ready, moving, stopped or error.',
      task: 'Running task: number, current step and elapsed time.',
      tracking:
        'How closely the robot follows commands: mean |command − measured| of the 5 arm joints over the last 1 s.',
      updated: 'Time since the browser received the last message.',
    },
    announce: 'Status: {level}.',
  },
  values: {
    usb: { plugged: 'OK', lost: 'lost', unknown: 'unknown' },
    robot: {
      ready: 'Ready',
      moving: 'Moving',
      stopped: 'Stopped',
      error: 'Error',
      unknown: 'Unknown',
      estop: 'Emergency stop',
    },
    task: {
      idle: 'Idle',
      running: 'Running',
      done: 'Done',
      failed: 'Failed',
      stopped: 'Stopped',
    },
    tracking: { good: 'Good', slow: 'Slow', stuck: 'Possibly stuck' },
  },
  taskPhase: {
    reach: 'Reaching the {object}',
    grasp: 'Grasping the {object}',
    carry: 'Carrying the {object} to the box',
    release: 'Releasing the {object} into the box',
    home: 'Returning to rest',
  },

  banner: {
    robotLabel: 'Robot',
    todoLabel: 'What to do',
    openTutorial: 'Open the tutorial',
    reconnectUsb: 'Reconnect USB',
    ready: 'Ready',
    errorCodes: {
      OVERLOAD: 'overload on joint {joint}',
      OVERHEAT: 'overheating on joint {joint}',
      default: 'code {code}',
    },
    titles: {
      estop: 'The physical emergency stop is pressed',
      webDown: 'Lost connection to the gateway',
      usbLost: 'Lost USB connection to the robot arm',
      robotError: 'Robot error: {detail}',
      stopUnconfirmed: 'Stop not confirmed after {s} s',
      stale: 'Stale data: no message received for {s} s',
      trackingStuck: 'Robot may be stuck: measured position is not following the command',
    },
    robot: {
      estop: 'Stopped by the emergency stop. It will not restart by itself.',
      webDown: 'Unknown — the robot may still be running the task.',
      usbLost: 'Unknown — the gateway can no longer control the arm.',
      robotError: 'Stopped — task cancelled.',
      stopUnconfirmed: 'Unknown — the robot may still be moving.',
      stale: 'Unknown. Send is disabled for now.',
      trackingStuck: 'Still receiving commands but not moving with them.',
    },
    todo: {
      estop: 'Check it is safe around the robot, release the emergency stop, then press Ready.',
      webDown:
        'If it must stop now, use the physical emergency stop. When the link is back, the page reloads the state before unlocking controls.',
      usbLost:
        'Check the USB cable between gateway and arm, then press Reconnect USB. If the arm still moves, use the physical emergency stop.',
      robotError:
        'Remove any obstacle, check the servo cables, then press Ready and send a new command.',
      stopUnconfirmed: 'Press the physical emergency stop on the robot now.',
      stale: 'Check the network and the gateway. Controls unlock when fresh data arrives.',
      trackingStuck: 'Press STOP and check for obstacles or caught cables around the arm.',
    },
  },

  hint: {
    strong: 'First time?',
    text: 'Open the Tutorial to learn how to read this screen and when to press STOP.',
    open: 'Open Tutorial',
    close: 'Dismiss hint',
  },

  pipeline: {
    title: 'Pipeline',
    steps: { camera: 'Camera', ai: 'AI', gateway: 'Gateway', robot: 'Robot', result: 'Result' },
    tips: {
      camera: 'Camera: time to capture and send one frame.',
      ai: 'AI: detects the object in the camera image and computes joint commands.',
      gateway: 'Gateway: intermediate controller forwarding commands to the arm.',
      robot: 'Robot: time for the arm to receive and execute the command.',
      result: 'Result: the robot reports the task as done or failed.',
    },
    ms: '{n} ms',
    none: '—',
  },

  command: {
    title: 'Command',
    template: 'Command template',
    templates: { pick_into_box: 'Pick [object] into the box' },
    templateVi: { pick_into_box: 'Pick the {object} into the box' },
    object: 'Object',
    objects: {
      red_duck: 'red duck',
      yellow_duck: 'yellow duck',
      cube: 'cube',
      pink_box: 'pink small box',
    },
    preview: 'Command to send',
    send: 'Send command',
    blocked: {
      estop: 'The emergency stop is pressed. Release it, then press Ready.',
      disconnected: 'Disconnected from the gateway. Wait for the reconnect.',
      syncing: 'Reloading state after the reconnect.',
      stale: 'Stale data. Wait for fresh data.',
      usbLost: 'USB connection to the arm is lost.',
      robotError: 'The robot reports an error. Fix it, then press Ready.',
      stopping: 'Waiting for the robot to confirm the stop.',
      stopped: 'The robot is stopped. Press Ready before a new command.',
      busy: 'A task is running (#{task}). Wait for it to finish or press STOP.',
      pending: 'Waiting for the robot to confirm the previous command.',
    },
    stepperLabel: 'Command progress',
    steps: {
      sent: 'Sent',
      waiting: 'Sent · waiting for ACK',
      accepted: 'Received',
      running: 'Running',
      ran: 'Ran',
      done: 'Done',
      doneIn: 'Done · {s}',
      failed: 'Failed',
      failedReason: 'Failed · {reason}',
      stopped: 'Stopped',
      rejected: 'Rejected',
      noAck: 'Not confirmed',
    },
    nackTitle: 'The robot rejected the command:',
    nackTail: 'It was not executed; fix the cause and send again.',
    noAckText:
      'No ACK after 2 s. The command is not resent automatically; check the robot before sending again.',
  },

  history: {
    title: 'Task history',
    sub: 'Newest first',
    started: 'Started',
    empty1: 'No tasks in this session yet.',
    empty2: 'Choose an object in the Command card, then press Send command.',
  },

  viewer: {
    title: '3D model · real time',
    sub: 'Built from the SO-101 URDF using each joint’s measured position',
    presetsLabel: 'View',
    presets: { perspective: 'Perspective', top: 'Top', front: 'Front', side: 'Side' },
    layersLabel: 'Layers',
    layers: {
      ghost: 'Command ghost',
      trail: 'Gripper trail',
      plan: 'Planned path',
      axes: 'Axes',
      labels: 'Joint names',
    },
    layerTips: {
      ghost:
        'Blue "ghost" arm driven by the command (action). Leading the real arm slightly is normal.',
      trail: 'Path of the gripper tip over the last 10 s; older is fainter.',
      plan: 'Where the robot plans to go next, with pick and drop points.',
      axes: 'Robot base axes: red = x, green = y, blue = z.',
      labels: 'Show each joint’s technical name on the model.',
    },
    reset: 'Reset view',
    ee: 'Gripper tip (mm)',
    eeValue: 'x {x} · y {y} · z {z}',
    legend: {
      measured: 'Measured pose',
      commanded: 'Commanded pose',
      trail: 'Gripper trail 10 s',
      plan: 'Planned path',
    },
    noUrdf: 'Could not load the URDF at {path}. Showing a simple placeholder chain instead.',
    loading: 'Loading the URDF model…',
    noWebgl: 'This browser has no WebGL, so the 3D model cannot be drawn.',
    pick: '{object} · pick point',
    drop: 'Box · drop point',
    canvasLabel: '3D model of the SO-101 arm',
  },

  joints: {
    title: 'Joint state',
    unitLabel: 'Angle unit',
    units: { deg: 'deg', rad: 'rad' },
    cols: {
      joint: 'Joint',
      position: 'Position',
      velocity: 'Velocity',
      command: 'Command',
      error: 'Error',
      limit: 'Limit',
    },
    unitSuffix: { deg: '°', rad: 'rad', degS: '°/s', radS: 'rad/s', pct: '%' },
    colTips: {
      position: 'Measured joint position (state).',
      velocity: 'Joint speed; from the servo, or estimated from positions.',
      command: 'Position the AI is commanding (action).',
      error: '|command − position|. Turns amber above {warn}°.',
      limit: 'Where the joint sits in its range (from the URDF). Amber near the end.',
    },
    estimated: 'estimated',
    desc: {
      shoulder_pan: 'base rotation',
      shoulder_lift: 'shoulder lift',
      elbow_flex: 'elbow',
      wrist_flex: 'wrist flex',
      wrist_roll: 'wrist roll',
      gripper: 'gripper · % open',
    },
    jointTips: {
      shoulder_pan: 'base joint: turns the whole arm left or right around the vertical axis.',
      shoulder_lift: 'shoulder joint: raises or lowers the whole arm.',
      elbow_flex: 'elbow joint: bends or straightens the forearm.',
      wrist_flex: 'wrist joint: tilts the gripper up or down.',
      wrist_roll: 'wrist roll: spins the gripper around its own axis.',
      gripper: 'gripper: how far the jaw is open, in % (0 = fully closed).',
    },
    quality: 'Tracking: {level}',
    qualityDetail: ' · mean error {err} over 5 joints',
    qualityIdle: 'Tracking: — (robot is not moving)',
    velocityServo: 'Velocity measured by the servos.',
    velocityEstimated: 'Velocity estimated from positions (finite difference, smoothed).',
    gripperNote:
      'The gripper is excluded from tracking: when holding an object the command closes further than the real position.',
    nearLimit: 'near limit',
    limitAria: '{joint}: {pct}% of range',
  },

  charts: {
    title: 'Joint trajectories over time',
    live: 'Live',
    backToLive: 'Back to live',
    download: 'Download log',
    tabsLabel: 'Chart type',
    tabs: { position: 'Position', velocity: 'Velocity', error: 'Error' },
    keyState: 'Solid: measured',
    keyAction: 'Dashed: command',
    keyVelocity: 'Solid: measured velocity',
    keyError: 'Solid: |command − position|',
    groups: { arm: 'Arm', wrist: 'Wrist and gripper' },
    measured: 'meas.',
    commanded: 'cmd',
    chartAria: '{group} chart: {joints}',
    toggle: 'Show {joint}',
  },

  camera: {
    names: { object: 'Object view (top-down)', overview: 'Overview' },
    meta: '{fps} fps · {age} s',
    metaNone: '— fps · —',
    frozen: 'Frozen image',
    noUrl: 'No camera URL in config',
    swap: 'Swap with the 3D model',
    swapBack: 'Put the 3D model back in the large slot',
  },

  tutorial: {
    title: 'How to use this screen',
    tocLabel: 'Contents',
    toc: {
      purpose: 'What this screen is for',
      status: 'Reading the status bar',
      model: 'Reading the 3D model',
      joints: 'Joint table and charts',
      command: 'Sending a command',
      stop: 'STOP and the emergency stop',
      incidents: 'When something goes wrong',
      glossary: 'Glossary',
    },
    purpose:
      'The Monitoring screen shows what the SO-101 arm is doing in real time and lets you command "pick an object and put it in the box". The four key parts: the 3D model, each joint’s position and velocity, the trajectory, and the STOP button.',
    statusIntro:
      'The first chip is the overall lamp: it always shows the most severe active level. The other chips are grey when normal and only take a colour when something is off. Every level has an icon and a word.',
    statusCols: { level: 'Level', meaning: 'Meaning', todo: 'What to do' },
    statusChips:
      'After the lamp come Connection (Web and USB), Robot, Task and Tracking. On the right, "Updated … ago" is the time since the browser received the last data. After {stale} s without data, values switch to "Stale data".',
    model: {
      measured: 'Where the real arm is, built from each joint’s measured position.',
      commanded:
        'The blue "ghost": where the robot is being told to go. The ghost leading the real arm slightly is normal.',
      trail: 'The path the gripper tip just took; older is fainter.',
      plan: 'Where the robot plans to go next: to the pick point, then the drop point.',
      controls:
        'Drag to orbit, scroll to zoom, or pick Perspective / Top / Front / Side. "Reset view" restores the camera.',
    },
    joints: [
      'Each joint has a fixed colour used identically in the table, charts and 3D model. Error is the gap between command and measured position; it turns amber above {warn}°. The Limit bar turns amber with a warning icon past {near}% of the joint’s range.',
      'In the charts, solid lines are measured positions and dashed lines are commands. Hover to pause and read values; press "Back to live" to resume. Click a table row to highlight that joint.',
    ],
    command: [
      'Choose a template and an object, check "Command to send", then press Send command. Follow the steps:',
      'Send is disabled when disconnected, when data is stale, when the robot has an error or is stopped, or while a task runs — the reason is always written right below. Commands are never resent automatically.',
    ],
    stopSoft: {
      title: 'On-screen STOP',
      body: 'The first red button in the top bar, on every page. One press sends a software stop, no confirmation; works by keyboard (Tab then Enter). Shows "Stopped" only once the robot confirms. With no confirmation after 2 s, use the physical button.',
    },
    stopHard: {
      title: 'Physical emergency stop',
      body: 'The button on the robot or power supply; it cuts motor power. Always works, even with no network or a frozen app. Use it for real danger.',
    },
    stopAfter:
      'After a stop the robot never restarts by itself, not even after reconnecting: press Ready, then send a new command.',
    incidentCols: { see: 'You see', todo: 'What to do' },
    incidents: {
      usbLost: {
        see: 'Lost USB connection to the robot arm',
        todo: 'Check the USB cable, press "Reconnect USB", then press Ready. The arm may still hold its pose; use the physical button if needed.',
      },
      robotError: {
        see: 'Robot error',
        todo: 'The robot stopped by itself. Read the joint name in the message, remove obstacles, check servo cables, then press Ready.',
      },
      frozen: {
        see: 'Frozen image',
        todo: 'The camera sends no new frames. Check the camera cable; the 3D model is still right because it uses joint data.',
      },
      rejected: {
        see: 'Rejected',
        todo: 'Read the NACK reason under Send command (e.g. object not found), fix it and send again.',
      },
      stale: {
        see: 'Stale data',
        todo: 'No new message for over {stale} s. Values on screen may be wrong; check the network.',
      },
    },
    glossary: [
      {
        term: 'URDF',
        def: 'File describing the robot’s shape and joints; used to build the 3D model.',
      },
      {
        term: 'shoulder_pan … gripper',
        def: 'Technical names of the 6 joints: base rotation, shoulder lift, elbow, wrist flex, wrist roll, gripper.',
      },
      {
        term: 'action / state',
        def: 'Command the AI sends / position the robot actually measured.',
      },
      { term: 'rad, rad/s', def: 'Radian: unit of angle (1 rad ≈ 57.3°) and of turning speed.' },
      { term: 'ACK / NACK', def: 'The robot accepted the command / rejected it with a reason.' },
      { term: 'Gateway', def: 'Intermediate controller between the AI server and the arm.' },
      {
        term: 'Tracking',
        def: 'How closely the robot follows commands: Good, Slow or Possibly stuck.',
      },
      { term: 'End-effector', def: 'The gripper tip; x, y, z position in mm.' },
      { term: 'E-stop', def: 'Physical emergency stop: cuts motor power, bypasses software.' },
    ],
  },

  dev: {
    title: 'Dev panel',
    scenario: 'Scenario',
    hint: 'Ctrl+Shift+D to toggle. Changing scenario reloads the page.',
    close: 'Close',
  },
};
```

</details>


Cuối cùng là hook dùng chữ:

**Tạo file `src/strings/index.ts`**

```ts file=src/strings/index.ts
import { useStore } from '../state/store';
import type { Lang } from '../state/types';
import { en } from './en';
import { vi, type Strings } from './vi';

export type { Strings };

export const STRINGS: Record<Lang, Strings> = { vi, en };

/** Current UI strings. */
export function useT(): Strings {
  return STRINGS[useStore((s) => s.lang)];
}

/** Replaces {name} placeholders. */
export function fmt(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}
```


- `STRINGS` ghép hai ngôn ngữ. `useT()` đọc ngôn ngữ hiện tại từ store (`s.lang`) rồi trả đúng bộ chữ. Khi `lang` đổi, mọi component dùng `useT()` tự vẽ lại.
- `fmt('Cập nhật {n} trước', { n: '2 s' })` thay mọi `{tên}` bằng giá trị. Ký tự thiếu thì giữ nguyên `{tên}` để dễ phát hiện.

### 5.2. Biểu tượng và mức trạng thái

Tạo thư mục `src/components/` và file:

**Tạo file `src/components/Icon.tsx`**

```tsx file=src/components/Icon.tsx
import {
  Bot,
  Camera,
  CameraOff,
  Check,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleHelp,
  CircleMinus,
  CircleX,
  Clock,
  Crosshair,
  Download,
  Hand,
  Info,
  ListChecks,
  LoaderCircle,
  Maximize2,
  OctagonAlert,
  Play,
  RotateCcw,
  Send,
  TriangleAlert,
  Unplug,
  Wifi,
  WifiOff,
  X,
  type LucideIcon,
} from 'lucide-react';

// Fixed meanings from design-system/README.md (Iconography).
const ICONS = {
  stop: CircleMinus,
  ok: CircleCheck,
  check: Check,
  warn: TriangleAlert,
  critical: CircleX,
  estop: OctagonAlert,
  waiting: Hand,
  running: LoaderCircle,
  pending: Circle,
  wifi: Wifi,
  wifiOff: WifiOff,
  unplug: Unplug,
  robot: Bot,
  task: ListChecks,
  tracking: Crosshair,
  clock: Clock,
  send: Send,
  play: Play,
  download: Download,
  reset: RotateCcw,
  swap: Maximize2,
  help: CircleHelp,
  info: Info,
  close: X,
  camera: Camera,
  cameraOff: CameraOff,
  chevron: ChevronRight,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

interface IconProps {
  name: IconName;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  label?: string;
}

/** Lucide icon with the design-system sizes. Decorative unless `label` is given. */
export function Icon({ name, size = 'md', className = '', label }: IconProps) {
  const C = ICONS[name];
  const cls = `rb-ic ${size === 'sm' ? 'rb-ic--sm' : size === 'lg' ? 'rb-ic--lg' : ''} ${className}`;
  return label ? (
    <C className={cls} aria-label={label} role="img" />
  ) : (
    <C className={cls} aria-hidden="true" focusable="false" />
  );
}
```


- Bộ thiết kế quy định **mỗi biểu tượng có một nghĩa cố định** (xem bảng "Iconography" trong `design-system/README.md`): `stop` là vòng tròn gạch ngang, `warn` là tam giác cảnh báo, `critical` là vòng tròn dấu X...
- Ánh xạ này nằm **một chỗ**: component khác gọi `<Icon name="warn" />` mà không biết đến Lucide. Đổi bộ biểu tượng chỉ sửa file này.
- `satisfies Record<string, LucideIcon>` kiểm tra mọi giá trị đúng kiểu mà **vẫn giữ** danh sách khoá cụ thể, nên `IconName = keyof typeof ICONS` là một liên hiệp tên chính xác.
- Biểu tượng luôn là trang trí (`aria-hidden`) vì đã có chữ đi kèm. Chỉ khi đứng một mình mới truyền `label`.

Tạo file ánh xạ mức trạng thái (dùng chung cho thanh trạng thái **và** trang Tutorial, để hai nơi không lệch nhau):

**Tạo file `src/config/levels.ts`**

```ts file=src/config/levels.ts
// Level -> icon and chip class. Used by the app AND the Tutorial table.
import type { IconName } from '../components/Icon';
import { LEVELS, type Level } from '../state/types';
import type { TaskState } from '../types/messages';

export const LEVEL_ORDER = LEVELS;

export const LEVEL_META: Record<Level, { icon: IconName; chip: string }> = {
  estop: { icon: 'estop', chip: 'rb-chip--estop' },
  action: { icon: 'critical', chip: 'rb-chip--critical' },
  waiting: { icon: 'waiting', chip: 'rb-chip--info' },
  attention: { icon: 'warn', chip: 'rb-chip--warn' },
  ok: { icon: 'ok', chip: 'rb-chip--ok' },
};

/** Detail chips stay neutral when normal and take their own tone only when abnormal. */
export function detailChipClass(level: Level): string {
  return level === 'ok' ? '' : LEVEL_META[level].chip;
}

export const TASK_STATUS: Record<TaskState, { icon: IconName; cls: string }> = {
  idle: { icon: 'pending', cls: '' },
  running: { icon: 'running', cls: 'rb-task__status--running' },
  done: { icon: 'ok', cls: 'rb-task__status--done' },
  failed: { icon: 'critical', cls: 'rb-task__status--failed' },
  stopped: { icon: 'stop', cls: 'rb-task__status--stopped' },
};
```


- `LEVEL_META`: mỗi mức có biểu tượng và class chip tương ứng (`rb-chip--critical`...).
- `detailChipClass`: **chip chi tiết bình thường để trung tính (xám)**, chỉ khi bất thường mới đổi sang màu của mức đó. Chỉ riêng **đèn tổng** mới xanh lá khi mọi thứ ổn.
- `TASK_STATUS`: biểu tượng và class cho trạng thái của task trong lịch sử.

### 5.3. Tooltip

**Tạo file `src/components/Tooltip.tsx`**

```tsx file=src/components/Tooltip.tsx
import { useId, useState, type ReactNode } from 'react';

interface TooltipProps {
  /** Plain text, or rich content (technical term in <b>, then one sentence). */
  content: ReactNode;
  /** Receives the tooltip id; put it on the focusable trigger as aria-describedby. */
  children: (describedBy: string) => ReactNode;
  align?: 'start' | 'end';
  /** Open upwards (for triggers near the bottom of the screen). */
  up?: boolean;
}

/** rb-tip popover on hover and focus; Escape hides it. */
export function Tooltip({ content, children, align = 'start', up = false }: TooltipProps) {
  const id = useId();
  const [hidden, setHidden] = useState(false);
  return (
    <span
      className={`app-tipwrap ${align === 'end' ? 'app-tipwrap--end' : ''} ${up ? 'app-tipwrap--up' : ''} ${hidden ? 'is-hidden' : ''}`}
      onKeyDown={(e) => e.key === 'Escape' && setHidden(true)}
      onPointerLeave={() => setHidden(false)}
      onBlur={() => setHidden(false)}
    >
      {children(id)}
      <span className="rb-tip" role="tooltip" id={id}>
        {content}
      </span>
    </span>
  );
}
```


- Mẫu **render prop**: `children` là **một hàm** nhận `id` của bong bóng và trả phần tử gốc. Nhờ đó người dùng Tooltip gắn `aria-describedby={id}` vào đúng phần tử cần mô tả (liên kết cho trình đọc màn hình).
- `useId()` tạo mã duy nhất ổn định cho mỗi tooltip.
- Hiện khi **rê chuột hoặc focus bàn phím** (phần CSS ở 5.8), ẩn bằng phím **Escape** mà không cần rời chỗ (yêu cầu truy cập: người dùng có thể tắt nội dung nổi).

### 5.4. Nút STOP

**Tạo file `src/components/StopButton.tsx`**

```tsx file=src/components/StopButton.tsx
import { useStore } from '../state/store';
import type { StopPhase } from '../state/types';
import { useT } from '../strings';
import { Icon, type IconName } from './Icon';

const ICON: Record<StopPhase, IconName> = {
  idle: 'stop',
  stopping: 'running',
  stopped: 'ok',
  unconfirmed: 'warn',
};

/**
 * Software STOP: first control in the header on every tab, no confirmation,
 * never disabled. "Đã dừng" only after the robot's ACK.
 */
export function StopButton() {
  const t = useT();
  const phase = useStore((s) => s.stop.phase);
  const requestStop = useStore((s) => s.requestStop);
  const label = phase === 'idle' ? t.stop.idle : t.stop[phase];

  return (
    <>
      <button
        type="button"
        className="rb-stop"
        data-state={phase === 'idle' ? undefined : phase}
        onClick={requestStop}
        aria-describedby={phase === 'unconfirmed' ? 'stop-note' : undefined}
      >
        <Icon name={ICON[phase]} />
        {label}
      </button>
      {phase === 'unconfirmed' && (
        <span className="rb-stop-note" id="stop-note">
          {t.stop.note}
        </span>
      )}
      <span className="rb-sr" aria-live="polite">
        {t.stop.announce[phase]}
      </span>
    </>
  );
}
```


- Là `<button>` thật với class `rb-stop`. `data-state` quyết định hình dạng và chữ (bộ thiết kế có CSS cho `stopping`, `stopped`, `unconfirmed`).
- Chữ lấy từ `t.stop[phase]`. **"Đã dừng" chỉ hiện khi `phase === 'stopped'`**, tức là sau `stop_ack` của robot.
- **Không có `disabled`, không có hộp thoại xác nhận**: bấm là gọi `requestStop` ngay.
- Phần phụ: khi `unconfirmed`, hiện câu "Dùng nút dừng khẩn cấp vật lý trên robot" (liên kết với nút qua `aria-describedby`), và một vùng `aria-live="polite"` ẩn (`rb-sr`) để trình đọc màn hình **đọc to** mỗi lần trạng thái STOP đổi.

### 5.5. Header

**Tạo file `src/app/Header.tsx`**

```tsx file=src/app/Header.tsx
import type { KeyboardEvent } from 'react';
import { config } from '../config';
import { Icon } from '../components/Icon';
import { StopButton } from '../components/StopButton';
import type { DerivedStatus } from '../state/deriveStatus';
import { useStore } from '../state/store';
import type { Lang, Tab } from '../state/types';
import { useT } from '../strings';

const TABS: Tab[] = ['monitoring', 'tutorial'];
const LANGS: Lang[] = ['vi', 'en'];

export function Header({ derived }: { derived: DerivedStatus }) {
  const t = useT();
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const lang = useStore((s) => s.lang);
  const setLang = useStore((s) => s.setLang);
  const sendReady = useStore((s) => s.sendReady);

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = TABS.indexOf(tab);
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]!;
    setTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  };

  return (
    <header className="rb-header">
      <StopButton />
      {derived.needsReady && (
        <button
          type="button"
          className="rb-hbtn"
          aria-disabled={!derived.canReady}
          onClick={() => derived.canReady && sendReady()}
        >
          <Icon name="play" />
          {t.stop.ready}
        </button>
      )}
      <nav className="rb-header__tabs" role="tablist" aria-label={t.tabs.label}>
        {TABS.map((id) => (
          <button
            key={id}
            id={`tab-${id}`}
            type="button"
            role="tab"
            className="rb-htab"
            aria-selected={tab === id}
            aria-controls="main"
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={onTabKey}
          >
            {t.tabs[id]}
          </button>
        ))}
      </nav>
      <div className="rb-header__project">
        <div className="rb-header__name">{config.projectName}</div>
        <div className="rb-header__sub">{t.projectSub}</div>
      </div>
      <div className="rb-lang" role="group" aria-label={t.lang.label}>
        {LANGS.map((l) => (
          <button
            key={l}
            type="button"
            lang={l}
            aria-pressed={lang === l}
            onClick={() => setLang(l)}
          >
            {t.lang[l]}
          </button>
        ))}
      </div>
    </header>
  );
}
```


- Thứ tự phần tử **cố định**: STOP → (nút "Sẵn sàng" chỉ khi cần) → các tab → tên dự án → nút ngôn ngữ. STOP luôn đầu tiên, nên Tab bàn phím đầu tiên rơi vào nó.
- `role="tablist"`, `role="tab"`, `aria-selected`: hai tab `Monitoring` và `Tutorial` theo chuẩn truy cập. Hàm `onTabKey` cho phép chuyển tab bằng **phím mũi tên trái/phải** (chuẩn thao tác tab), `tabIndex` chỉ cho tab đang chọn vào được bằng Tab.
- Nút "Sẵn sàng" dùng `aria-disabled` thay cho `disabled`: nút vẫn focus được (người dùng bàn phím nghe được lý do), nhưng bấm không có tác dụng khi `canReady` sai.
- `lang={l}` trên nút VI/EN giúp trình đọc màn hình đọc đúng giọng.

### 5.6. Thanh trạng thái

Tạo hook nhỏ gọi `deriveStatus`:

**Tạo file `src/state/useDerived.ts`**

```ts file=src/state/useDerived.ts
import { useMemo } from 'react';
import { deriveStatus, type DerivedStatus } from './deriveStatus';
import { useStore } from './store';

/** Derived status for the current store snapshot. */
export function useDerived(): DerivedStatus {
  const state = useStore();
  return useMemo(() => deriveStatus(state), [state]);
}
```


- `useStore()` lấy toàn bộ state, `useMemo` chỉ tính lại khi state đổi. Đây là **điểm duy nhất** trong giao diện gọi `deriveStatus`; cả trang dùng chung một kết quả.

Tạo file tiện ích chữ (`commandText.ts` có hai hàm dùng ở nhiều chỗ):

**Tạo file `src/utils/commandText.ts`**

```ts file=src/utils/commandText.ts
import type { DerivedStatus } from '../state/deriveStatus';
import type { Strings } from '../strings';
import { fmt } from '../strings';

/** "Gắp vịt đỏ bỏ vào hộp": commands read in the UI language, sent in English. */
export function commandLabel(
  t: Strings,
  item: { command: string; templateId?: string; params?: Record<string, string> },
): string {
  const tpl = item.templateId
    ? (t.command.templateVi as Record<string, string>)[item.templateId]
    : undefined;
  const objectId = item.params?.object;
  const object = objectId ? (t.command.objects as Record<string, string>)[objectId] : undefined;
  return tpl && object ? fmt(tpl, { object }) : item.command;
}

/** Task chip text: phase with object while running, else the state word. */
export function taskText(t: Strings, d: DerivedStatus['task']): string {
  if (d.state === null) return t.status.unknown;
  if (d.state === 'running' && d.phase) {
    const object = d.object ? ((t.command.objects as Record<string, string>)[d.object] ?? '') : '';
    return fmt(t.taskPhase[d.phase], { object });
  }
  return t.values.task[d.state];
}
```


- `taskText`: chữ của chip Task, ví dụ "Đang tiến tới vịt đỏ". `commandLabel`: lệnh hiển thị bằng tiếng Việt trong lịch sử ("Gắp vịt đỏ bỏ vào hộp") dù chuỗi gửi đi vẫn là tiếng Anh.

Tạo file thanh trạng thái:

**Tạo file `src/components/StatusBar.tsx`**

```tsx file=src/components/StatusBar.tsx
import type { ReactNode } from 'react';
import { detailChipClass, LEVEL_META } from '../config/levels';
import type { DerivedStatus } from '../state/deriveStatus';
import { useStore } from '../state/store';
import type { Level } from '../state/types';
import { fmt, useT } from '../strings';
import { taskText } from '../utils/commandText';
import { formatNumber } from '../utils/units';
import { Icon, type IconName } from './Icon';
import { Tooltip } from './Tooltip';

interface ChipProps {
  icon: IconName;
  label: string;
  level: Level;
  tip: string;
  stale?: boolean;
  children: ReactNode;
}

function Chip({ icon, label, level, tip, stale, children }: ChipProps) {
  return (
    <Tooltip content={tip}>
      {(id) => (
        <span
          className={`rb-chip ${stale ? 'is-stale' : detailChipClass(level)}`}
          tabIndex={0}
          aria-describedby={id}
          data-level={level}
        >
          <Icon name={icon} />
          <span className="rb-chip__label">{label}</span>
          <span className="rb-chip__value">{children}</span>
        </span>
      )}
    </Tooltip>
  );
}

export function StatusBar({ derived }: { derived: DerivedStatus }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const { connection: c, robot, task, tracking, stale, ageMs } = derived;
  const lamp = LEVEL_META[derived.overall];

  let web: ReactNode;
  if (c.web === 'disconnected' || c.web === 'failed') web = fmt(t.status.webLost, { n: c.attempt });
  else if (c.web === 'connecting') web = t.status.webConnecting;
  else if (c.latencyMs === null) web = t.status.webSyncing;
  else
    web = (
      <>
        {t.status.web}{' '}
        <span className="rb-chip__num">{fmt(t.pipeline.ms, { n: c.latencyMs })}</span>
      </>
    );
  const webDown = c.web !== 'connected';
  const connIcon: IconName = webDown ? 'wifiOff' : c.usb === 'lost' ? 'unplug' : 'wifi';

  const robotText =
    robot.value === 'stopped' && robot.level === 'waiting'
      ? t.status.stoppedReady
      : t.values.robot[robot.value];

  const seconds = (ms: number) => fmt(t.status.seconds, { n: formatNumber(ms / 1000, 1, lang) });
  const [before, after] = t.status.updated.split('{n}');

  return (
    <div className="rb-statusbar" role="status" aria-live="polite" aria-label={t.status.label}>
      <span
        className={`rb-chip rb-chip--lamp ${lamp.chip}`}
        data-testid="lamp"
        data-level={derived.overall}
      >
        <Icon name={lamp.icon} />
        {t.levels[derived.overall]}
      </span>
      <Chip
        icon={connIcon}
        label={t.status.connection}
        level={c.level}
        tip={t.status.tips.connection}
      >
        {web}
        {!webDown && (
          <>
            {' · '}
            {t.status.usb} {t.values.usb[c.usb]}
          </>
        )}
      </Chip>
      <Chip
        icon="robot"
        label={t.status.robot}
        level={robot.level}
        tip={t.status.tips.robot}
        stale={stale}
      >
        {robotText}
      </Chip>
      <Chip
        icon="task"
        label={t.status.task}
        level={task.level}
        tip={t.status.tips.task}
        stale={stale}
      >
        {task.id !== null && <span className="rb-chip__num">#{task.id}</span>}{' '}
        {task.id === null && task.state === 'idle' ? t.values.task.idle : taskText(t, task)}
        {task.elapsedMs !== null && (
          <>
            {' '}
            <span className="rb-chip__num">
              {fmt(t.status.seconds, { n: Math.floor(task.elapsedMs / 1000) })}
            </span>
          </>
        )}
      </Chip>
      <Chip
        icon="tracking"
        label={t.status.tracking}
        level={tracking.level}
        tip={t.status.tips.tracking}
        stale={stale}
      >
        {tracking.value ? t.values.tracking[tracking.value] : '—'}
      </Chip>
      <Tooltip content={t.status.tips.updated} align="end">
        {(id) => (
          <span
            className="rb-statusbar__updated"
            tabIndex={0}
            aria-describedby={id}
            aria-live="off"
          >
            {stale ? (
              <span className="rb-tag rb-tag--warn">
                <Icon name="warn" size="sm" />
                {t.status.stale}
              </span>
            ) : (
              <Icon name="clock" size="sm" />
            )}
            {ageMs === null ? (
              t.status.noData
            ) : (
              <span>
                {before}
                <span className="rb-mono">{seconds(ageMs)}</span>
                {after}
              </span>
            )}
          </span>
        )}
      </Tooltip>
    </div>
  );
}
```


- `Chip` là component nhỏ: biểu tượng + nhãn + giá trị, bọc trong `Tooltip` và cho focus được (`tabIndex={0}`) để người dùng bàn phím cũng xem được giải thích.
- Chip mặc định trung tính; chỉ thêm màu qua `detailChipClass(level)`. Khi dữ liệu cũ (`stale`), chip chuyển sang kiểu viền đứt `is-stale`.
- `Cập nhật x s trước` tính từ `ageMs` (từ `deriveStatus`): thời gian kể từ lần **trình duyệt** nhận tin cuối. Khi dữ liệu cũ, đổi thành thẻ cảnh báo "Dữ liệu cũ".
- Thanh có `role="status"` và `aria-live="polite"`: khi đèn tổng đổi, trình đọc màn hình đọc nhẹ nhàng, không ngắt lời.
- Hiển thị con số bằng `formatNumber` (chương 3) nên vi/en đúng dấu thập phân.

### 5.7. Banner lỗi và dải pipeline

**Tạo file `src/components/ErrorBanner.tsx`**

```tsx file=src/components/ErrorBanner.tsx
import { config } from '../config';
import type { DerivedStatus } from '../state/deriveStatus';
import { useStore } from '../state/store';
import type { Problem } from '../state/types';
import { fmt, useT, type Strings } from '../strings';
import { formatNumber } from '../utils/units';
import { Icon } from './Icon';

type BannerKind = keyof Strings['banner']['titles'];

function title(t: Strings, p: Problem, lang: 'vi' | 'en'): string {
  const kind = p.kind as BannerKind;
  if (kind === 'robotError') {
    const codes = t.banner.errorCodes as Record<string, string>;
    const tpl = codes[String(p.params.code)] ?? t.banner.errorCodes.default;
    return fmt(t.banner.titles.robotError, { detail: fmt(tpl, p.params) });
  }
  if (kind === 'stale') {
    return fmt(t.banner.titles.stale, { s: formatNumber(Number(p.params.seconds), 1, lang) });
  }
  if (kind === 'stopUnconfirmed') {
    return fmt(t.banner.titles.stopUnconfirmed, { s: config.ackTimeoutMs / 1000 });
  }
  return t.banner.titles[kind];
}

/**
 * Under the status bar only when something is wrong: what happened, whether
 * the robot stopped, what to do next. No close button; it stays while the
 * condition lasts.
 */
export function ErrorBanner({ derived }: { derived: DerivedStatus }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const setTab = useStore((s) => s.setTab);
  const reconnectUsb = useStore((s) => s.reconnectUsb);
  if (derived.banner.length === 0) return null;

  return (
    <div className="rb-banner-slot app-banners">
      {derived.banner.map((p) => {
        const kind = p.kind as BannerKind;
        const warn = p.banner === 'warn';
        return (
          <div
            key={p.key}
            className={`rb-banner ${warn ? 'rb-banner--warn' : ''}`}
            role="alert"
            data-kind={kind}
          >
            <Icon name={kind === 'estop' ? 'estop' : warn ? 'warn' : 'critical'} size="lg" />
            <div>
              <p className="rb-banner__title">{title(t, p, lang)}</p>
              <dl className="rb-banner__facts">
                <dt>{t.banner.robotLabel}</dt>
                <dd>{t.banner.robot[kind]}</dd>
                <dt>{t.banner.todoLabel}</dt>
                <dd>{t.banner.todo[kind]}</dd>
              </dl>
            </div>
            <div className="rb-banner__actions">
              {kind === 'usbLost' && (
                <button type="button" className="rb-btn rb-btn--primary" onClick={reconnectUsb}>
                  <Icon name="unplug" />
                  {t.banner.reconnectUsb}
                </button>
              )}
              {kind !== 'stopUnconfirmed' && (
                <button
                  type="button"
                  className="rb-btn"
                  onClick={() => {
                    setTab('tutorial');
                    requestAnimationFrame(() =>
                      document.getElementById('tut-incidents')?.scrollIntoView(),
                    );
                  }}
                >
                  <Icon name="help" />
                  {t.banner.openTutorial}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```


- Danh sách banner lấy thẳng từ `derived.banner`. Mỗi banner luôn trả lời **ba câu**: tiêu đề (chuyện gì xảy ra), "Robot:" (đã dừng chưa), "Việc cần làm:".
- `title(...)` ghép câu động: lỗi robot thì tra `errorCodes` theo mã (ví dụ `OVERLOAD` → "quá tải ở khớp {joint}"), thiếu mã thì dùng câu mặc định.
- **Không có nút đóng.** Banner tự biến mất khi điều kiện hết, không biến mất theo giờ.
- Hai nút hành động theo ngữ cảnh: "Kết nối lại USB" khi mất USB; "Xem hướng dẫn" nhảy sang tab Tutorial tới đúng mục sự cố.
- `role="alert"` khiến trình đọc màn hình đọc **ngay** khi banner xuất hiện (khác `polite` của thanh trạng thái).

**Tạo file `src/components/PipelineStrip.tsx`**

```tsx file=src/components/PipelineStrip.tsx
import { Fragment } from 'react';
import { config } from '../config';
import { useStore } from '../state/store';
import { fmt, useT } from '../strings';
import { Icon } from './Icon';
import { Tooltip } from './Tooltip';

/** Camera -> AI -> Gateway -> Robot -> Result, with ms per step. */
export function PipelineStrip({ stale }: { stale: boolean }) {
  const t = useT();
  const pipeline = useStore((s) => s.pipeline);
  const steps = config.pipelineSteps;
  const failedIdx = pipeline?.failed ? steps.indexOf(pipeline.failed.step) : -1;

  return (
    <div className="rb-pipeline" role="group" aria-label={t.pipeline.title}>
      <span className="rb-pipeline__title">{t.pipeline.title}</span>
      {steps.map((id, i) => {
        const failed = !stale && i === failedIdx;
        const ms = stale || (failedIdx !== -1 && i >= failedIdx) ? undefined : pipeline?.steps[id];
        const empty = !failed && ms === undefined;
        return (
          <Fragment key={id}>
            {i > 0 && <Icon name="chevron" className="rb-pipe-arrow" />}
            <Tooltip content={t.pipeline.tips[id]}>
              {(tipId) => (
                <span
                  className={`rb-pipe-step ${failed ? 'rb-pipe-step--failed' : ''} ${empty ? 'rb-pipe-step--empty' : ''}`}
                  tabIndex={0}
                  aria-describedby={tipId}
                  data-step={id}
                  data-failed={failed || undefined}
                >
                  {failed && <Icon name="warn" size="sm" />}
                  {t.pipeline.steps[id]}{' '}
                  <span className="rb-pipe-step__ms">
                    {failed
                      ? (pipeline?.failed?.reason ?? t.pipeline.none)
                      : ms === undefined
                        ? t.pipeline.none
                        : fmt(t.pipeline.ms, { n: ms })}
                  </span>
                </span>
              )}
            </Tooltip>
          </Fragment>
        );
      })}
    </div>
  );
}
```


- Năm bước Camera → AI → Gateway → Robot → Kết quả, mỗi bước có số ms trong `pipeline.steps`. Bước **lỗi** hiện biểu tượng cảnh báo và lý do; **các bước sau nó** hiện `—` (chưa tới). Khi dữ liệu cũ cũng hiện `—` vì số cũ không còn đáng tin.
- Dùng `Fragment` có `key` để chèn mũi tên giữa các bước.

### 5.8. CSS "keo dán"

Bộ thiết kế lo phần lớn CSS. File này chỉ thêm những gì còn thiếu: tooltip, tiện ích khoảng cách, bố cục co giãn cho màn nhỏ. **Quy tắc: chỉ dùng biến** như `var(--space-3)`, `var(--surface)`, không ghi cứng mã màu hay cỡ.

**Tạo file `src/styles/app.css`**

```css file=src/styles/app.css
/* App-level glue on top of design-system/components/bundle.css.
   Only tokens are used here: no literal colours, spacing or fonts. */

.app-skip {
  position: absolute;
  left: var(--space-2);
  top: -48px;
  z-index: 30;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--surface);
  color: var(--text);
}
.app-skip:focus {
  top: var(--space-2);
}

main:focus {
  outline: none;
}

/* utilities */
.app-m0 {
  margin: 0;
}
.app-mt2 {
  margin-top: var(--space-2);
}
.app-mt3 {
  margin-top: var(--space-3);
}
.app-mb3 {
  margin-bottom: var(--space-3);
}
.app-flex1 {
  flex: 1;
}
.app-center {
  align-items: center;
}
.app-caption {
  font-size: 12px;
  line-height: 16px;
}
.app-muted {
  color: var(--muted);
}
.app-stack-3 {
  display: grid;
  gap: var(--space-3);
}
.app-stack-4 {
  display: grid;
  gap: var(--space-4);
}
.app-row-wrap {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-4);
}
.app-dim {
  opacity: var(--opacity-dim);
}
.app-foot {
  display: grid;
  gap: var(--space-1);
  border-top: 0;
}
.app-doc-h2 {
  font-size: 18px;
  line-height: 26px;
}

/* Header: STOP note can wrap */
.rb-header {
  min-width: 0;
}

/* Banners and hint sit under the sticky top */
.app-banners {
  display: grid;
  gap: var(--space-2);
}
.app-hint-slot:has(.rb-hint) {
  padding: var(--space-3) var(--space-3) 0;
}

/* Tooltip popover around .rb-tip */
.app-tipwrap {
  position: relative;
  display: inline-flex;
}
.app-tipwrap > .rb-tip {
  display: none;
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 40;
  width: max-content;
  max-width: 260px;
  white-space: normal;
  text-align: left;
  font-family: var(--font-sans);
  font-weight: 400;
  pointer-events: none;
}
.app-tipwrap--end > .rb-tip {
  left: auto;
  right: 0;
}
.app-tipwrap--end > .rb-tip::before {
  left: auto;
  right: 16px;
}
.app-tipwrap--up > .rb-tip {
  top: auto;
  bottom: calc(100% + 8px);
}
.app-tipwrap--up > .rb-tip::before {
  top: auto;
  bottom: -5px;
}
.app-tipwrap:hover > .rb-tip,
.app-tipwrap:focus-within > .rb-tip {
  display: block;
}
.app-tipwrap.is-hidden > .rb-tip {
  display: none;
}
.rb-statusbar__updated {
  margin-left: 0;
}
.rb-statusbar > .app-tipwrap:last-of-type {
  margin-left: auto;
}

/* Joint table */
.app-table-scroll {
  overflow-x: auto;
}
.rb-joints tbody tr:focus-visible {
  outline: 2px solid transparent;
  box-shadow: inset 0 0 0 2px var(--primary);
}
.rb-joints .app-row-dim td:not(:first-child) {
  color: var(--muted);
}

/* Charts */
.app-plot {
  width: 100%;
}
.app-plot .u-over {
  cursor: crosshair;
}

/* 3D viewer */
.rb-viewport > div:first-child:not(.rb-viewport__tl):not(.rb-viewport__tr) {
  position: absolute;
  inset: 0;
}
.app-viewport--compact {
  height: var(--camera-height);
  margin: 0;
  border: 0;
  border-radius: 0;
}
.app-viewport-msg {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  color: var(--muted);
  font-size: 13px;
  line-height: 18px;
  padding: var(--space-4);
  text-align: center;
}
.app-3d-label {
  display: inline-block;
  padding: 1px var(--space-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 14px;
  white-space: nowrap;
  pointer-events: none;
}
.app-3d-label--strong {
  color: var(--text);
  font-family: var(--font-sans);
  font-weight: 500;
}

/* Camera in the large slot */
.app-camera--large .rb-camera__img {
  height: var(--viewer-height);
}

/* Dev panel */
.app-dev {
  position: fixed;
  right: var(--space-3);
  bottom: var(--space-3);
  z-index: 50;
  display: grid;
  gap: var(--space-2);
  width: 260px;
  padding: var(--space-3);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-popover);
}

/* Tutorial anchors land below the sticky header + status bar, not under them. */
.rb-doc [id^='tut-'] {
  scroll-margin-top: calc(var(--size-header) + var(--space-8) * 2 + var(--space-3));
}

/* Narrow screens: header wraps, cameras stack, tutorial single column */
@media (max-width: 1023px) {
  .rb-doc {
    grid-template-columns: minmax(0, 1fr);
    padding: var(--space-4) var(--space-3);
    gap: var(--space-4);
  }
  .rb-doc__toc {
    position: static;
  }
}
@media (max-width: 640px) {
  .rb-header {
    height: auto;
    flex-wrap: wrap;
    padding: var(--space-2) var(--space-3);
    gap: var(--space-2);
  }
  .rb-header__project {
    order: 5;
    flex-basis: 100%;
    margin-left: 0;
    text-align: left;
  }
  .rb-header__name,
  .rb-header__sub {
    white-space: normal;
  }
  .rb-cams {
    grid-template-columns: minmax(0, 1fr);
  }
  .rb-compare {
    grid-template-columns: minmax(0, 1fr);
  }
  .rb-banner {
    grid-template-columns: auto 1fr;
  }
  .rb-banner__actions {
    grid-column: 1 / -1;
    flex-wrap: wrap;
  }
  .rb-col--left,
  .rb-col--right {
    flex-basis: 100%;
  }
  .rb-viewer__toolbar .rb-checks {
    gap: var(--space-2) var(--space-3);
  }
  .rb-card__head {
    flex-wrap: wrap;
  }
  .rb-viewport__tr {
    top: auto;
    bottom: var(--space-3);
    right: var(--space-3);
    left: var(--space-3);
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition: none !important;
    animation: none !important;
    scroll-behavior: auto !important;
  }
}
```


- Phần `.app-tipwrap`: định vị bong bóng tooltip và quy tắc **hiện khi `:hover` hoặc `:focus-within`**.
- Khối `@media (max-width: 1023px)` và `640px`: ở màn nhỏ các cột xếp chồng, header và banner co lại.
- `@media (prefers-reduced-motion: reduce)`: tôn trọng người dùng tắt chuyển động. (Project không dùng hiệu ứng chuyển động nào ngoài đổi màu tức thì, nên đây chỉ là lưới an toàn.)
- Các class `app-camera--large`, `app-dev`, `app-viewport*`, `app-3d-label` phục vụ các chương sau; có sẵn cho đủ.

### 5.9. Ráp lại thành trang

Tạo file `App`. Bản này mới có phần khung; các chương sau sẽ thay lại:

**Tạo file `src/app/App.tsx`**

```tsx file=src/app/App.tsx
import { useEffect } from 'react';
import { ErrorBanner } from '../components/ErrorBanner';
import { PipelineStrip } from '../components/PipelineStrip';
import { StatusBar } from '../components/StatusBar';
import { useStore } from '../state/store';
import { useDerived } from '../state/useDerived';
import { useT } from '../strings';
import type { Transport } from '../transport';
import { Header } from './Header';

const TICK_MS = 200;

interface AppProps {
  /** Tạo ở ngoài để test thay được bằng transport riêng. */
  createTransport: () => Transport;
}

export function App({ createTransport }: AppProps) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const derived = useDerived();

  // Nối robot khi trang xuất hiện, ngắt khi gỡ.
  useEffect(() => useStore.getState().attachTransport(createTransport()), [createTransport]);

  // Cập nhật "bây giờ" đều đặn để "Cập nhật x s trước" và phát hiện dữ liệu cũ chạy.
  useEffect(() => {
    const id = setInterval(() => useStore.getState().tick(), TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = t.appTitle;
  }, [lang, t.appTitle]);

  return (
    <div className="rb-app">
      <a className="app-skip" href="#main">
        {t.skipToMain}
      </a>
      <div className="rb-top">
        <Header derived={derived} />
        <StatusBar derived={derived} />
        <PipelineStrip stale={derived.stale} />
      </div>
      <ErrorBanner derived={derived} />
      <main id="main" tabIndex={-1} />
    </div>
  );
}
```


- `rb-top` là lớp của bộ thiết kế làm header + thanh trạng thái + pipeline **dính ở đầu** khi cuộn.
- `useEffect(() => store.attachTransport(...), [createTransport])`: hàm `attachTransport` trả về hàm dọn dẹp, và `useEffect` tự gọi nó khi component gỡ ra. Đây là cách React chuẩn để "đăng ký rồi huỷ".
- Đường liên kết "Bỏ qua tới nội dung chính" (`app-skip`) chỉ hiện khi focus: người dùng bàn phím nhảy qua header dài tới thẳng nội dung.

**Thay toàn bộ nội dung** `src/main.tsx`:

**Thay toàn bộ nội dung file `src/main.tsx`**

```tsx file=src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../design-system/tokens.css';
import '../design-system/components/bundle.css';
import './styles/app.css';
import { App } from './app/App';
import { createTransport } from './transport';
import { scenarioFromUrl } from './transport/scenarios';

const scenario = scenarioFromUrl(window.location.search);
const makeTransport = () => createTransport(scenario);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App createTransport={makeTransport} />
  </StrictMode>,
);
```


- `makeTransport` được định nghĩa **ở ngoài** component, nên có tham chiếu cố định và `useEffect` không chạy lại vô ích.

Xoá trang debug tạm: `rm src/Debug.tsx`.

## Chạy thử

```bash
npm run dev
```

- Mở `http://localhost:5173/`: thấy header tối với nút **STOP** đỏ, tab Monitoring/Tutorial, tên dự án, nút VI/EN; đèn **"Hệ thống ổn"** xanh; các chip trung tính; dải pipeline có số ms đang nhảy.
- Bấm **EN**: mọi chữ chuyển sang tiếng Anh. Tải lại trang: ngôn ngữ được nhớ.
- `?scenario=robot-error`: sau khoảng 3 giây đèn thành đỏ **"Cần xử lý"**, banner đỏ hiện "Robot báo lỗi: quá tải ở khớp elbow_flex", chip Robot đỏ, bước Robot trong pipeline có cảnh báo, các bước sau nó thành `—`.
- `?scenario=usb-lost`: banner "Mất kết nối USB" có nút "Kết nối lại USB". Bấm: đèn chuyển sang xanh dương "Chờ người dùng" (robot ở `stopped`, phải bấm "Sẵn sàng" trên header).
- `?scenario=stale`: banner vàng "Dữ liệu cũ", các chip viền đứt.
- `?scenario=estop`: đèn đỏ đậm "Dừng khẩn cấp".
- **Kiểm tra bàn phím**: bấm phím Tab vài lần: ô đầu tiên nhận focus là liên kết "Bỏ qua...", rồi tới **STOP**, rồi các tab, rồi nút ngôn ngữ. Với STOP đang focus, nhấn **Enter**: nút đổi sang "Đang dừng…".

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Commit: `git add -A && git commit -m "Chương 5: khung giao diện và chữ"`.

## Hiểu sâu

- **Vì sao dùng `aria-disabled` thay cho `disabled` ở nút "Sẵn sàng" và nút Gửi lệnh?** Nút `disabled` bị bỏ khỏi thứ tự Tab, nên người dùng bàn phím không biết nó tồn tại, cũng không nghe được vì sao nó bị khoá. `aria-disabled="true"` giữ nút trong thứ tự Tab, và ta viết lý do ngay dưới nút. Riêng STOP **không bao giờ** bị khoá.
- **Vì sao `deriveStatus` được gọi một lần ở `App` rồi truyền xuống bằng props?** Gọi một lần thì mọi component nhìn cùng một kết quả trong cùng một lần vẽ. Tránh chuyện đèn tổng và banner lệch nhau do tính ở hai thời điểm.
- **Vì sao chip bình thường để xám?** Màu chỉ nên báo "có chuyện". Nếu mọi thứ đều xanh thì mắt không còn phân biệt được cái gì cần chú ý.

## Bài tập

- Thêm vật thể thứ năm ở chương 2 (nếu bạn chưa xoá) rồi chạy `npm run typecheck`. Bạn thấy lỗi ở đâu? (Gợi ý: nó sẽ xuất hiện ở chương 6, khi hộp ra lệnh tra tên hiển thị.)
- Sửa câu "Hệ thống ổn" trong `vi.ts` thành câu khác và quan sát: bạn chỉ sửa một file mà cả trang và trang Tutorial (chương 9) đều đổi.
- Trong `Header.tsx`, thử đổi thứ tự để STOP không còn đứng đầu, rồi dùng phím Tab kiểm tra. Hiểu vì sao quy tắc "STOP đứng đầu" quan trọng, rồi trả lại như cũ.
- Mở công cụ lập trình (F12), tab Accessibility hoặc dùng trình đọc màn hình (NVDA trên Windows, VoiceOver trên macOS) nghe thanh trạng thái đọc gì khi bạn đổi kịch bản.

## Lỗi hay gặp

- **`Property 'xyz' does not exist on type ...` khi gõ `t.status.xyz`**: bạn gõ sai khoá chữ. Mở `vi.ts` kiểm tra tên.
- **Chữ hiện `{n}` nguyên văn**: quên truyền giá trị vào `fmt`.
- **Biểu tượng không hiện**: kiểm tra `lucide-react` đã cài (chương 1) và tên trong `ICONS` khớp.
- **Tooltip không hiện**: thiếu `app.css` hoặc quên `import './styles/app.css'` trong `main.tsx`.
- **STOP không ở góc trái trên**: kiểm tra `Header` render `<StopButton />` đầu tiên.
