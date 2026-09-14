# 游戏音频来源与替换指南

`assets/resources/audio/` 下的音频由 CC0（公有领域）素材转换而来，可免费商用、无需署名。
BGM 为 22050Hz 单声道 MP3（libsndfile 编码，357KB），音效为 22050Hz / 16bit / 单声道 WAV
（短音效用 WAV 保证零解码延迟）。文件名不含扩展名引用（`audio/bgm` 等），AudioManager 无需改动。

> 旧的 `generate_audio_assets.py` 是最早一版 numpy 合成音频的生成脚本，已被本目录的
> CC0 素材取代；保留仅作历史参考，重新运行它会覆盖掉现在这批音频，**不要再执行**。

## 当前映射

| 游戏文件 | 来源 | 说明 |
|---|---|---|
| `bgm.mp3` (60.0s, 357KB) | [Flowerbed Fields (Loop)](https://opengameart.org/content/flowerbed-fields-loop)（CC0） | 欢快可爱的休闲解谜风循环曲（对标羊了个羊的能量感），取前 60s + 1s 交叉淡化无缝循环，MP3 96kbps 级 |
| `click.wav` | [Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds) `click_001` | 通用按钮点击（**当前 AudioManager 已将 click 全局静音**，文件保留备用） |
| `collect.wav` | 同上 `bong_001` | 收卡的木琴「啵」，饱满有弹性，与按钮 click 明显区分 |
| `match.wav` | 同上 `confirmation_002` | 三消成功的确认音 |
| `win.wav` | [Kenney Music Jingles](https://kenney.nl/assets/music-jingles) `jingles_PIZZI02`（拨弦·上行） | 通关胜利 stinger |
| `fail.wav` | 同上 `jingles_PIZZI01`（拨弦·下行） | 失败 stinger，与 win 同乐器配对 |

> BGM 历史：第一版《Cozy Puzzle In-Game 3》（偏安静）→ 第二版《Happy Adventure》→
> 当前《Flowerbed Fields》（用户点名要羊了个羊式欢快魔性风）。同许可证备选：
> [CC0 Music collection](https://opengameart.org/content/cc0-music-0)、
> [3xBlast Free Music Pack](https://opengameart.org/content/3xblast-free-music-pack-15-songs)（15 首混风格，需自行挑选）。
> 收卡音备选（同包 CC0）：`drop_001`（水滴感）/ `glass_004`（玻璃风铃感）。

## 如何再换

1. 挑好新的 CC0 音频（ogg/mp3/wav 均可）。
2. 用 `soundfile` + `scipy.signal.resample_poly` 转成 22050Hz 单声道 16bit WAV，
   **保持文件名不变**（`bgm.wav` 等），`.meta` 由编辑器维护、不要手改。
3. SFX 建议做静音修剪 + 4ms 淡入 / 60ms 淡出 + 峰值归一化到 0.85；
   BGM 循环建议按小节裁剪并做首尾交叉淡化，避免循环处爆音或断层。

## 许可证

- Kenney.nl 全部素材：CC0 1.0（https://kenney.nl/support 处有声明）
- OpenGameArt 上述曲目：页面标注 CC0

CC0 无需在游戏中署名；如果未来换成 CC-BY 素材，必须在设置页或关于页加署名。
