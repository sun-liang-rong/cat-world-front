# 性能优化计划

> 本文件取代 `PERFORMANCE_OPTIMIZATION.md`。那份文档是推测性的（基于"GameScreen 有 2819 行、tween 用了 78 处"这类静态观察），若干建议经实测并不划算，部分"已实施"项实际未接线。本文所有结论来自代码核对 + 可复现实测。

## 一、约束与判定口径

**硬约束：优化不得改变现有游戏功能与表现。**

据此把每一项分成两类：

- **A 组 · 零功能影响**：改动后玩家侧完全感知不到差异。判定标准是三选一——
  ① 被改的代码/文件根本没有调用方（死代码）；② 只是换了一种等价写法，输入输出逐位相同（已用等价性测试证明）；③ 只是修正一个不影响运行的错误引用。
- **B 组 · 会影响功能或表现**：必然触碰画面、难度、加载时序或手感中的至少一项。**需要你逐项确认后才动手。**

结论：全部候选中只有 **A 组 12 项**满足硬约束，**已全部实施完成**；B 组 9 项都属于"必然改变行为"，需逐项确认。后续你确认推进 **B1 / B2+B3 / B5+B6**，也已实施完成（见第四节）；B4 / B7 / B8 / B9 仍未动。

## 二、实测基线

| 指标 | 实测值 | 测法 |
|---|---|---|
| 资源图片数 / 源体积 | 245 张 / 6.6 MB | 遍历 `assets/resources` |
| 解码后纹理内存（RGBA 估算） | **≈110 MB**（膨胀 16.6×） | 解析 PNG IHDR / JPEG SOF 取宽高 ×4 |
| 其中 6 张全屏背景 | **35.1 MB** | 同上 |
| 主线关卡生成耗时 | avg 37 ms / max 102 ms | `scripts/profile-generation-perf.ts` |
| 第 80 关生成耗时 | avg **113.7 ms** / max 125 ms | `scripts/bench-level-generation.ts` |
| 超萌挑战生成耗时 | avg **108 ms** / max 182 ms | 临时探针（48 次 attempt 全跑） |
| 每次点击的遮挡判定 | **0.275 ms**（84 张牌 / 14112 次判定） | 临时探针（复刻 `isTopTile` + `refreshBoardTileStates`） |
| 单次存档写入 | **0.0056 ms**（存档 2.21 KB） | 临时探针 + `scripts/player-store-cc-shim.js` |
| 无尽补波 `createWaveTiles` | 0.48 – 3.33 ms | 临时探针 |
| 构建产物 | 2.3 MB（cocos-js 1.3 M + assets 692 K） | `du -sh build/wechatgame` |

## 三、A 组：零功能影响 —— 已全部实施

| # | 改动 | 为什么零影响 | 状态 |
|---|---|---|---|
| A1 | 删除 `HomeScreen.startCatIdleAnimation` 里的 `floatMotion` 补间 | `floatMotion = { offset: 0 }` 只被补间写、**全工程无任何读取方**，删掉前后没有任何节点或数值受影响 | 已完成 |
| A2 | `HomeScreen.ts:7` 的 `import ... from './AdManager'` 改为 `'./RewardedAdService'` | `AdManager.ts` 不存在（重命名时漏改）。同工程 `GameScreen` / `ShopScreen` / `SettlementPopup` 都从 `RewardedAdService` 导入。运行时没炸只是因为 Cocos 打包器不做类型检查、会擦除纯类型导入；改成正确路径后编译产物完全一致 | 已完成 |
| A3 | 删除 `assets/scripts/ObjectPool.ts`（+ `.meta`） | 全工程 0 处 import，且无任何资源引用其 UUID | 已完成 |
| A4 | 删除 `assets/scripts/TweenManager.ts`（+ `.meta`），并把 `GameScreen` 里 5 处 `managedTween(x)` 换回 `tween(x)` | `TweenManager` 只做统计、不干预行为：`createTween` 从不校验 `maxConcurrentTweens`，`stopAll()` 无调用方，`getStats()` 无调用方。`managedTween` 与 `tween` 返回的是同一个 `Tween` 实例，纯函数替换 | 已完成 |
| A5 | 删除 `LevelSystem.nextLevel()` / `retryLevel()` 两个**同步**方法 | 全工程无调用方（`Main` 只用 `nextLevelAsync` / `retryLevelAsync`）。同步版会阻塞主线程，删掉同时消除了被误用的风险 | 已完成 |
| A6 | 删除 `PerformanceManager` 的 FPS 死链路与零读取配置 | 删除 `updateFPS` / `autoAdjustConfig` / `getFPS` / `adjustDelay` / `shouldSkipAnimation` 五个方法（均 0 调用方）与 FPS 私有状态；`maxConcurrentTweens` / `particleLimit` / `enableShadows` / `targetFPS` 四个字段 0 处读取。**保留**实际在用的 `getConfig()` 与 `adjustDuration()`（机型分级仍生效） | 已完成 |
| A7 | `GameScreen` 热路径去掉 `getChildByName` 字符串查找 | 把 `card` / `item` / `blockedOverlay` / `targetOverlay` 四个子节点引用在 `makeTile` 时缓存到 `Tile` 上，`refreshBoardTileStates` / `resizeTrayTile` / `resizeBoardTile` / `setTileKind` 改为直接取用。这些子节点创建后从不增删，引用恒定 | 已完成 |
| A8 | `GameScreen` 遮挡判定复用几何体对象 | `tileGeometry()` 原本每次调用新建对象（每次点击约 2.8 万个临时对象）。牌创建后 `width` / `height` / `boardPosition` / `boardAngle` 只读不写，故在创建时算好缓存在 `tile.geometry`。`overlapsGeometry` → `coverGeometry` 是纯函数、不修改入参 | 已完成 |

