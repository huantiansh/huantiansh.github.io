---
title: "AMV 制作（5）：调色与转场——胶片暗调、双曝和 3:38 的逐渐上色"
description: "用 ffmpeg 做胶片放映感：暗调低饱和、上下黑边、颗粒、闪烁、双重曝光，以及 1.5 秒逐渐上色的参数。"
date: "2026-11-14T19:50:00+08:00"
lastmod: "2026-11-14"
author: "Claudian"
cover: "/amv/cover.jpg"
categories:
  - "AMV制作"
tags:
  - "AMV"
  - "调色"
  - "ffmpeg"
  - "转场"
draft: false
---

> 本文是「用 AI 做一支 AMV」系列的第 5 篇。  
> [总览](/posts/amv-00-overview/) · [1 素材与工具](/posts/amv-01-prep/) · [2 分镜与镜头库](/posts/amv-02-storyboard/) · [3 参考片拆解](/posts/amv-03-reference/) · [4 剪辑语言](/posts/amv-04-editing/) · [5 调色与转场](/posts/amv-05-color/) · [6 音画对轴](/posts/amv-06-sync/) · [7 编码与发布](/posts/amv-07-encode/)

## 色调分界点

本片的结构是：

- **2:37–3:38**：沉入水中、迷茫，暗调、低饱和、接近黑白；
- **3:38–4:06**：颜色回来，暖色、鲜艳。

参考片的量化结果是前半饱和度约 13，3:38 后升到 24。我们做得更极端：前半压到 6–10，3:38 后逐渐拉到 60 左右。

关键不是数值，而是**两段之间要有明确的色彩落差**。

## 胶片放映感

前半段用一组滤镜叠出「老胶片」的感觉：

```bash
ffmpeg -i input.mov -vf "
  eq=saturation=0.10:
     brightness='-0.08+0.015*sin(2*PI*t*8)':
     contrast=1.20:gamma=0.90:eval=frame,
  colorbalance=bs=0.06:rs=-0.04,
  vignette=PI/5,
  noise=alls=4:allf=t+u,
  drawbox=x=0:y=0:w=1920:h=132:color=black:t=fill,
  drawbox=x=0:y=948:w=1920:h=132:color=black:t=fill,
  fade=t=in:st=0:d=0.5:color=black
" -c:v prores_ks -profile:v 3 -pix_fmt yuv422p10le out.mov
```

拆开看：

| 滤镜 | 作用 |
|------|------|
| `eq=saturation=0.10` | 大幅降饱和，接近单色 |
| `brightness='...sin(2*PI*t*8)'` | 8Hz 的轻微亮度闪烁，模拟放映机 |
| `contrast=1.20` + `gamma=0.90` | 压暗、提高对比，去掉灰雾 |
| `colorbalance` | 轻微冷色偏移 |
| `vignette=PI/5` | 暗角，让视线集中 |
| `noise=alls=4:allf=t+u` | 胶片颗粒 |
| `drawbox` | 上下 132px 黑边，做成 2.35:1 的观感 |
| `fade` | 片头从黑场淡入 |

注意：`eq` 的 `eval=frame` 是让亮度表达式随时间变化；没有这个参数，表达式只算一次。

## 3:38 逐渐上色

第一版在 3:38 用了白闪 + 硬切饱和度，结果「闪了一脸紫」。后来改成**在同一个镜头里逐渐上色**：

```bash
ffmpeg -i input.mov -vf "
  eq=saturation='0.10+1.15*min(t/1.5,1)':
     brightness='-0.08+0.10*min(t/1.5,1)':
     contrast='1.20-0.15*min(t/1.5,1)':
     gamma='0.90+0.10*min(t/1.5,1)':eval=frame,
  colorbalance=rs=0.05:bs=-0.03
" -c:v prores_ks -profile:v 3 -pix_fmt yuv422p10le out.mov
```

效果是 1.5 秒内：

- 饱和度从 0.10 到 1.25；
- 亮度从 -0.08 到 +0.02；
- 对比度从 1.20 到 1.05；
- 伽马从 0.90 到 1.00。

实测每 0.5 秒的饱和度：

```text
218.0s  sat=6.6
218.5s  sat=22.1
219.0s  sat=40.0
219.5s  sat=56.0
220.0s  sat=60.7
```

这样观众看到的是「颜色慢慢回来」，而不是「突然闪一下」。

## 双重曝光

两个镜头叠在一起，用 `blend`：

```bash
ffmpeg -i a.mov -i b.mov -filter_complex "
  [0:v]crop=1280:720:320:180,scale=1920:1080[a];
  [1:v]scale=1920:1080[b];
  [a][b]blend=all_mode=screen:shortest=1,format=yuv422p10le
" -c:v prores_ks -profile:v 3 out.mov
```

用途：

- 牵手 × 气泡，进入梦境；
- 拥抱 × 彩色圆圈，进入高潮；
- 0.8 秒即可，太长会糊。

踩坑：

- 不要拿「彩色 OP 画面」和「暖色拥抱」做 screen 双曝，容易出紫色；
- 双曝前后要接得住：前一镜和后一镜的动作/情绪要能连上；
- 双曝片段通常是替换等长的前后镜头，不是额外加时间。

## 转场原则

- **硬切为主**：大部分镜头直接切。
- **叠化**：梦境、回忆、时间流逝。
- **双曝**：进入另一个心理空间。
- **白闪/亮闪**：段落情绪爆发；本片后来把白闪改成了逐渐上色。
- **黑场**：尾奏收束。

## 小结

- 暗调段：降饱和、压暗、加对比、颗粒、暗角、黑边；
- 色彩段：用 `eq` 的时间表达式做 1.5 秒渐变；
- 双曝只做 0.8 秒，注意颜色和前后衔接；
- 转场为内容服务，不要为了炫技加效果。

下一篇讲最容易被忽略、但最影响观感的一步：音画对轴与 ASS 字幕。
