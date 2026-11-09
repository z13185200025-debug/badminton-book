# Mac 使用说明（保留原版）

[下载 Mac 1.2.0-rc.1 原版 ZIP](https://github.com/z13185200025-debug/badminton-book/releases/download/v1.3.0/buaa-badminton-1.2.0-rc.1-macos.zip)

本次发布保留原来的 Mac 安装包，未重编译、重签名或改写任何字节。现有 Mac 用户可继续使用原来的目录和应用，无需覆盖升级。Mac ZIP 的 SHA-256：

```text
5dc2e3c68d2bb0f610fb2db6d19ead494fb348e8c70661f7616d58916c783ff8
```

新电脑需要 macOS 13 或更新版本、[Node.js 22+](https://nodejs.org/en/download) 和 [Google Chrome](https://www.google.com/chrome/)。原版 native launcher 同时包含 Apple Silicon 与 Intel 架构，Node.js 与 Chrome 需匹配本机。

1. 解压完整 ZIP 到自己可写的目录，保留 `.app` 旁边的所有文件。不能只把 `.app` 单独移到“应用程序”。
2. 双击 `羽毛球预约助手.app`，也可使用 `打开预约助手.command`。
3. 若 macOS 询问该应用是否访问所在文件夹，由本人确认权限。应用未使用 Apple Developer ID 公证；系统阻止时，请先核对来源和 SHA-256，再按 macOS 提供的正常“打开”流程处理，不要全局关闭系统安全保护。
4. 在“账号与登录”填写学校网页显示的姓名，在独立 Chrome 窗口中完成首次登录，可自行使用 Mac 密码本。然后核对日期、时段和 Pay 设置，点击开始。

后续操作、多个账号设置和技术日志均保留原有行为，详细说明也在 Mac ZIP 内的 `使用说明.html` 和 `使用说明.txt`。不设置每日任务；每次使用由本人开启。保持 Mac 开盖接电、联网且应用打开。可以熄屏，合盖休眠无法保证准时执行。

发布目录中的 Windows / Linux 文件无需复制到现有 Mac 安装目录，Mac 用户也无需运行 `npm run app:build`。
