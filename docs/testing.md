# 测试与发布核验

测试分为代码回归、真实浏览器的离线页面测试、平台生命周期测试和发布包解压启动测试。测试环境不使用真实账号，不向学校提交预约。通过离线测试不代表学校当前网站必然可抢到场地，也不代表放号时网络耗时。

## 执行命令

安装 Node.js 22+ 和 Chrome 后：

```sh
npm ci
npm test
npm run package
node tools/smoke-package.mjs release/badminton-book-1.4.1-macos.zip
node tools/smoke-package.mjs release/badminton-book-1.4.1-windows.zip
node tools/smoke-package.mjs release/badminton-book-1.4.1-linux.zip
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

## 1.4.1 验证记录

本地 Mac 完整回归：74 项通过、0 失败、0 跳过。

本次增加：目录总数小于最大场号、初始入口 404 后只读恢复目录、固定入口禁止自动切馆、弹窗互相遮挡、普通须知提及开放时间、管理占用备注脱敏。保留原有身份/日期/零元金额/实际提交 ID 与重复订单保护测试。

2026-11-11 使用已有会话检查学校当前目录、须知和 11 月 12 日排期。只允许 GET/HEAD，未选场、提交、支付或取消订单。目录只有入口 346、总数为 5，排期返回 9 行；晚间检查的场次均不可预约。页面主程序与前一天相同，后台配置有变化。

最终本地及三系统测试、发布包清单与 SHA-256 以 [Release 测试记录](https://github.com/z13185200025-debug/badminton-book/releases/download/v1.4.1/TEST-RESULTS.md) 和 [校验值](https://github.com/z13185200025-debug/badminton-book/releases/download/v1.4.1/SHA256SUMS.txt) 为准。包内说明生成于 CI 前。

依赖检查未报告已知漏洞；这不等于没有潜在缺陷。Playwright 存在较新版本，本修复保留已测试的 1.62.1，避免同时引入浏览器驱动行为变化。

Mac 原生启动器不重编译、不重签名。Windows 11、其他 Linux 发行版及 ARM Windows/Linux 需分别验证；离线测试不证明学校放号时的抢订结果或固定耗时。

旧版 1.4.0 的 68 项跨平台记录保留在 [旧 Release](https://github.com/z13185200025-debug/badminton-book/releases/tag/v1.4.0)，不作为本次代码的测试结果。
