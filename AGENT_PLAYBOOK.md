# 职场守护圈智能体玩法规范

本文档给外部 AI 智能体使用。智能体可以通过 WebSocket 像真人玩家一样完整游玩、测试并汇报结果。

## 1. 连接

游戏服务启动后，WebSocket 地址与页面同源：

- 本机：`ws://localhost:5252`
- 局域网：把页面地址 `http://<host>:5252` 改成 `ws://<host>:5252`

连接后服务器会先发送 `hello`，随后持续广播 `state`。

智能体必须保存最新 `hello` 配置和最新 `state`，所有决策都基于最新状态。

## 2. 服务器消息

### 2.1 hello

示例结构：

```json
{
  "type": "hello",
  "protocolVersion": 1,
  "clientId": 1,
  "towerTypes": {},
  "synthesisRules": {},
  "difficultyOptions": {},
  "playerRoles": {},
  "buildAreas": {},
  "pathRoutes": {},
  "mainPathCells": [],
  "gridSize": 38,
  "cols": 30,
  "rows": 20,
  "totalWaves": null
}
```

说明：

- `clientId`：当前连接 ID。
- `towerTypes`：全部职场塔配置，key 用于 `build.towerType`。
- `synthesisRules`：终极塔合成规则。
- `difficultyOptions`：可选难度。
- `playerRoles`：1-8 号位说明。
- `buildAreas`：每个位置允许建造的格子矩形。
- `pathRoutes` / `mainPathCells`：任务压力行走路径，建造时必须避开。
- `cols` / `rows`：地图网格宽高。

### 2.2 state

关键字段：

```json
{
  "type": "state",
  "protocolVersion": 1,
  "clientId": 1,
  "phase": "lobby",
  "hostSlot": 1,
  "wave": 0,
  "spawning": false,
  "spawnCount": 0,
  "waveConfig": null,
  "nextWaveConfig": {},
  "difficulty": "novice",
  "difficultyName": "新人摸鱼",
  "sharedBuild": false,
  "autoWaveTimer": 0,
  "speed": 1,
  "players": {},
  "towers": [],
  "towerCounts": {},
  "enemies": [],
  "projectiles": [],
  "effects": [],
  "logs": []
}
```

字段含义：

- `phase`: `lobby | playing | ended`。
- `hostSlot`: 当前房主位置。
- `wave`: 当前任务轮次。
- `spawning`: 当前是否正在生成压力单位。
- `spawnCount`: 当前轮已生成批次数。
- `nextWaveConfig`: 下一轮压力配置。
- `difficulty`: `novice | normal | hard`。
- `sharedBuild`: 是否共享建造空间。
- `autoWaveTimer`: 下一轮自动任务倒计时秒数。
- `players`: 玩家状态，包含 `lives`、`gold`、`ready`、`connected`、`populationLimit`。
- `towers`: 已部署职场塔。每座塔使用 `ownerSlot` 表示归属玩家，不提供 `owner` 字段。
- `enemies`: 场上工作压力单位。
- `logs`: 战斗日志与聊天日志。

## 3. 客户端动作消息

所有消息都是 JSON 字符串。

### 3.1 加入位置

```json
{ "type": "join", "name": "AI-1", "slot": 1 }
```

- `slot`: 1-8。
- 只能在 `phase === "lobby"` 时加入。
- 如果位置已被在线玩家占用，服务器会拒绝。

### 3.2 设置大厅规则

```json
{ "type": "lobbyOptions", "difficulty": "novice", "sharedBuild": true }
```

- 只有房主可设置。
- 只能在大厅阶段设置。
- `difficulty`: `novice | normal | hard`。
- `sharedBuild`: 是否允许所有玩家在全部建造区域部署。

### 3.3 准备

```json
{ "type": "ready", "ready": true }
```

所有在线玩家准备后才能开始。

### 3.4 开始自动任务

```json
{ "type": "startWave" }
```

进入 `playing` 后，后续任务轮次会自动推进，不需要每轮手动发送。

### 3.5 部署职场塔

```json
{ "type": "build", "towerType": "arrow", "gridX": 3, "gridY": 1 }
```

约束：

- `towerType` 必须是 `hello.towerTypes` 中存在且不是 `synthOnly` 的 key。
- 非共享建造：只能在 `buildAreas[slot]` 内部署。
- 共享建造：可在任意 `buildAreas` 内部署。
- 不能部署在 `mainPathCells` 上。
- 不能部署在已有塔格子上；服务器会再次校验并拒绝重复格子。
- 玩家 `gold` 必须足够。
- 玩家塔数量不能超过 `populationLimit`。

### 3.6 强化职场塔

```json
{ "type": "upgrade", "towerId": 12 }
```

约束：

- 只能强化自己的塔。
- 最高 Lv.5。
- `gold` 必须足够。

客户端可用相同公式估算费用：

```js
Math.round(towerTypes[tower.typeKey].cost * (0.75 + tower.level * 0.58))
```

### 3.7 合成终极塔

```json
{ "type": "synthesize", "towerId": 12 }
```

约束：

- `towerId` 可以是任意材料塔 ID。
- 所有材料塔必须属于同一玩家且 Lv.5。
- 合成规则见 `hello.synthesisRules`。

