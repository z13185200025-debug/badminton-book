# Windows 使用说明

下载 [Windows ZIP](https://github.com/z13185200025-debug/badminton-book/releases/download/v1.4.3/badminton-book-1.4.3-windows.zip)。建议 Windows 11；本项目的自动化测试使用 GitHub Windows 运行器，具体结果见 [测试记录](testing.md)。

1. 从 [Node.js 官网](https://nodejs.org/en/download) 安装 LTS（版本至少 22），保留安装器的 PATH 设置。安装后重新打开终端。
2. 安装或更新 [Google Chrome](https://www.google.com/chrome/)；也可使用系统已安装的 Microsoft Edge。默认先找 Chrome，再找 Edge。
3. **将 ZIP 全部解压** 到个人可写目录，例如 `C:\Users\你的用户名\Apps\badminton-book`。不要直接在压缩包中运行，也不建议放到 OneDrive 同步目录、网络盘或 `Program Files`。
4. 双击 `start-windows.cmd`。命令窗口可以最小化，助手窗口用于日常操作。无需管理员身份，也不需要修改 PowerShell 执行策略。
5. 在助手内设置账号并完成学校登录，按 [共同使用流程](../README.md#日常使用) 开始一次预约。关闭助手窗口后，本次后台进程随之停止；不要强制结束进程来替代正常关闭。

安装包已包含 JS 依赖，不需要先运行 npm install。若是 Git 下载的源码，先在项目目录执行 `npm ci`，再运行 `npm start`。

等待时保持电脑接电联网，在 Windows 电源设置中避免进入睡眠。助手会尝试申请运行期间的系统唤醒，但不能防止用户主动休眠、合盖策略或断电。界面停止仅停止本次脚本，不会取消学校网站上的已有订单。

Windows 的 Chrome 和 Edge 登录资料相互独立。更换浏览器后应重新登录所有账号。需要固定 Edge 时，在命令提示符中运行：

```bat
set "BADMINTON_BROWSER_CHANNEL=msedge"
start-windows.cmd
```

需要指定自定义安装路径：

```bat
set "BADMINTON_BROWSER_EXECUTABLE=C:\Program Files\Google\Chrome\Application\chrome.exe"
start-windows.cmd
```

常见启动错误见 [排错说明](troubleshooting.md)。

场馆切换与 08:00 前查询提示的处理见 [自动识别说明](venue-detection.md)。
