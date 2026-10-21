# Live2D / 语音素材来源与使用说明

本站的 Live2D 看板娘与语音仅用于个人、非商业的博客展示，相关角色与音频版权归原权利方所有。

## 模型

- 角色：碧蓝航线 · 独角兽
- 皮肤：憧憬的约会日（皮肤 ID 206033，EN 名 Long-Awaited Date）
- 模型来源：`Eikanya/Live2d-model` 仓库中的 `dujiaoshou_4`
- 文件：`dujiaoshou_4.moc3`、`dujiaoshou_4.model3.json`、`dujiaoshou_4.physics3.json`、`motions/`、`textures/`
- 文章《游乐园关门前》头图使用该皮肤官方立绘（skin 206033），版权归原权利方所有
- 版权归 Manjuu / Yongshi / Yostar 等原权利方所有

## 语音

- 来源：碧蓝航线国服客户端语音资源 `AssetBundles/cue/cv-20603.b`
- 获取方式：通过官方国服资源 CDN 下载该 AssetBundle，校验 MD5 后用 `vgmstream-cli` 逐条解出 CRI HCA 音频，再解码为 WAV
- 皮肤专属语音：使用 `_3` 后缀 cue（对应皮肤 ID 206033），包括 `login_3`、`home_3`、`main_1_3`、`main_2_3`、`main_3_3`、`touch_1_3`、`touch_2_3`、`task_3`、`feeling5_3`
- 动作绑定：`main_*`、`touch_*`、`task`、`home` 分别绑定 `dujiaoshou_4` 中同名/别名 motion；`touch_head`、`mail`、`mission_complete` 使用默认皮肤的语音作为补充
- 原始编码：CRI HCA 58 kbps 单声道（游戏内原始资源本身为有损压缩，不存在真正的无损母带；WAV 为原始 HCA 解码后的 PCM，未再经过 MP3 二次编码）
- 文件：`unicorn/voice/*.wav`
- 版权归 Manjuu / Yongshi / Yostar 等原权利方所有

## 运行时

- Live2D 看板娘组件：`oh-my-live2d`（MIT License）
- Live2D Cubism Core：Live2D Inc. 所有，遵循 Live2D Cubism SDK 许可
- 本地修改：`oml2d.min.js` 内置的 `unpkg.com` 版本检查 URL 已替换为本地 data URL，避免网络不可达时初始化失败；其余逻辑未改

如权利方要求，请删除 `static/live2d/` 下相关素材。
