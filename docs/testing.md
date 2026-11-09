# 测试与发布核验

测试分为代码回归、真实浏览器的离线页面测试、平台生命周期测试和发布包解压启动测试。测试环境不使用真实账号，不向学校提交预约。通过离线测试不代表学校当前网站必然可抢到场地，也不代表放号时网络耗时。

## 执行命令

安装 Node.js 22+ 和 Chrome 后：

```sh
npm ci
npm test
npm run package
node tools/smoke-package.mjs release/badminton-book-1.3.0-windows.zip
node tools/smoke-package.mjs release/badminton-book-1.3.0-linux.zip
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

## 1.3.0 实际验证结果

2026-11-09，代码提交 `7bf3261578a2e9cb9df989b7b151fa0f15fee99e` 的 [三系统 CI](https://github.com/z13185200025-debug/badminton-book/actions/runs/42561607608) 全部通过。

| 原生运行环境 | Node.js / 浏览器 | 回归测试 | 解压启动验证 |
| --- | --- | --- | --- |
| Windows Server 2025，GitHub Windows 运行器 | 22.23.4 / Chromium 151.0.7922.34 | 57 通过，0 失败，0 跳过 | Windows ZIP 与 `.cmd` 入口均通过，正常关闭后进程清理完成 |
| Ubuntu 24.04，GitHub Linux 运行器 | 22.23.4 / Chromium 151.0.7922.34 | 57 通过，0 失败，0 跳过 | Linux ZIP 与 `.sh` 入口均通过，使用 Xvfb 显示环境 |
| macOS 26.7.2 ARM64，GitHub Mac 运行器 | 22.23.4 / Chromium 151.0.7922.34 | 57 通过，0 失败，0 跳过 | 两种通用 ZIP 均可解压、打开界面并正常关闭 |
| 开发用 Mac，本地 Chrome | Node.js 26.3.0 | 57 通过，0 失败，0 跳过 | 中文/空格目录、真实窗口启动关闭通过 |

发布的 Windows / Linux ZIP 直接采用各自原生 CI 构建并验证过的文件。包内说明生成于测试前，最终测试结果以本页及 Release 记录为准。此后的文档提交只补充测试结果，运行代码保持上述测试版本。

Mac 下载保留原始 `1.2.0-rc.1` ZIP：SHA-256 与修改前一致，包内 183 个文件逐项校验通过；当前 Mac 安装目录的 45 个发布源码/启动器文件校验值也保持一致。原版应用未重编译或重新签名。

这些检查覆盖离线页面、模拟接口、真实浏览器进程与平台启动器；本次测试未使用学校账号，未创建或支付真实订单。Windows 11、其他 Linux 发行版及 ARM Windows/Linux 未单独实测；学校实时排期与网络表现需以实际使用为准。