### 3.8 撤下职场塔

```json
{ "type": "sell", "towerId": 12 }
```

只能撤下自己的塔，返还部分摸鱼时长。

### 3.9 调整速度

```json
{ "type": "speed", "speed": 10 }
```

可用速度：`1 | 2 | 3 | 5 | 10`。

只有房主可设置。

### 3.10 聊天 / 汇报

```json
{ "type": "chat", "text": "我准备补功能辅助塔" }
```

聊天会显示在 `logs`。

调试指令：

- `wd`: 所有当前职场塔属性大幅增加。
- `bf`: 当前玩家摸鱼时长 +9999。

测试报告必须说明是否使用过调试指令。

### 3.11 重置

```json
{ "type": "reset" }
```

房主可重置；游戏结束后也允许重置。

## 4. 克制关系

攻击类型：

- `physical`: 执行力
- `magic`: 沟通力
- `pierce`: 专业力
- `chaos`: 创造力

压力类型：

- `physical`: 流程型压力
- `magic`: 沟通型压力
- `resistance`: 抗压型压力
- `holy`: 权威型压力

克制：

- 执行力克制沟通型压力。
- 沟通力克制流程型压力。
- 专业力克制抗压型压力。
- 创造力克制权威型压力。

倍率：

- 克制：2 倍。
- 被克：0.3 倍。
- 普通：1 倍。

## 5. 推荐智能体主循环

伪代码：

```js
onHello(config):
  save config

onState(state):
  save latest state
  if not joined:
    send join
  else if isHost and phase == lobby:
    send lobbyOptions
  else if phase == lobby and not ready:
    send ready true
  else if phase == lobby and all players ready:
    send startWave
  else if phase == playing:
    maybeSynthesize()
    maybeUpgrade()
    maybeBuild()
    maybeChatReport()
  else if phase == ended:
    write report
```

建议不要每帧都发动作。每个智能体每 300-1000ms 决策一次即可。

## 6. 推荐建造策略

### 6.1 找建造点

1. 取可建造区域：
   - `state.sharedBuild === false`: 使用 `config.buildAreas[mySlot]`。
   - `state.sharedBuild === true`: 使用所有 `config.buildAreas`。
2. 枚举区域内格子。
3. 排除：
   - `config.mainPathCells`。
   - `state.towers` 已占用格子。
4. 优先选择靠近路径但不在路径上的格子。

### 6.2 选择塔

根据 `state.nextWaveConfig.armorType`：

- `magic` 沟通型压力：优先执行力塔，例如 `arrow`。
- `physical` 流程型压力：优先沟通力塔，例如 `frost`、`bootlicker`。
- `resistance` 抗压型压力：优先专业力塔，例如 `cannon`。
- `holy` 权威型压力：优先创造力塔，例如 `poison`、`pua_immune`。

基础策略：

- 前期优先部署输出塔。
- 有 3-5 座输出塔后补辅助塔。
- 人口接近上限后优先强化。
- 有合成材料时优先把材料升到 Lv.5。

### 6.3 强化优先级

1. 克制下一轮压力的塔。
2. 低等级核心输出塔。
3. 功能辅助塔。
4. 合成材料塔。

### 6.4 合成优先级

按 `synthesisRules` 判断材料是否齐全且 Lv.5。

推荐顺序：

1. `old_hand` / 职场老油条：提升全图输出。
2. `slacking_immortal` / 摸鱼仙人：全局增益。
3. `layflat_god` / 躺平大神：清理普通压力和压 Boss。

## 7. 推荐测试报告格式

外部智能体结束后建议输出：

```json
{
  "protocolVersion": 1,
  "agentName": "AI-1",
  "slot": 1,
  "difficulty": "novice",
  "sharedBuild": false,
  "usedCheats": false,
  "durationSeconds": 300,
  "finalPhase": "playing",
  "finalWave": 18,
  "livesBySlot": { "1": 20 },
  "towerCountBySlot": { "1": 12 },
  "towerTypesBuilt": { "arrow": 4, "cannon": 3 },
  "upgrades": 15,
  "syntheses": 1,
  "observedProblems": [
    "内圈建造空间不足",
    "normal 难度第 12 轮后金币明显不足"
  ],
  "recommendations": [
    "增加内圈 buildAreas",
    "降低第 10 轮后血量增长"
  ]
}
```

## 8. 最小可用 Node WebSocket 示例

```js
const WebSocket = require("ws");
const ws = new WebSocket("ws://localhost:5252");
let clientId;
let config;
let state;
let joined = false;
let ready = false;

function send(type, payload = {}) {
  ws.send(JSON.stringify({ type, ...payload }));
}

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === "hello") {
    clientId = msg.clientId;
    config = msg;
  }
  if (msg.type === "state") {
    state = msg;
    if (!joined && state.phase === "lobby") {
      send("join", { name: "AI-1", slot: 1 });
      joined = true;
      return;
    }
    const me = state.players[1];
    if (me && !ready && state.phase === "lobby") {
      send("ready", { ready: true });
      ready = true;
      return;
    }
    if (me && state.phase === "lobby") {
      send("startWave");
    }
  }
});
```