| A9 | 删除**整条手套菜单链**（`buildGloveMenu` / `buildGloveActionButton` / `enterGloveMode` / `selectGloveTile` / `clearGloveSelection` / `closeGloveMenu`，约 125 行） | `activeTool` 只可能被赋值为 `null` 或 `'hammer'`；唯一写手套状态的方法 `enterGloveMode` 只被 `buildGloveMenu` 调用，而后者全工程无调用方。当前手套已改成「直接撤回最后放入卡槽的牌」（`useGlove()` 内有注释说明是刻意简化），菜单版是旧设计遗留。**不可达代码按定义不可能影响行为** | 已完成 |
| A10 | 删除手套相关分支与状态：`onTileTap` / `onTrayTileTap` 里的 `glove_menu`/`glove_swap`/`glove_return` 分支、`refreshToolButtons` 里的手套高亮判断、`clearToolMode` 里的手套清理、`gloveMenuNode` / `gloveSelectedTile` 两个字段、`ActiveTool` 的两个手套枚举值 | 这些分支的进入条件永不为真（同上）。手套道具按钮 → `useGlove()` → `returnTrayTile()` 这条真实链路完整保留 | 已完成 |
| A11 | 删除 3 个零调用私有方法：`AdventureScreen.nearestThemeAnchor()`、`GameScreen.wrapCatSkillDescription()`、`GameScreen.activeBoardCount()` | 全工程仅出现 1 次（即定义处）。注意 `themeAnchor` / `THEME_COUNT` 另有调用方，已保留 | 已完成 |
| A12 | 删除 6 个零使用字段：`GameScreen.traySettleDuration` / `traySettleReturnDuration`、`HomeScreen.activityLastSeenEventId` / `activityLastSeenPoints` / `homeChapterCollectedLabel`、`LoadingOverlay.destroyed` | 声明后从未被读取。其中 `homeChapterCollectedLabel` 只在两处被赋 `null`、从未指向真实 Label；`LoadingOverlay.destroyed` 只在 `destroy()` 里被写 `true`，是作者原本想加的异步回调守卫但从未读取 | 已完成 |

### A 组的验证结果

| 验证 | 方法 | 结果 |
| 类型检查 | 引擎自带 tsc 跑 `tsconfig.check.json`（`strict: true` + 编辑器声明集），与改动前逐条比对 | **14 条 → 9 条，新增 0 条**；修掉的 5 条正是 A2 的坏引用与 A4 的 TweenManager 泛型问题 |
| 关卡系统回归 | 按 README 跑 `scripts/validate-level-system.ts` | 1000 seed 全部生成、1000 个唯一、`solvable: true`、`symmetric: true`、`rescueRecovery: true`、`roleSchedule: true`，退出码 0 |
| 遮挡判定等价性 | 用真实生成关卡（L3/12/25/47/80/100）对比新旧两种几何体取法的 `isTopTile` 结果 | **462 次校验，0 处不一致** |
| 残留引用扫描 | 全工程 grep `managedTween` / `TweenManager` / `ObjectPool` / `getChildByName` | 无残留（`getChildByName` 仅剩注释里的说明文字） |
| 死代码审计（第二轮） | 脚本扫描全工程私有方法的调用点、私有字段的读写次数 | 发现并清除 6 个不可达方法 + 1 条完整手套菜单链 + 6 个零使用字段；同时纠正 3 处误报——`GameScreen.formatEndlessDuration` / `RankScreen.formatDurationGap` / `SettlementPopup.setup` 实际都在用，未动 |
| 二次类型检查比对 | 去掉行列号后按内容比对（避免因删除行导致的位移误判） | **真正的"新增错误"为 0 条**；`LoadingOverlay` 那条只是行号从 156 移到 155 |

