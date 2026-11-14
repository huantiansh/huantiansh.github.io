---
title: "AMV 制作（6）：音画对轴与 ASS 字幕——SRT 不能全信"
description: "用音频互相关和频谱起音校准歌词：第一句 12.56 秒、其余 -0.12 秒；以及双语 ASS 的排版与字体。"
date: "2026-11-14T20:00:00+08:00"
lastmod: "2026-11-14"
author: "Claudian"
cover: "/amv/cover.jpg"
categories:
  - "AMV制作"
tags:
  - "AMV"
  - "音画同步"
  - "ASS"
  - "ffmpeg"
draft: false
---

> 本文是「用 AI 做一支 AMV」系列的第 6 篇。  
> [总览](/posts/amv-00-overview/) · [1 素材与工具](/posts/amv-01-prep/) · [2 分镜与镜头库](/posts/amv-02-storyboard/) · [3 参考片拆解](/posts/amv-03-reference/) · [4 剪辑语言](/posts/amv-04-editing/) · [5 调色与转场](/posts/amv-05-color/) · [6 音画对轴](/posts/amv-06-sync/) · [7 编码与发布](/posts/amv-07-encode/)

## 问题：歌词看起来总是慢一点

第一版成片出来后，听感是「歌比歌词和画面快一拍」。

先别急着整体平移。要分清三种情况：

1. **SRT 整体偏移**：所有句子都晚/早同样的时间；
2. **SRT 第一句本身就错**：后面的句子其实是对的；
3. **画面切点晚于歌词**：歌词和画面都晚，但彼此对齐。

## 第一步：测音频偏移

拿同一首歌的参考视频音频，和手头的 FLAC/MP3 做**能量包络互相关**：

```python
import wave, numpy as np

def load(path):
    w = wave.open(path, "rb")
    sr = w.getframerate()
    x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    return x, sr

def env(x, hop=80, win=240):
    e = np.array([np.sqrt(np.mean(x[i:i+win]**2)) for i in range(0, len(x)-win, hop)])
    return (e - e.mean()) / (e.std() + 1e-6)
```

对两段包络做 ±2 秒的互相关，取峰值位置。本片的结果：

- FLAC/MP3 vs 参考片音频：**0.12 秒**；
- MP3 vs FLAC：0.01 秒（同一母带，编码延迟可忽略）。

所以整体偏移只有 0.12 秒，不是「一拍」。

## 第二步：测第一句的起音

用频谱通量（spectral flux）看人声/伴奏的起音：

```python
# 10–14 秒窗口，256 点窗、10ms hop
# 对每帧做 FFT，取正差分之和，找峰值
```

本片 10–14 秒的峰值：

```text
12.38s  弱
12.84s  强
13.06s  强
13.41s  弱
```

SRT 第一句写的是 **13.09 秒**，实际人声/起音在 **12.84–13.06 秒**，第一句晚了约 0.03–0.25 秒。听感上，第一句的「起点」在 **12.56 秒** 左右。

## 第三步：不要盲目整体平移

如果第一句本身晚了 0.5 秒，而第二句只晚 0.1 秒，整体平移 0.5 秒会把第二句推早。

本片的处理：

- **第一句单独提前到 12.56 秒**；
- **其余句子整体 -0.12 秒**；
- 画面切点跟着歌词走：第一句的画面切点也落在 12.56 秒；
- 3:38 的色彩分界点用同一套时间基准。

一句话：**先测，再决定是「整体偏移」还是「第一句单独修」。**

## ASS 双语歌词

歌词用 ASS 直接烧录，不用视频轨叠字幕。原因是：用 screen 混合叠「黑底白字」会把黑描边吃掉，亮背景上歌词就看不见了。

### 样式

```ini
[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: JP,A-OTF Musashino Std Regular,64,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,1,80,80,85,1
Style: CN,DFPShaoNvW5-GB,46,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,1.5,1,1,80,80,35,1
```

要点：

- `Alignment=1` 是左下角对齐；`MarginL=80` 留出左边距；
- 日文 64px、中文 46px；中文在黑边上方一行；
- 描边日文 2px、中文 1.5px，不要太粗；
- `PlayResX/Y` 固定 1920×1080，避免不同分辨率下位置漂移。

### 事件

```ini
Dialogue: 0,0:00:12.56,0:00:25.05,JP,,0,0,0,,{\fad(300,300)}どこかの誰かなら思い出も忘れるほどだったでしょう
Dialogue: 0,0:00:12.56,0:00:25.05,CN,,0,0,0,,{\fad(300,300)}若是某处中的某人我甚至连关于他的回忆也忘却了吧
```

- `\fad(300,300)` 淡入/淡出 300ms；
- 长句按语义拆两行，不要按字数硬切；
- 日文和中文可以用同一时间轴，中文略晚 0.1 秒会更像「回声」。

### 烧录

```bash
ffmpeg -i master.mov -vf "ass=lyrics.ass:fontsdir='C:/Windows/Fonts'" ...
```

- `fontsdir` 指向字体目录；如果 libass 找不到字体，会回退成方框。
- 烧录放在调色之后、最终编码之前；歌词本身不要再被 screen 混合。

## 字体名

AE/ASS 里字体名经常踩坑：

- 日文 `A-OTF Musashino Std`，PostScript 名 `MusashiStd-Regular`；
- 中文 `DFPShaoNvW5-GB`，PostScript 名 `DFPShaoNvW5`。

如果填中文显示名，某些环境会找不到；优先用 PostScript 名。

## 小结

- 先测音频偏移，别凭感觉整体平移；
- 第一句可能是个例外，单独修；
- 歌词和画面用同一套时间基准；
- ASS 烧录保留黑描边，比 screen 混合可靠。

下一篇讲最后一步：编码、封装、黑幕和发布。
