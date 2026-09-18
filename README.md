# 猫爪星球奇遇记（MVP 原型）

这是基于 Cocos Creator 3.8.8 搭建的微信小游戏原型工程。

当前界面按手机竖屏设计（750×1334），使用固定宽度策略适配不同手机比例。

## 当前内容

- 首页：猫咪小镇、生命/金币信息、三个建筑入口、开始闯关、无尽模式入口
- 三消关卡：多层覆盖棋盘、点击收集、三个相同元素自动消除
- 关卡目标：清空棋盘中的全部元素
- 6 格收集槽位、满槽失败、清空胜利和结算提示
- 连消情绪反馈：成功三消之间间隔不超过 2 秒时显示逐级增强的连消文字、光晕和粒子，不额外改变金币或关卡规则
- 锤子、重排和临时增加第 7 个槽位
- 建设小镇页、猫咪图鉴/详情页、每日任务页、道具商店页和“瞬间”记忆相册页
- 小镇建设小节点：建筑三阶段拆成 20 个小格（清理 5 / 修复 7 / 装饰 8），点亮 1 格固定消耗 ⭐3，与“每关 3 星”对齐（1 关 = 1 格）；亮满一个阶段建筑外观变化一次，装饰完成解锁对应猫咪；结算弹窗有“去建设”直达入口，第 1 关通关后有一次性建设引导
- 冒险地图页：章节关卡节点、星星/金币进度、当前关卡挑战和锁定提示，地图区域支持上下滑动换页（也可用“上一章/下一章”按钮）
- 超萌挑战：首页左侧金币入口，对标“羊了个羊第二关”的固定单关——约 54~60 张牌 / 15 种元素 / 固定 7 层深堆、收集槽只有 5 格（额外槽位道具可 +1），贴满压力规划让最优路径长期骑在 4/5 满槽边缘（无放松段）；48 个候选按残酷度取前 6，再各跑一次玩家风险模拟、挑模拟失败率最高者发出；每日首次通关发大额金币、同日重复通关按普通过关金币发放（入口文案切换为“今日已领取”）；不发星星、不写入难度自适应；每次进入或再玩一次都保持高压配置、只换元素排布，避免记住卡牌位置
- 无尽模式：首页开始闯关下方入口，棋盘永不空完。开局约 90 张密铺，场上剩余 ≤ 50 张时从最底层垫约 40 张，不得把新牌盖在正在点的牌上。每次补卡升一档难度，大约 3 分钟内爬到高压；按消除卡片数本地结算，不发星星、不推进主线、本版不上报排行榜
- 版本化本地玩家存档：金币、星星、关卡、建设阶段、猫咪进度、道具库存和每日任务；除排行榜累计星星上报微信开放数据域外，其余玩法数据不与服务器交互
- 激励视频：失败每关最多一次清出槽里一对继续（保证复活后还能往下玩），胜利结算可观看广告领取等额金币追加奖励
- 组件化结算弹窗：成功 / 失败状态、奖励展示、下一关、重试和返回首页

## 结算弹窗

结算 UI 位于 `assets/scripts/SettlementPopup.ts`，通过 `SettlementPopup.open(parent, options)` 创建，素材位于 `assets/resources/result_model/`。`GameScreen.ts` 负责传入结算状态、奖励数值和按钮回调，成功 / 失败弹窗均可从结算页返回首页，因此后续关卡或其他玩法可以复用同一套弹窗。

## 打开方式

1. 使用 Cocos Creator 3.8.8 打开本目录 `cat-world`。
2. 在资源管理器中打开 `assets/scenes/main.scene`。
3. 点击编辑器顶部预览按钮运行。

## H5 / TapTap 启动页

web-mobile 打包时引擎和首包下载前没有游戏内加载页，页面默认深灰会黑屏一段时间。`build-templates/web-mobile/` 覆盖官方 HTML 模板：打开页面立刻显示奶油风动画（猫爪拍毛线球，无进度条），游戏内 `LoadingScreen` 就绪后收掉。重新构建 web-mobile 即可带上。