剩下的 9 条类型错误是**改动前就存在**的（`LoadingOverlay.ts` 1 条 + `Main.ts` 8 条，均为 `loadScreen` 传入 `XxxScreen \| null` 的严格模式告警），与本次改动无关，也未修复。

## 四、B 组：会影响功能或表现 —— 已按你的确认实施 B1 / B2+B3 / B5+B6

你确认推进的是 **B1（资源瘦身）、B2+B3（加载与内存）、B5+B6（关卡生成耗时）**；B4、B7、B8、B9 未动。

### B 组实施结果

| # | 优化 | 改了什么 | 实测结果 | 状态 |
|---|---|---|---|---|
| B1 | 6 张全屏背景降采样 | 按 750 设计宽度等比缩放（`sips --resampleWidth 750`，质量 92）；原图备份到 `/tmp/cat-world-bg-originals`。JPG→JPG 同扩展名，`.meta` 未改动、UUID 不变，代码路径无需改 | 解码纹理 **35.1 MB → 20.4 MB（-14.7 MB，-42%）**；源文件 2246 KB → 1843 KB；每像素字节数反而提升 1.4~1.6×，即只降分辨率、未降保真 | 已完成 |
| B2 | 二级页面改按需加载 | `preloadSecondaryScreens()` 不再创建+加载全部 9 个二级页面，只保留首页浮层预热与挑战关卡预生成；删除 `preloadScreenQueueNew` 队列。各 `openXxx()` 里原有的 LoadingOverlay + `loadScreen` 懒加载路径直接接管 | 启动后不再把整包资源常驻；未访问过的页面图片不再解码 | 已完成 |
| B3 | `AssetStore` 引用计数与释放 | 新增按 owner 的引用计数 + `loadImagesFor(owner, ...)` + `releaseOwner(owner)`；保留 `ImageAsset` 引用以便 `assetManager.releaseAsset` 真正回收 CPU 侧数据。Main 侧加 LRU（常驻上限 2 个二级页面），淘汰时释放图片 + 销毁 UI + 置空字段，下次进入重新加载重建 | 9 项引用计数行为测试全通过；**探针抓出一个会破坏游戏的 bug 并已修**（见下） | 已完成 |
| B5 | 超萌挑战备用关卡 | 当前挑战关卡交付后立刻在后台预生成一份备用（新种子，保持"每次进关换元素排布"的设计）；「再玩一次」与"回到首页再进挑战"直接换牌 | 「再玩一次」从等一次完整生成（108ms，低端机 0.5~1.8s）变为**即时换牌**；总计算量不变，只是移出关键路径 | 已完成 |
| B6 | 消除高关生成尖峰 | 难度分在 L70 后饱和在 54，而 `baseDifficulty` 爬到 65，导致高关永远进不了 ±6 验收带、只能烧满 24 次 attempt。新增 `difficultySaturation = 54` 给验收目标封顶，并把 `needsRisk` 的判定从 `target` 改为 `acceptTarget`（否则高关会跳过风险模拟、`estimatedFailureRate` 恒为 0 而被 30 的下限挡下） | 第 80 关 **86.5ms → 7.0ms（-92%）**、第 90 关 70.8 → 10.0、第 100 关 77.7 → 8.3；难度从 54.0 微降到 52~53；1000 seed 全量验收仍全部通过（可解/唯一/对称/救援/节拍表，breather `maxCombo=2` 达标、spike 37.5 张仍短于普通关 60.3） | 已完成 |

**B3 探针抓到的关键 bug（值得记录）**：`home/home_bg` 这类图既被 Main 无归属地常驻预加载，又出现在排行榜/商店/猫咪详情/每日任务的加载清单里。若只按 owner 集合判断，页面被淘汰时会把它一并销毁 —— **首页与游戏页的背景会变空白**。修法是在 `AssetStore` 里单独维护 `permanentPaths`（被无归属加载过的路径），`releaseOwner` 对它们永不销毁。探针里 `[常驻先]` / `[常驻后]` 两个用例专门覆盖这个场景。

### 未实施的 B 组项

| # | 优化 | 会改变什么 | 成本 | 收益 |
|---|---|---|---|---|
| B4 | `PerformanceManager` 接线 FPS 自动降级 | 低端机动画会变慢/跳帧（这正是降级的目的，但玩家能感知） | S–M | ★2 |
| B7 | 每张牌的两个 Graphics 合并 | 遮挡蒙版与锤子选中框是 Graphics 现画的，合并后圆角/描边可能细微变化；且合并后必须改成"状态变化才重绘"，否则每次点击会重建约 90 个 Graphics 网格，反而更慢 | M | ★3（需先量真机 draw call 再决定是否值得） |
| B8 | 遮挡判定改增量更新（维护遮挡计数） | 判定结果可能变。增量漏算会出现"该能点的点不了" | L | ★2 |
| B9 | `Toast` 接对象池复用节点 | 节点不再销毁重建，需完整重置 `opacity` / `scale` / Graphics 内容 / 文案，做漏会串状态 | S | ★1 |

