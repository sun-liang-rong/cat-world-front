# 猫爪星球奇遇记（MVP 原型）

这是基于 Cocos Creator 3.8.8 搭建的微信小游戏原型工程。

当前界面按手机竖屏设计（750×1334），使用固定宽度策略适配不同手机比例。

## 当前内容

- 首页：猫咪小镇、生命/金币信息、三个建筑入口、开始闯关、无尽模式入口
- 三消关卡：多层覆盖棋盘、点击收集、三个相同元素自动消除；8 个主题各有专属卡牌皮肤，单张缺失时回退通用皮肤。主题 6–8 只换卡面，不新增小镇建筑或猫咪

- 关卡目标：默认清空棋盘；收集指定元素关排在第 11 / 13 / 16 / 18 / 21 / 24 / 28 关，以及主题 3–8 对应位置（51–58、71–78、91–98、111–118、131–138、151–158），三消够数即可过关、不必清空
- 主线 160 关：打完第 160 关后不再生成第 161 关，首页与冒险提示「新主题即将到来」
- 6 格收集槽位、满槽失败、清空胜利和结算提示
- 连消情绪反馈：成功三消之间间隔不超过 2 秒时显示逐级增强的连消文字、光晕和粒子，不额外改变金币或关卡规则
- 锤子、重排和临时增加第 7 个槽位
- 建设小镇页、猫咪图鉴/详情页、每日任务页、道具商店页和“瞬间”记忆相册页
- 小镇建设小节点：建筑三阶段拆成 20 个小格（清理 5 / 修复 7 / 装饰 8），点亮 1 格固定消耗 ⭐3，与“每关 3 星”对齐（1 关 = 1 格）；每格增加花朵、亮满阶段更新建筑；大橘在小屋清理完成后加入，其余猫在装饰完成后加入；结算弹窗有“去建设”直达入口，第 1 关通关后有一次性建设引导
- 冒险地图页：章节关卡节点、星星/金币进度、当前关卡挑战和锁定提示，地图区域支持上下滑动换页（也可用“上一章/下一章”按钮）
- 高手挑战：首页独立挑战入口，对标“羊了个羊第二关”的固定单关——69 张牌 / 15 种元素 / 固定 8 层深堆、收集槽只有 5 格（额外槽位道具可 +1），同种牌按层距打散、全叠配额更高，贴满压力规划让最优路径长期骑在 4/5 满槽边缘（无放松段）；48 个候选按残酷度取前 6，再各跑一次玩家风险模拟、挑模拟失败率最高者发出；每日首次通关金币 ×3000、同日重复通关金币 ×80（入口文案切换为“今日已领取”）；不发星星、不写入难度自适应；每次进入或再玩一次都保持高压配置、只换元素排布，避免记住卡牌位置
- 无尽模式：首页开始闯关下方入口，棋盘永不空完。开局约 90 张密铺，场上剩余 ≤ 50 张时从最底层垫约 40 张，不得把新牌盖在正在点的牌上。每次补卡升一档难度，大约 3 分钟内爬到高压；按消除卡片数本地结算，不发星星、不推进主线、本版不上报排行榜
- 版本化本地玩家存档：金币、星星、关卡、建设阶段、猫咪进度、道具库存和每日任务；除排行榜累计星星上报微信开放数据域外，其余玩法数据不与服务器交互
- 激励视频：失败每局最多一次腾出槽位，主线前五关免费；保留必需的收集目标卡，胜利结算可观看广告领取等额金币追加奖励
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

- `LevelGenerator.ts` 使用确定性 Seed 生成按层左右镜像对称的多层布局（上层按配额把一部分镜像牌与父层完全同位叠放，即"羊了个羊"式全叠：遮挡比例在 0.25 / 0.5 格点之外放行 1.0，叠柱深度 2~4，`scripts/profile-full-stack.ts` 可统计全叠分布），先构造合法移除见证路径，再按“压力段 / 缓解段”交替分配三消种类，并过滤节奏、难度上下限、普通玩家失误模拟风险或重复的候选。生成按“关卡角色”分化：`normal` 正常生成；`breather` 爽关减少两种元素并用 combo 原型制造三消连击（验收要求 maxCombo ≥ 2）；`spike` 难关把牌量压到普通关一半左右、强制使用 stacked/hidden/order 压力原型（难关必须短，难度来自密度而非规模）。主线风险目标按生命周期分段：L1-L5 新手保护约 0%-15%、L6-L10 约 15%-25%、L11-L22 约 25%-40%、L23+ 约 30%-45%，难度验收同时使用上下容差带。此外生成验收包含"失败可挽回感"硬指标（失败率足够高、非爽关/救援）：`failureProgressAvg ≥ 80`（尾段失败）、`trappedPairRate ≥ 60`（失败时槽内带听牌）、`reviveRescueRate ≥ 55`（按真实复活规则模拟失败后清对子，剩余棋盘可解）。未进带的候选按风险与救援指标偏差排序兜底；模拟指标不是对每位玩家的复活可解承诺。相关指标可用 `scripts/smoke-revive-check.ts` 验收。
- `LevelSolver.ts` 使用与游戏一致的遮挡、槽位和三消规则搜索路径，同时统计压力时刻、缓解时刻和节奏切换。正结果包含完整通关路径；负结果只有在搜索未被状态上限截断时才算已证明无解。`LevelGenerator.ts` 另外用有上限的确定性轻度失误模拟评估“错误选择风险”，不把最佳通关路径当作玩家失败率。
- `DifficultyController.ts` 保存最近 10 局表现，综合胜率、连胜/连败、失误、耗时和槽位余量计算下一关目标，并提供连续失败救援和三步恢复。在其之上有一层按关卡号驱动的“节拍表”：主题内第 5/10/15/20 关为 breather 爽关，第 9/14/19 关为 spike 难关（连败 ≥ 2 次自动取消；L23+ 变现档不再因精通度取消难关，救援关优先于节拍表），让难度曲线呈现“爬坡—释放—小高潮”的受控起伏。看广告通关不计入连胜。
- `LevelSystem.ts` 是后续页面代码使用的入口，负责生成下一关、记录表现、保存最近关卡和序列化状态。