## 资源压缩

资源压缩脚本位于 `scripts/compress_resources.py`。它根据图片长边自动分级：不超过 128px 的小图保持无损，较小透明图片使用 128 色，中等透明图片使用 192 色，大图最多使用 256 色；量化后的颜色和透明度误差超过阈值时会自动回退为无损 PNG。脚本同时检查 PNG/JPG/JPEG，并会对指定的超采样 HUD 与导航图标按约 2 倍显示尺寸降采样，以减少解码时间和纹理内存。

默认情况下，长边至少 512px 且没有透明通道的 PNG，以及已有的 JPG/JPEG，会尝试使用质量检查后的 JPG 重编码；检查不通过则保留原 JPG，PNG 会回退到 PNG 优化。微信小游戏不支持 WebP，因此脚本不会生成 WebP。PNG 转 JPG 时会同步更新图片 `.meta` 中的扩展名并保留 UUID，代码中的资源路径无需改动。先预览压缩结果：

```sh
python3 scripts/compress_resources.py --dry-run
```

确认画面效果后执行压缩，原图默认备份到系统临时目录下的 `cat-world-originals`：

```sh
python3 scripts/compress_resources.py --backup-dir /tmp/cat-world-originals
```

`--backup-dir` 可指定其他工程外目录；只有确认不需要备份时才使用 `--no-backup`。

压缩后重新打开 Cocos Creator，让资源重新导入，再按正常流程预览并打包。默认是 `compact` 模式，目标是在可接受的画质误差内尽量减小当前资源；更重视画质时使用 `--quality high`，需要中间方案时使用 `--quality balanced`。`--opaque-format png` 可禁止不透明图片转 JPG，`--opaque-min-dimension 512` 可调整 PNG 转 JPG 的尺寸阈值。`--colors` 只是限制透明 PNG 自动分级的最高颜色数；需要完全无损时使用 `--lossless`。

脚本按页面拆分：`assets/scripts/LoadingScreen.ts` 是启动加载页（参考 `image/loadinng/` 图一实现，启动时只创建加载页，按真实完成数优先预加载首页、当前主线关卡及结算弹窗资源，100% 时这两条关键路径全部就绪，再回调 `onFinish` 创建首页；其他页面在用户首次打开时按需加载并由 `AssetStore` 缓存），`assets/scripts/HomeScreen.ts` 负责小镇首页，`assets/scripts/AdventureScreen.ts` 负责主线冒险地图，`assets/scripts/TownScreen.ts` 负责建设小镇页，`assets/scripts/GameScreen.ts` 负责闯关页，`assets/scripts/SettlementPopup.ts` 负责结算弹窗，`assets/scripts/Toast.ts` 是全局提示组件（`Toast.show(parent, text, { y?, duration? })`，深色胶囊底板 + 弹入动画，同一页面同时只保留一条，各页面的 `toast()` 方法都是对它的一行封装），`assets/scripts/CatCollectionScreen.ts` 和 `assets/scripts/CatDetailScreen.ts` 负责猫咪收集与养成，`assets/scripts/DailyTaskScreen.ts` 负责每日任务，`assets/scripts/ShopScreen.ts` 负责道具商店，`assets/scripts/Main.ts` 负责初始化、页面路由和全局状态接入。`assets/scripts/PlayerStore.ts` 是金币、星星、猫咪、库存和每日任务的唯一数据源，公共资源缓存位于 `assets/scripts/AssetStore.ts`。

## 自动关卡系统

关卡逻辑位于 `assets/scripts/level/`，与 Cocos UI 解耦：

