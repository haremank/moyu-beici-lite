# 摸鱼背词 Lite（MoyuBeiCi Lite）

> 看起来在摸鱼，其实你在变强。

一款 **离线、开源** 的 Windows 桌面背单词应用：主窗口是完整的单词学习界面，
屏幕边缘悬浮一块**平时近乎隐形**的半透明小卡片，循环展示你正在学的词——
左键翻释义、右键切词、`Alt+2` 认识 / `Alt+1` 不认识，`Alt+Q` 一键隐身。

基于开源项目 [qwerty-learner](https://github.com/Kaiyiwing/qwerty-learner)（GPL-3.0）
构建的 Electron 桌面壳，在GPL-3.0 下开源。

## 功能

- **学习主窗口**：qwerty-learner 完整功能（打字练习、词库 380+、章节、统计），词库数据内置，纯离线
- **摸鱼悬浮窗**：无边框透明置顶卡片
  - 平时背景 15% + 文字全隐（几乎隐形），鼠标移上去才显示内容
  - 透明度/字体/字号/字重/颜色全部可在卡片上的 ⚙ 面板调整
  - 认识（✓）/ 不认识（✗）按钮 + 全局热键，标记后显示释义并停留在当前词，按词库+章节记录进度
  - 迷你模式、鼠标穿透、鼠标移出自动隐藏、老板键一键隐身
- **跟随主窗口**：悬浮窗自动同步主界面当前词库和章节（2 秒内）
- **自定义词书**：托盘导入 txt / csv / json，主窗口和悬浮窗都能用
- **词窗开关**：主界面右下角一键开/关悬浮窗

## 下载安装

前往 [Releases](../../releases) 下载 `MoyuBeiCi-Lite-*-win64-setup.exe`（约 100MB）：

- 按用户安装（无需管理员权限），默认装到 `%LOCALAPPDATA%\Programs\摸鱼背词Lite`
- 安装包未做代码签名，SmartScreen 提示时选择 **更多信息 → 仍要运行**
- 系统要求：Windows 10/11 x64

## 快捷键

| 热键 | 功能 |
|---|---|
| `Alt + Q` | 一键隐身（隐藏全部窗口）/ 恢复（只弹回词窗） |
| `Alt + X` | 退出程序 |
| `Alt + ↑` / `Alt + ↓` | 悬停透明度 ±10% |
| `Alt + M` | 迷你模式 |
| `Alt + C` | 鼠标穿透 |
| `Alt + 2` / `Alt + 1` | 认识 / 不认识 |

## 从源码构建

```bash
# 1. 构建前端（qwerty-learner）
cd qwerty-learner
npm install
npm run build          # 产物在 qwerty-learner/build

# 2. 打包安装包（win64 NSIS）
cd ../moyu-lite
npm install
npm run dist           # 产物在 moyu-lite/release/*.exe
```

开发模式：`moyu-lite` 与 `qwerty-learner` 为同级目录时，直接 `npm start`；
否则设置环境变量 `MOYU_WEB_ROOT` 指向前端构建产物目录。

## 目录结构

```
moyu-lite/        Electron 壳（悬浮窗、老板键、托盘、词书导入、设置面板）
qwerty-learner/   学习界面源码（含本项目补丁：自定义词书运行时注册）
```

## 致谢与许可

- [qwerty-learner](https://github.com/Kaiyiwing/qwerty-learner)（GPL-3.0）—— 学习界面与词库框架
- 词库数据来源于 [kajweb/dict](https://github.com/kajweb/dict) 及社区贡献
- 单词发音使用有道词典开放 API（联网功能，可不用）

本项目基于 GPL-3.0 授权，详见 [LICENSE](LICENSE)。
