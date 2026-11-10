# 测试与发布核验

测试分为代码回归、真实浏览器的离线页面测试、平台生命周期测试和发布包解压启动测试。测试环境不使用真实账号，不向学校提交预约。通过离线测试不代表学校当前网站必然可抢到场地，也不代表放号时网络耗时。

## 执行命令

安装 Node.js 22+ 和 Chrome 后：

```sh
npm ci
npm test
npm run package
node tools/smoke-package.mjs release/badminton-book-1.4.0-macos.zip
node tools/smoke-package.mjs release/badminton-book-1.4.0-windows.zip
node tools/smoke-package.mjs release/badminton-book-1.4.0-linux.zip
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

## 1.4.0 验证记录

本地 Mac 回归：68 项通过，0 失败、0 跳过。新增测试涵盖目录与详情字段冲突、新旧场馆双向切换、新官方 ID、旧页面仍显示零元、08:00 前提示与连续弹窗、网站请求签名更新、双入口提前预热且不赋予旧入口预约资格、排期及提交参数绑定、旧场馆订单去重，以及切换开始方式时保留预约日期。

2026-11-10 使用已有登录状态进行了只读页面检查：从篮球场旧入口 346 启动，目录仅列训练场 1；最终仅生成训练场 1–4 号候选。所有非 GET/HEAD 请求均被禁止，未提交、支付或取消任何订单。排期查询和只读检查成功不代表实际放号抢订成功。

Windows、Linux、macOS 的原生 CI 会在发布前对同一提交运行完整测试，并构建、解压和启动对应发布包。最终运行链接、测试数量及下载校验值以本版 Release 附件 `TEST-RESULTS.md` 和 `SHA256SUMS.txt` 为准。包内本页生成于 CI 之前。

Mac 1.4.0 包包含更新的脚本及界面，原生启动器二进制和签名文件逐项保持一致。Windows 11、其他 Linux 发行版及 ARM Windows/Linux 未单独实测；不以离线测试宣称固定抢订秒数。

旧版 1.3.0 的 57 项跨平台记录保留在 [旧 Release](https://github.com/z13185200025-debug/badminton-book/releases/tag/v1.3.0)，不作为本次代码的测试结果。
