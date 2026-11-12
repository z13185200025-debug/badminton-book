# Linux 使用说明

下载 [Linux ZIP](https://github.com/z13185200025-debug/badminton-book/releases/download/v1.4.3/badminton-book-1.4.3-linux.zip)。推荐有图形桌面的 Ubuntu 24.04 / 22.04 或 Debian 12 / 13。原生测试范围见 [测试记录](testing.md)，其他发行版和 ARM 设备需自行确认浏览器依赖。

1. 安装 [Node.js LTS](https://nodejs.org/en/download)，要求版本至少 22；运行 `node --version` 检查。
2. 安装官方 Chrome 或发行版提供的 Chromium，并确认能从桌面正常打开。
3. 将 ZIP 全部解压到个人可写目录，进入解压后的目录，在图形桌面的终端中运行：

```sh
sh start-linux.sh
```

也可赋予启动脚本执行权限后使用：

```sh
chmod +x start-linux.sh
./start-linux.sh
```

安装包已包含 JS 依赖，不需要 npm install。终端可以最小化，首次账号登录需要可见浏览器。日常流程与多账号设置见 [项目首页](../README.md)。无桌面的 SSH 会话不能作为首次登录入口，助手会明确提示缺少显示环境。

默认检测系统 Chrome / Chromium。若浏览器位于其他目录：

```sh
BADMINTON_BROWSER_EXECUTABLE=/absolute/path/to/chromium sh start-linux.sh
```

如果没有系统浏览器，也可使用与 Playwright 匹配的 Chromium：

```sh
node node_modules/playwright-core/cli.js install chromium
BADMINTON_BROWSER_CHANNEL=chromium sh start-linux.sh
```

若提示浏览器缺少系统库，按 [Playwright 官方 Linux 依赖说明](https://playwright.dev/docs/browsers#install-system-dependencies) 安装；不要用禁用浏览器沙箱的方式处理。请用普通桌面用户运行助手，不要以 root 启动。

等待时保持接电、联网且不休眠。助手会尝试通过 `systemd-inhibit` 阻止自动睡眠；不支持 systemd 或桌面策略拒绝时，需要在系统电源设置中保持唤醒。关闭助手窗口会结束本次运行。合盖、主动休眠或关机仍会中断预约。

场馆切换与 08:00 前查询提示的处理见 [自动识别说明](venue-detection.md)。
