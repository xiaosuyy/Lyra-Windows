# Lyra Windows

Lyra 音乐播放器的 Windows 桌面版，使用 Electron + Vue 3 + TypeScript 构建。

## 功能

- 在线音乐浏览、搜索与播放
- 歌单、收藏与最近播放管理
- 本地歌曲扫描与播放
- 歌词显示与桌面歌词
- 歌曲下载与离线缓存
- 云同步（可自建服务端）
- 在线更新（支持切换访问源）
- 多种全屏播放样式与毛玻璃界面

## 开发

```bash
corepack pnpm install
corepack pnpm dev
```

## 构建

```bash
corepack pnpm build
corepack pnpm build:win
```

## 发布

Windows 安装包发布在本仓库的 Releases 页面，桌面端会读取该仓库的最新发布进行在线更新。

## 许可

AGPL-3.0
