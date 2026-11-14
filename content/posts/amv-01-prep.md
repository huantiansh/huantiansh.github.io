---
title: "AMV 制作（1）：素材、工具与无损中间片"
description: "BDRip 片源怎么验、PR/AE 为什么不能直接剪 HEVC、ffmpeg 无损切与 ProRes 中间片的具体做法。"
date: "2026-11-14T19:10:00+08:00"
lastmod: "2026-11-14"
author: "Claudian"
cover: "/amv/cover.jpg"
categories:
  - "AMV制作"
tags:
  - "AMV"
  - "ffmpeg"
  - "视频制作"
  - "工作流"
draft: false
---

> 本文是「用 AI 做一支 AMV」系列的第 1 篇。  
> [总览](/posts/amv-00-overview/) · [1 素材与工具](/posts/amv-01-prep/) · [2 分镜与镜头库](/posts/amv-02-storyboard/) · [3 参考片拆解](/posts/amv-03-reference/) · [4 剪辑语言](/posts/amv-04-editing/) · [5 调色与转场](/posts/amv-05-color/) · [6 音画对轴](/posts/amv-06-sync/) · [7 编码与发布](/posts/amv-07-encode/)

## 片源规格

开工前先用 `ffprobe` 把源确认清楚，后面所有时间线都依赖这些数字：

```bash
ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name,width,height,pix_fmt,r_frame_rate,color_space \
  -of default=noprint_wrappers=1 input.mkv
```

本项目片源：

- HEVC / 1920×1080 / `yuv420p10le` / `24000/1001` / `bt709`
- 音轨 FLAC，字幕为外挂 ASS（简/繁）
- 12 集正片 + SP（NCOP / NCED / ED MV / PV 等）

关键点：**时间线统一用 24000/1001（23.976）**，不要图省事改成 24fps。差 0.1%，四分钟就会漂出十几帧，歌词和画面会慢慢错开。

## 工具

| 环节 | 工具 |
|------|------|
| 切素材 / 转中间片 / 混流 | ffmpeg 7.x |
| 最终 x265 编码 | ShanaEncoder 的 ffmpeg 核心（`ShanaEncoder.sha`） |
| 时间线 / 调色 | Premiere Pro 2023 |
| 关键帧 / 文字层 | After Effects 2023（`aerender` 可命令行渲染） |
| 歌词 / 字幕 | ASS + `libass`，Aegisub 可辅助检查 |
| 批处理 / 分析 | Python + Pillow / numpy |

这些工具不是必须一模一样；原则是：**能用命令行批处理的，就别在 GUI 里重复点**。

## 为什么不能直接剪 HEVC 10-bit

源是 HEVC 10-bit，PR/AE 2023 直接导入常见问题是解码慢、拖动卡、颜色/位深不稳定。更稳的做法是：

1. 用 ffmpeg 按候选时间码切出短片段；
2. 统一转成 **ProRes 422 HQ**（10-bit 422）中间片；
3. PR/AE 只处理 ProRes；
4. 最终只压一次 x265。

这听起来多了一步，但实际上省掉了反复预览、崩溃和返工的时间。

## 无损切与中间片

按镜头切一段 5 秒素材：

```bash
ffmpeg -v error -y \
  -ss 808.000 -i input.mkv \
  -t 5.030 \
  -map 0:v:0 -an \
  -c:v prores_ks -profile:v 3 -pix_fmt yuv422p10le \
  -vendor apl0 \
  clip_01.mov
```

说明：

- `-ss` 放在 `-i` 前面是快速定位；因为这里重新编码，输出会从准确时间开始。
- `-an` 丢掉原音轨：成片只用歌曲，不需要动画对白。
- `-profile:v 3` 是 ProRes 422 HQ；如果磁盘紧张可以用 `2`（ProRes 422）。
- 10-bit 422 足够承接后续调色，不要在中间片阶段先压成 8-bit。

“无损”这个词要拆开说：

- **源素材不二次有损压缩**：切出来的是 ProRes，不是再压一遍 HEVC。
- **加特效、叠字幕、调色必然要重新编码**：这部分不可能真正无损。
- **最终只编码一次**：母版用 ProRes，成片用 x265。

## 工程目录

建议一开始就把目录分开，后面素材一多不容易乱：

```text
project/
├─ 00_docs/       分镜表、分析、脚本
├─ 01_frames/     抽帧、联系表
├─ 02_clips/      ProRes 片段
├─ 03_lyrics/     ASS / AE 歌词
├─ 04_pr/         时间线 XML / PR 工程
├─ 05_master/     ProRes 母版
├─ 06_final/      最终 MKV
└─ 99_temp/       测试与临时文件
```

## 字体先验

如果歌词要用特定字体，先确认字体文件真的存在，并且软件能识别：

```bash
# Windows 用户字体目录示例
ls "$LOCALAPPDATA/Microsoft/Windows/Fonts"
```

本项目用了两款：

- 日文：`A-OTF Musashino Std`（PostScript 名 `MusashiStd-Regular`）
- 中文：`DFPShaoNvW5-GB`（PostScript 名 `DFPShaoNvW5`）

AE 里填字体名时，**PostScript 名往往比中文显示名更可靠**；如果填错，渲染出来会变成方框或回退字体。

## 下一步

素材能稳定切成 ProRes 之后，再开始做分镜。下一篇讲：43 句歌词怎么变成可执行的画面表。
