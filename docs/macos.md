# Mac 使用说明

[下载 Mac 1.4.2 ZIP](https://github.com/z13185200025-debug/badminton-book/releases/download/v1.4.2/badminton-book-1.4.2-macos.zip)

本版更新场馆自动识别、脚本、界面与说明。原生 `.app` 启动器保持原有字节和签名，未重新编译或重新签名。

新电脑需要 macOS 13+、[Node.js 22+](https://nodejs.org/en/download) 和 [Google Chrome](https://www.google.com/chrome/)。原生启动器同时包含 Apple Silicon 与 Intel 架构，Node.js 与 Chrome 需匹配本机。

1. 解压完整 ZIP 到自己可写的目录，保留 `.app` 旁边的所有文件，不能只移动 `.app`。
2. 双击 `羽毛球预约助手.app`，或 `打开预约助手.command`。
3. 如系统询问访问文件夹，由本人确认权限。应用未使用 Apple Developer ID 公证；系统阻止时先核对来源和 Release 中的 SHA-256，按 macOS 提供的正常“打开”流程处理。
4. 在“账号与登录”填写学校网页显示的姓名，在独立 Chrome 窗口中完成首次登录，可自行使用 Mac 密码本。
5. 设置每个账号的时段与候选场地，核对预约日期。选择现在开始或本次等到 08:00，再点击开始。自动零元 Pay 是每个账号独立的可选项。

不会创建每日任务；打开助手默认空闲，点击开始才执行这一次。保持 Mac 开盖接电、联网且应用运行。可以熄屏，合盖休眠无法保证准时执行。

现有用户升级：先关闭助手并备份整个旧目录，将新包解压到新目录。可在同一台 Mac 上复制旧目录的 `config.json` 和整个 `.state/` 到新目录以保留账号与本机登录资料；不要同时打开新旧两份，也不要把这些私有文件分享给别人。本版未配置 `venueMode` 的旧配置也默认使用自动识别，旧 `venueId=346` 只是初始入口。换电脑请重新登录。

无需运行 `npm run app:build`。本次针对原安装目录的更新只替换脚本、界面、依赖与文档，保留原生应用、账号资料及用户选择。
