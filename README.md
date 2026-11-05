# BOUNCE

**合集外壳 + 确定性解谜弹珠（第一季）+ 无尽躲避（第二季）。** 球是有限的，弹道是看得见的——把碎片时间变成你能掌控的几局。

## 在线玩
- GitHub Pages（主站）：https://roxwang.github.io/BOUNCE/
- 知识库 / 作品集：https://roxwang.github.io/BOUNCE/kb/
- 国内镜像（WorkBuddy 部署）：https://bounce.app.workbuddy.host/?sharecode=LHHWFJJIKO

## 更新线上版本（GitHub Pages）
改完代码 → `index.html` 里所有 `?v=`、`main.js` 的 SW 注册、`sw.js` 的 `CACHE` 常量**一起 +1**（否则浏览器拿旧缓存）
→ `git add -A && git commit -m "说明" && git push` → GitHub Pages 约 1 分钟自动重建，网址不变。
托管源：分支 `main` + 文件夹 `/(root)`。

## 本地运行
直接双击 `index.html` 即可（断网也能玩）；或起个静态服务：
```
python3 -m http.server 8080
```
然后浏览器打开 http://localhost:8080

## 安装成独立 App（观众视角）
用 Chrome / Edge 打开上面的游戏链接 → 地址栏点「安装」或菜单里「安装应用」
（手机是「添加到主屏幕」）。桌面上会多一个 BOUNCE 图标，无浏览器边框、离线也能玩——
这就是「下载实体 App」，但不用去应用商店。

## 合集架构（BOUNCE = 外壳，每个游戏独立）
- `index.html` 里有一个**合集首页 `screenHub`**：列出所有游戏卡片。
- 卡片由 `js/game.js` 的 **`B.Games` 注册表**驱动：
  ```js
  B.Games.add({ id, name, tag, icon, desc, enter: fn, shop: fn });
  ```
  **加新游戏 = 往这里加一条**，首页自动多出一张卡片；第一季 / 第二季互不耦合，谁也不依赖谁。
- 第一季（弹珠解谜）走 `B.Game.load(n)`；第二季（无尽躲避）走 `B.Game.startSeason2()`。
  旧的 "`load(>100)` 自动切第二季"耦合已拆除——每关打完回到合集首页，不再偷偷换玩法。

## 合集统一金库（金币）
- 所有游戏赚到的金币进**同一个钱包** `bounce.coins`（在 `js/util.js` 的 `B.U.coins/addCoins/spendCoins`）。
- 弹珠模式与第二季各自有**独立的永久强化商店**（玩法不同，升级项不同），但花的是同一个合集金币池。
- 旧账号的金币（`bounce.save.v1` 的 `coin`、旧的 `bounce.s2coin`）会在首次启动时自动并入 `bounce.coins`。

## 目录结构
- `js/`       游戏代码（board / physics / levelgen / season2 / music / game / ui ...）
- `tests/`    Node 测试（`bounce_test.js` / `portal_angle_test.js` / `s2_test.js`）+ 无头校验 `headless_check.js`
- `kb/`      知识库子站（作品集）
- `manifest.webmanifest` + `sw.js`   PWA 离线缓存 + 可安装

## 设计红线
- 第一季「预测 = 真实」：虚线就是真实弹道，物理必须确定性。
- 第二季无尽躲避：街机式刷分（程序化生成 + 技巧上限），不靠运气、不靠掷骰子。
- 任何改完代码 → 全部 `?v=` 戳 + `sw.js` 的 `CACHE` 常量一起 +1，否则浏览器用旧缓存。
