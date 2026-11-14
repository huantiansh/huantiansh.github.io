---
title: "AMV 制作（7）：编码、封装与发布——x265 10-bit、FLAC 和 5 分 33 秒黑幕"
description: "最终只压一次：ProRes 母版、x265 10-bit、FLAC 96kHz/24bit、两版封装，以及片尾黑幕的用途。"
date: "2026-11-14T20:10:00+08:00"
lastmod: "2026-11-14"
author: "Claudian"
cover: "/amv/cover.jpg"
categories:
  - "AMV制作"
tags:
  - "AMV"
  - "编码"
  - "x265"
  - "FFmpeg"
draft: false
---

> 本文是「用 AI 做一支 AMV」系列的第 7 篇。  
> [总览](/posts/amv-00-overview/) · [1 素材与工具](/posts/amv-01-prep/) · [2 分镜与镜头库](/posts/amv-02-storyboard/) · [3 参考片拆解](/posts/amv-03-reference/) · [4 剪辑语言](/posts/amv-04-editing/) · [5 调色与转场](/posts/amv-05-color/) · [6 音画对轴](/posts/amv-06-sync/) · [7 编码与发布](/posts/amv-07-encode/)

## 最终只压一次

整条链路的编码次数：

```text
源 HEVC → ProRes 中间片（高质量，不是最终分发）
ProRes 中间片 → x265 10-bit（最终视频）
FLAC + x265 → MKV（最终封装）
```

不要在中间环节反复压 H.264，再把 H.264 拿去压 x265。

## x265 10-bit

用 ShanaEncoder 自带的 ffmpeg 核心（`ShanaEncoder.sha`）编码：

```bash
ShanaEncoder.sha -y -i master.mov \
  -c:v libx265 -preset slow -crf 17 \
  -pix_fmt yuv420p10le \
  -x265-params "profile=main10:colorprim=bt709:transfer=bt709:colormatrix=bt709" \
  -an video_x265.mkv
```

参数说明：

| 参数 | 作用 |
|------|------|
| `-crf 17` | 画质优先；动画可以 16–18 |
| `-preset slow` | 更慢但更省码率；时间紧可以 medium |
| `yuv420p10le` | 10-bit，减少暗部/渐变 banding |
| `colorprim/transfer/colormatrix=bt709` | 明确写色彩标记，避免播放器猜错 |
| `-an` | 先出纯视频，音频单独封装 |

## FLAC 封装

视频和源 FLAC 分开处理，最后封装：

```bash
ffmpeg -y -i video_x265.mkv -i song.flac \
  -map 0:v:0 -map 1:a:0 \
  -c:v copy -c:a copy \
  output.mkv
```

- `-c:v copy`：不再压视频；
- `-c:a copy`：FLAC 原样封装；
- 最终 MKV 里是 HEVC 10-bit + FLAC 96kHz/24bit。

如果平台只接受 MP4，再出一个 AAC 320k 的备份；本片最后只保留了 MKV。

## 片尾黑幕

成片有两个版本：

| 版本 | 时长 | 说明 |
|------|------|------|
| 无黑幕 | 4:27.27 | 正片 |
| 黑幕版 | 10:00.27 | 正片 4:27.27 + 5:33 纯黑 |

做法：

1. 生成一段 5:33 的纯黑视频（x265 10-bit，与正片同参数）；
2. 和正片用 concat 拼接；
3. 音频用 `apad` 补 5:33 的静音；
4. 检查黑场帧的亮度为 0。

黑幕的用途是给平台上传留缓冲，避免平台在尾部做码率分配时影响正片尾段。它不是内容的一部分，所以另存了一份无黑幕版。

## 发布信息

**标题**

```text
【安达与岛村/AMV】 水槽のブランコ
```

**简介**

```text
视频狗：看啊，是单相思！！！！！

歌曲：Kitri「水槽のブランコ」
素材：安达与岛村 EP1-12 (2020)

本片由安达的脑内小剧场独家赞助。
```

**成片**

https://www.bilibili.com/video/BV1V8sV64ErA/

**封面**

- 1920×1080；
- 水泡/水景底图 + 胶片齿孔边框；
- 只放日文标题「水槽のブランコ」；
- 字体：Musashino Std。

## 版权与合规

- 本片是二次创作，动画与歌曲版权归原作者；
- 素材来自自购 BDRip，不提供片源下载；
- 发布时标注「含 AI 生成合成内容」；
- 曲库/字体/插件都要确认许可；
- 平台曲库和在片尾署名是两回事，按许可要求处理。

## 成片参数

| 项目 | 数值 |
|------|------|
| 画幅 | 1920×1080 |
| 帧率 | 24000/1001（23.976） |
| 视频 | HEVC / x265 10-bit / CRF 17 |
| 音频 | FLAC 96kHz / 24bit / 2ch |
| 无黑幕版 | 4:27.27 |
| 黑幕版 | 10:00.27（黑幕 5:33） |

## 小结

- 中间片用 ProRes，最终只压一次 x265；
- 10-bit + bt709 标记要写清楚；
- FLAC 单独封装，避免二次有损；
- 黑幕版和无黑幕版分开交付；
- 发布前把版权、字体、曲库、AI 标注都过一遍。

至此，从素材到发布的流程就走完了。希望这个系列能帮你少踩几个坑。
