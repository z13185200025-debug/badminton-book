# 测试与发布核验

测试分为代码回归、真实浏览器的离线页面测试、平台生命周期测试和发布包解压启动测试。测试环境不使用真实账号，不向学校提交预约。通过离线测试不代表学校当前网站必然可抢到场地，也不代表放号时网络耗时。

## 执行命令

安装 Node.js 22+ 和 Chrome 后：

```sh
npm ci
npm test
npm run package
node tools/smoke-package.mjs release/badminton-book-1.4.2-macos.zip
node tools/smoke-package.mjs release/badminton-book-1.4.2-windows.zip
node tools/smoke-package.mjs release/badminton-book-1.4.2-linux.zip
```

测试默认使用本机 Chrome / Chromium，Windows 无 Chrome 时使用 Edge。CI 使用与 Playwright 匹配的 Chromium：

```sh
node node_modules/playwright-core/cli.js install chromium
```

将 `BADMINTON_BROWSER_CHANNEL` 设置为 `chromium` 后运行测试。Linux CI 需安装系统依赖，显示窗口测试使用 Xvfb。`BADMINTON_TEST_HEADED=1` 启用真实窗口启动/关闭测试；其他浏览器功能测试使用 headless 模式。

## 覆盖范围

- 后天日期、上海时区、08:00 放号和可配置的 2 秒延迟。
- 多个时段、九片场地、候选切换、旧订单恢复与重复提交保护。
- 零元支付校验、账号/日期/场地核对、异步 Pay 页面和不明确的提交结果。
- 多账号登录资料隔离、并发启动、一个失败不影响另一个、单独与整体停止。
- Windows / Linux 浏览器检测、中文及空格目录、IPC 停止、关闭窗口清理。
- ZIP 清单与每个文件 SHA-256、私有数据排除、解压后初始空账号和手动启动状态。

## 1.4.2 验证范围

本次新增：验证码内容比较、乱序响应绑定、延迟解析、刷新前校验证据保留、首次无额外等待、恢复等待、提交内容不变、错误内容在发送前拦截、滑块成功与订单拒绝分别显示。浏览器测试全部使用隔离模拟服务；不创建真实学校订单。

本地及三系统最终结果、对应提交与发布包哈希见 [Release 测试记录](https://github.com/z13185200025-debug/badminton-book/releases/download/v1.4.2/TEST-RESULTS.md) 和 [校验值](https://github.com/z13185200025-debug/badminton-book/releases/download/v1.4.2/SHA256SUMS.txt)。包内说明生成于 CI 前，不将待运行项目表述为通过。

新增等待属于有限恢复策略；学校二次校验拒绝的根因尚未确认，离线通过不能证明服务器接受真实订单，也不保证固定抢订耗时。详见 [验证码诊断](captcha-diagnostics.md)。

Mac 原生启动器不重编译、不重签名。Windows 11、其他 Linux 发行版及 ARM Windows/Linux 需分别验证。

旧版结果：[1.4.1 的 74 项跨平台记录](https://github.com/z13185200025-debug/badminton-book/releases/tag/v1.4.1)，不作为本次代码的测试结果。
