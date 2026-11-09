# badminton book

本机运行的北航羽毛球预约助手。手动开启一次预约，支持最多 8 个账号分别配置时段和候选场地；每个账号独立登录、独立执行。

## 下载与启动

| 系统 | 下载 | 启动方式 | 使用说明 |
| --- | --- | --- | --- |
| macOS | [Mac 原版 1.2.0-rc.1](https://github.com/z13185200025-debug/badminton-book/releases/download/v1.3.0/buaa-badminton-1.2.0-rc.1-macos.zip) | 解压后双击 `羽毛球预约助手.app` | [Mac 说明](docs/macos.md) |
| Windows | [Windows 1.3.0](https://github.com/z13185200025-debug/badminton-book/releases/download/v1.3.0/badminton-book-1.3.0-windows.zip) | 解压后双击 `start-windows.cmd` | [Windows 说明](docs/windows.md) |
| Linux | [Linux 1.3.0](https://github.com/z13185200025-debug/badminton-book/releases/download/v1.3.0/badminton-book-1.3.0-linux.zip) | 图形桌面中运行 `sh start-linux.sh` | [Linux 说明](docs/linux.md) |

[全部发布文件及 SHA-256](https://github.com/z13185200025-debug/badminton-book/releases/tag/v1.3.0) · [测试记录](docs/testing.md) · [常见问题](docs/troubleshooting.md)

**Mac 下载保持原版 ZIP，未重新编译、签名或修改。** Windows / Linux 版本增加专用启动器、浏览器检测和跨平台停止处理。安装包已带 npm 依赖，仍需先安装 **Node.js 22+（推荐官网 LTS）** 和浏览器。Windows 支持 Chrome 或 Edge；Linux 支持 Chrome / Chromium。无需安装 Codex、ChatGPT 或配置 OpenAI API。

## 日常使用

1. 打开助手，在“账号与登录”填写学校网页显示的姓名，确认本人拥有账号及自动化使用权限，点击“打开此账号登录”。首次在学校页面完成登录，助手不收集密码。
2. 核对日期、首选时段、候选场号和备选时段。默认是打开当天的后天 **19:00–20:00**。等待第二天 08:00 时，日期会调整为放号日的后天，以界面日期为准。
3. 已开放的场次选“现在开始”；等待放号选“本次等到 08:00”。等待模式提前 5 分钟预热，默认 **08:00:02** 开始选场，延迟可自行调整。
4. 默认只到 Pay 页面。需要完成预订时，对相应账号勾选“自动完成零元预约”。只有账号、日期、场地、时段和 **¥0** 全部校验通过才会点击 Pay。
5. 点击“开始本次预约 / 等待”。结束后不会第二天自动重启。关闭助手窗口会停止未完成的执行；已经提交的订单须到学校网站核对或取消。

等放号时保持应用打开、电脑接电联网且不休眠。可熄屏，但合盖、关机、断网或强制结束程序会影响运行。界面会记录各账号的预热、候选选择、验证码、接口耗时、Pay 就绪和最终订单状态。网络延迟与学校处理时间会影响结果，不保证抢订成功或固定完成秒数。

## 多账号

点“＋ 添加账号”，为每个账号独立登录，然后点击该账号的“配置”设置时段。例如账号 A 选 19:00–20:00，账号 B 选 20:00–21:00。勾选参与本次预约的账号后一起开始；一个失败不会停止其他账号，也可以单独停止。新增账号默认不自动 Pay。

日期与开始方式为本次计划共用。每个账号的时段、候选场地、延迟、是否显示学校页面和自动 Pay 设置独立。“保存已选计划”只保存设置，不会开始预约。默认场馆为羽毛球馆（篮球馆一层，入口 346），按 1 → 2 → … → 9 号尝试。

## 数据与分享

登录资料保存在本地 `.state/`，运行记录在 `artifacts/`，个人配置在 `config.json`；它们不进入 Git 或发布包。Chrome/Edge 的登录资料可能绑定操作系统和本机密钥，换电脑后请重新登录，不要直接复制浏览器资料。分享下载链接或原始 ZIP，收件人自行登录自己的账号。

代码只服务于获得允许的本校零元场地预约。校方页面、排期、场馆和验证码发生变化时可能需要更新。无法确认下单结果时会停止并提示核对，不会盲目重复提交。

## 从源码运行与验证

```sh
npm ci
npm start
npm test
npm run package
```

`npm start` 启动新的通用界面；保留的 Mac 原版请使用上方 Mac ZIP。`npm run package` 只生成 Windows / Linux 包，不重建 Mac 原版。测试使用本地页面和模拟接口，不会登录学校或预约真实场地。开发与浏览器设置见 [测试说明](docs/testing.md)。