批量验收使用 Cocos Creator 自带编译器，配置在 `scripts/ux-tests.tsconfig.json`，`types: []` 避免工作区外的 Node 声明污染：

```sh
/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/resources/3d/engine/node_modules/@cocos/typescript/bin/tsc -p scripts/ux-tests.tsconfig.json
node .codex/ux-tests/scripts/validate-level-system.js
node -r ./scripts/player-store-cc-shim.js .codex/ux-tests/scripts/validate-player-store.js
node .codex/ux-tests/scripts/validate-endless-director.js
node scripts/validate-platform-ux.js
node scripts/check_track_contract.js
/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/resources/3d/engine/node_modules/@cocos/typescript/bin/tsc -p scripts/game-flow-tests.tsconfig.json
node scripts/validate-game-flow.js
```

关卡脚本验收 1000 个 Seed 的唯一性、合法布局、见证路径、Solver 可解性、救援与难度恢复；存档脚本覆盖奖励、建设解锁、旧档迁移、坏主档冗余恢复和对局快照；平台脚本覆盖分享无回调、取消视频、完播、超时及迟到回调。它们不能代替 Cocos 编辑器完整一关与微信真机验收。

## 2026-10-10 体验优化

前五关牌量为 18 / 27 / 33 / 42 / 48，种类为 4 / 4 / 5 / 6 / 6。大橘试住 5 局有效主线，小屋清理 5 格后永久安家，旧档保留进度并补发应得猫咪。猫技能充能满后手动使用，每局一次，无分钟冷却；未使用的充能跨局保留。关卡内技能入口固定在顶部，不覆盖棋盘，不再读取旧版宠物拖动位置。互动值不是升级门槛，好感 20 解锁照片，120/140/160 关有相册故事。

首页显示当前目标与真实入住猫，未解锁模式和过期活动隐藏；结算突出下一关/重试。分享仅用于自愿展示成果，每日道具补给独立领取。骰子先验证当前局面可解再扣道具，锤子/猫技能保护必需目标牌，快速点击不会因视觉动画取消而阻塞结算。

PlayerStore 在本地保存未结算对局及冗余副本；后台暂停有效计时与音频，重进可继续本局，试住及道具不会再扣。主动离开对局会清除快照。首屏资源失败可重新加载或进入首页，挑战生成有等待上限。AssetStore 按路径保留一份可复用纹理，解决重进页面重复创建问题；尚未采用 GPU 资源淘汰，需要真机测量总峰值。

## 微信构建与配置

1. Cocos Creator 3.8.8 打开 `assets/scenes/main.scene`，在 Main 组件配置正式微信 `rewardedAdUnitId`。默认空值会隐藏微信视频入口，预览模拟完播。TapTap 广告位独立，不复用给微信。
2. 用当前源码构建微信小游戏，随后运行 `node scripts/prepare-wechatgame.js build/wechatgame`。若输出目录不同，将它作为参数传入。
3. 脚本复制 `wechat/open-data/index.js` 并登记 `openDataContext`，设 request=12s、downloadFile=20s；好友榜只读取 `cat_world_stars`，不读取/上传其他玩法存档。既有旧 build 不是本轮构建验收结果。
4. 微信开发者工具和真机验证：安全区、资源断网重试、退出重进、广告取消/完播/无填充、好友榜分页。累计星星需微信开放数据能力，预览只能显示 Mock。
5. 埋点目录 v2 必须与 service 同步部署；web 新看板兼容尚未返回 cohorts 的旧服务。客户端不调用自建身份/排行接口，不做登录或云存档。

详见 `docs/用户体验优化实施记录-2026-10-10.md`，权威玩法修订在工作区 `../需求.md`。