- `LevelGenerator.ts` 使用确定性 Seed 生成按层左右镜像对称的多层布局（上层按配额把一部分镜像牌与父层完全同位叠放，即"羊了个羊"式全叠：遮挡比例在 0.25 / 0.5 格点之外放行 1.0，叠柱深度 2~4，`scripts/profile-full-stack.ts` 可统计全叠分布），先构造合法移除见证路径，再按“压力段 / 缓解段”交替分配三消种类，并过滤节奏、难度上下限、普通玩家失误模拟风险或重复的候选。生成按“关卡角色”分化：`normal` 正常生成；`breather` 爽关减少两种元素并用 combo 原型制造三消连击（验收要求 maxCombo ≥ 2）；`spike` 难关把牌量压到普通关一半左右、强制使用 stacked/hidden/order 压力原型（难关必须短，难度来自密度而非规模）。主线风险目标按生命周期分段：L2-L5 新手保护约 8%-15%（先留人）、L6-L10 约 15%-25%（建立"失败→复活"习惯）、L11-L22 约 25%-40%、L23+ 约 30%-45%（变现档），难度验收同时使用上下容差带。此外生成验收包含"失败可挽回感"硬指标（失败率足够高、非爽关/救援）：`failureProgressAvg ≥ 80`（尾段失败）、`trappedPairRate ≥ 60`（失败时槽内带听牌）、`reviveRescueRate ≥ 55`（按真实复活规则模拟失败后清对子，剩余棋盘可解）。未进带的候选按这三项偏差排序兜底，不允许发出中盘就死或复活后无解的关。相关指标可用 `scripts/smoke-revive-check.ts` 验收。
- `LevelSolver.ts` 使用与游戏一致的遮挡、槽位和三消规则搜索路径，同时统计压力时刻、缓解时刻和节奏切换。正结果包含完整通关路径；负结果只有在搜索未被状态上限截断时才算已证明无解。`LevelGenerator.ts` 另外用有上限的确定性轻度失误模拟评估“错误选择风险”，不把最佳通关路径当作玩家失败率。
- `DifficultyController.ts` 保存最近 10 局表现，综合胜率、连胜/连败、失误、耗时和槽位余量计算下一关目标，并提供连续失败救援和三步恢复。在其之上有一层按关卡号驱动的“节拍表”：主题内第 5/10/15/20 关为 breather 爽关，第 9/14/19 关为 spike 难关（连败 ≥ 2 次自动取消；L23+ 变现档不再因精通度取消难关，救援关优先于节拍表），让难度曲线呈现“爬坡—释放—小高潮”的受控起伏。看广告通关不计入连胜。
- `LevelSystem.ts` 是后续页面代码使用的入口，负责生成下一关、记录表现、保存最近关卡和序列化状态。

批量验收命令：

```sh
/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/resources/3d/engine/node_modules/@cocos/typescript/bin/tsc --target ES2018 --module commonjs --moduleResolution node --strict false --skipLibCheck --outDir .codex/level-system-build scripts/validate-level-system.ts
node .codex/level-system-build/scripts/validate-level-system.js
```

该脚本会生成并验证 1000 个不同 Seed，检查种类数量、镜像对称布局、见证路径、Solver 可解性、唯一性、救援关成功率和动态难度恢复。`GameScreen.ts` 已接入生成的 `LevelDefinition`，并把真实对局表现回传给 `LevelSystem`；现有 UI 布局和素材未改动。

存档逻辑验收命令（使用 Node 内存存储模拟 Cocos 的 `sys.localStorage`）：

```sh
/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/resources/3d/engine/node_modules/@cocos/typescript/bin/tsc --target ES2018 --module commonjs --moduleResolution node --strict false --skipLibCheck --outDir .codex/player-store-build scripts/player-store-test-types.d.ts scripts/validate-player-store.ts
node -r ./scripts/player-store-cc-shim.js .codex/player-store-build/scripts/validate-player-store.js
```

该脚本覆盖新档默认值、奖励与扣款、建筑建设和猫咪解锁、商店每日限购、每日任务与宝箱、猫咪互动、超萌挑战领奖标记、无尽纪录以及旧档/坏档归一化。

无尽补波验收：

```sh
/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/resources/3d/engine/node_modules/@cocos/typescript/bin/tsc --target ES2018 --module commonjs --moduleResolution node --strict false --skipLibCheck --outDir .codex/endless-director-build scripts/validate-endless-director.ts
node .codex/endless-director-build/scripts/validate-endless-director.js
```