### B 组仍需你在真机上确认的两件事

1. **B1 的画面**：750 宽纹理在大屏机上是 1.44× 上采样（原本 941 宽是 1.15×），`MomentScreen` 因用 cover 放大到约 1083 设计宽、上采样更明显。请在编辑器/真机上过一眼首页、游戏页、瞬间相册三处背景。
2. **B3 的内存**：释放效果无法在本机 Node 环境验证（需要真机 `wx.getPerformance()`）。建议在低端机上看"反复切页 20 次后的内存水位"是否稳定不涨。另外 B5 的备用关卡是在后台分片生成的（每次 attempt 之间 `setTimeout` 让帧），如果真机上在挑战关内感到掉帧，把 `prepareChallengeSpare()` 的条件加上 `this.gameScreen?.hasStartedPlay()` 即可改为只在非对局时生成（代价是第二次起的"再玩一次"会退回等待）。


## 五、实测确认"不用改"的项

以下都曾被怀疑，实测后确认无害。记录在此避免以后重复排查。

| 项 | 实测结果 | 结论 |
|---|---|---|
| 存档写入频率 | 每次三消 `addCoins(6)` → `setCoins` → `save()` 全量序列化；实测 **0.0056 ms/次**，一关 25 次合计 0.14 ms | 不改。Node 垫片的 `setItem` 是内存 Map，微信真实桥接会慢（约 1–3 ms/次），但一次三消才写一次（间隔 1–2 s），不构成掉帧 |
| 无尽补波生成 | `EndlessDirector` 走 `createWaveTiles`，**不跑求解器**；实测 0.48–3.33 ms | 不改。仅开局 90 张那一波约 3.3 ms，且发生在入场动画期间 |
| 首页其余 8 个 `repeatForever` | 目标都是 Node，引擎在父节点 `setActive(false)` 时递归到子节点逐个触发 `ACTIVE_CHANGED` 并 `pauseTarget` | 不改。切到关卡时已被自动暂停 |
| `sortBoardTileNodes()` | 只在**新增节点**时调用（入场 / 补波 / 复活 / 手套放回），收集时不调用 | 不改。收集只移除节点，其余相对顺序不变，无需重排 |
| `ActivityScreen` 的 1 Hz ticker | `setActive(false)` 正确调用 `stopTicker()` | 不改 |
| 逐帧逻辑 | 全工程仅 3 个 Component，**无任何 `update()`**，纯事件驱动 | 不改，这是优点 |
| `GameScreen.destroy()` | `timers` Set + `tweenTargets` Set + 3 个 interval 全部清理，`gameUI.destroy()` | 不改，清理完整 |
| 启动关键路径 | 只加载首页 21 张图（最大 268 KB），游戏资源延 500 ms、音频延 800 ms 后台加载；`AssetStore` 有 pending 去重 | 不改，设计合理 |

## 六、不建议做（针对旧文档的建议逐条说明）

| 旧文档建议 | 为什么不划算 |
|---|---|
| 全量 Graphics 转精灵图缓存 | 只有 B7 的遮挡层值得评估；其余面板 Graphics 是静态绘制、仅在状态变化时重建，转纹理反而增加内存与资源管理复杂度 |
| LOD 系统 / 帧率锁 30 fps | 工程无逐帧逻辑，降帧对 CPU 几乎无收益，只会让动画变卡 |
| WebWorker 搬关卡计算 | `generateAsync` 已用 `setTimeout` 让帧且带墙钟预算，实测单次 attempt 仅数毫秒；引入 Worker 在微信小游戏里要处理独立包体与通信成本，收益不匹配 |
| 用 `for` 替代 `forEach` / 避免闭包 | 现代 V8 下差异在噪声级；真正值得改的是算法复杂度，不是遍历写法 |
| 统一管理所有 setTimeout | 现状已足够：`GameScreen` 用 `timers` Set 统一清理，`ActivityScreen` / `TownScreen` / `Toast` 各自清理，无泄漏 |

## 七、回滚方式

- 本次 A 组改动全部在 git 工作区内，未提交。逐文件回滚：`git checkout -- <文件>`；整体回滚：`git checkout -- assets/scripts/`。
- 被删除的两个文件已移入**系统回收站**（`ObjectPool.ts`、`TweenManager.ts` 及各自 `.meta`），可从回收站取回，或 `git checkout -- assets/scripts/ObjectPool.ts assets/scripts/TweenManager.ts`。
- 验证脚本产物在 `.codex/`（已被 `.gitignore` 忽略），可随时删除。
