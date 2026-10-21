# 本地音乐使用说明

播放器已切换为**本地音乐模式**（`params.music.type = 'local'`），歌单来自：

```
static/music/playlist.json
```

## 添加歌曲

1. 把音频文件放进 `static/music/`，支持：`.mp3` `.flac` `.m4a` `.ogg` `.wav`
2. 推荐命名格式：`歌手 - 歌名.mp3`（会自动拆成歌手和歌名；不按这个格式也能用，整串文件名会当歌名）
3. 可选：
   - 歌词：与音频同名的 `.lrc` 文件，例如 `周杰伦 - 晴天.lrc`
   - 单曲封面：同名图片，例如 `周杰伦 - 晴天.jpg`
   - 全局默认封面：`static/music/cover.jpg`
4. 重新生成歌单（`dev` 和 `build` 也会自动执行）：

```bash
npm run music
```

## 说明

- 播放器在 PJAX 容器外，切换页面不会中断播放；进度/音量/播放状态存在 localStorage，整页刷新后也会恢复。
- `static/music/示例 - 静音测试.wav` 是占位测试文件，添加自己的音乐后可删除。
- 歌单文件由脚本生成，不要手改 `playlist.json`（下次运行会被覆盖）。
