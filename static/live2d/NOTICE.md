# Live2D / 语音素材来源与使用说明

本站的 Live2D 看板娘与语音仅用于个人、非商业的博客展示，相关角色与音频版权归原权利方所有。

## 模型

- 角色：碧蓝航线 · 独角兽（默认校服）
- 模型来源：`Eikanya/Live2d-model` 仓库中的 `dujiaoshou_4`
- 文件：`dujiaoshou_4.moc3`、`dujiaoshou_4.model3.json`、`dujiaoshou_4.physics3.json`、`motions/`、`textures/`
- 版权归 Manjuu / Yongshi / Yostar 等原权利方所有

## 语音

- 来源：碧蓝航线国服客户端语音资源 `AssetBundles/cue/cv-20603.b`
- 获取方式：通过官方国服资源 CDN 下载该 AssetBundle，校验 MD5 后用 `vgmstream-cli` 逐条解出 CRI HCA 音频，再解码为 WAV
- 原始编码：CRI HCA 58 kbps 单声道（游戏内原始资源本身为有损压缩，不存在真正的无损母带；WAV 为原始 HCA 解码后的 PCM，未再经过 MP3 二次编码）
- 文件：`unicorn/voice/*.wav`
- 版权归 Manjuu / Yongshi / Yostar 等原权利方所有

## 运行时

- Live2D 看板娘组件：`oh-my-live2d`（MIT License）
- Live2D Cubism Core：Live2D Inc. 所有，遵循 Live2D Cubism SDK 许可

如权利方要求，请删除 `static/live2d/` 下相关素材。
