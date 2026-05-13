/**
 * 职场守护圈 — 客户端主逻辑
 * 
 * 功能概述：
 * - WebSocket 连接管理，接收服务端权威状态快照
 * - Canvas 2D 渲染：地图、塔、敌人、弹道、特效、HUD
 * - UI 交互：建塔、升级、合成、出售、技能释放
 * - 功能面板：理财/抽签/竞争等二级操作
 * - UX 增强：伤害飘字、Boss警报、路径箭头、策略提示等
 * 
 * 主要模块：
 * 1. DOM 引用 — 缓存所有 HTML 元素引用
 * 2. 游戏状态 — WebSocket、客户端ID、选中状态等
 * 3. 视觉反馈 — 伤害飘字、金币动画、通知条等
 * 4. 引导系统 — 首次进入的新手教程
 * 5. 美术资源 — 塔/敌人/瓦片图片加载
 * 6. 坐标转换 — 网格↔画布像素↔世界坐标
 * 7. WebSocket 通信 — 连接、消息收发
 * 8. UI 渲染 — 状态栏、玩家面板、日志、功能面板
 * 9. Canvas 绘制 — 地图、塔、敌人、弹道、特效
 * 10. 事件处理 — 鼠标/键盘/按钮交互
 * 11. UX 增强 v2.0 — 23项批次功能实现
 */

// ═══════════════════════════════════════════════════════════════
// 1. DOM 引用 — 缓存所有 HTML 元素，避免重复查询
// ═══════════════════════════════════════════════════════════════

// Browser client for the LAN tower-defense game.
// It renders server snapshots, sends player commands, and draws the map from authoritative state.
const canvas = document.querySelector("#gameCanvas");
const ctx = canvas.getContext("2d");

// Cached DOM references keep render functions simple and make ID changes easy to audit.
const joinPanel = document.querySelector("#joinPanel");
const nameInput = document.querySelector("#nameInput");
const slotSelect = document.querySelector("#slotSelect");
const joinBtn = document.querySelector("#joinBtn");
const connectionText = document.querySelector("#connectionText");
const actionBtn = document.querySelector("#actionBtn");
const speedBtn = document.querySelector("#speedBtn");
const resetBtn = document.querySelector("#resetBtn");
const phaseText = document.querySelector("#phaseText");
const waveText = document.querySelector("#waveText");
const nextWaveText = document.querySelector("#nextWaveText");
const enemyText = document.querySelector("#enemyText");
const playersPanel = document.querySelector("#playersPanel");
const towerButtons = document.querySelector("#towerButtons");
const buildHint = document.querySelector("#buildHint");
const selectionPanel = document.querySelector("#selectionPanel");
const upgradeBtn = document.querySelector("#upgradeBtn");
const sellBtn = document.querySelector("#sellBtn");
const synthesizeBtn = document.querySelector("#synthesizeBtn");
const useSkillBtn = document.querySelector("#useSkillBtn");
const environmentPanel = document.querySelector("#environmentPanel");
const synergyPanel = document.querySelector("#synergyPanel");
const openInvestmentBtn = document.querySelector("#openInvestmentBtn");
const openGachaBtn = document.querySelector("#openGachaBtn");
const openPressureBtn = document.querySelector("#openPressureBtn");
const investmentSummary = document.querySelector("#investmentSummary");
const gachaSummary = document.querySelector("#gachaSummary");
const pressureSummary = document.querySelector("#pressureSummary");
const featureModal = document.querySelector("#featureModal");
const featureModalTitle = document.querySelector("#featureModalTitle");
const featureModalBody = document.querySelector("#featureModalBody");
const featureModalClose = document.querySelector("#featureModalClose");
const logList = document.querySelector("#logList");
const myStatusBar = document.querySelector("#myStatusBar");
const difficultySelect = document.querySelector("#difficultySelect");
const sharedBuildInput = document.querySelector("#sharedBuildInput");
const chatForm = document.querySelector("#chatForm");
const chatInput = document.querySelector("#chatInput");
const autoWaveText = null; // removed with status-card
const ruleText = null; // removed with status-card
const techText = null; // removed with tech-panel
const recommendText = null; // removed with guide-card

// ─── Phase 2/3 new DOM refs ───
// ─── 大厅/游戏视图DOM ───
const lobbyView = document.querySelector("#lobbyView");
const gameToolbar = document.querySelector("#gameToolbar");
const featureCenterToggle = document.querySelector("#featureCenterToggle");
const featureCenterBody = document.querySelector("#featureCenterBody");
// ─── 浮动操作栏DOM ───
const floatingActionBar = document.querySelector("#floatingActionBar");
const floatUpgradeBtn = document.querySelector("#floatUpgradeBtn");
const floatSellBtn = document.querySelector("#floatSellBtn");
const floatSkillBtn = document.querySelector("#floatSkillBtn");
let featureCenterExpanded = false;
// ─── 快速开始/分享链接DOM ───
const quickStartBtn = document.querySelector("#quickStartBtn");
const shareLink = document.querySelector("#shareLink");
const shareUrl = document.querySelector("#shareUrl");
const copyShareBtn = document.querySelector("#copyShareBtn");
// ─── Tooltip/引导/结算DOM ───
const towerTooltip = document.querySelector("#towerTooltip");
const guideOverlay = document.querySelector("#guideOverlay");
const guideContent = document.querySelector("#guideContent");
const guideNextBtn = document.querySelector("#guideNextBtn");
const guideSkipBtn = document.querySelector("#guideSkipBtn");
const endGameCard = document.querySelector("#endGameCard");
const endGameBody = document.querySelector("#endGameBody");
const endGameCloseBtn = document.querySelector("#endGameCloseBtn");

// Local UI-only state; game truth comes from the latest `state` snapshot.
// ═══════════════════════════════════════════════════════════════
// 2. 客户端本地状态 — 游戏真相来自服务端 state 快照
// ═══════════════════════════════════════════════════════════════

// ─── WebSocket 连接 & 身份 ───
let ws;                   // WebSocket 连接实例
let clientId = null;       // 服务端分配的客户端ID
let state = null;          // 最新服务端状态快照
let config = null;         // hello 消息中的静态配置（塔类型、地图参数等）
let mySlot = null;         // 自己的玩家槽位（1-8）

// ─── 建塔/选择状态 ───
let selectedTowerType = "arrow";  // 当前选中的待建塔类型
let selectedTowerId = null;       // 当前选中的已建塔ID（用于升级/出售）
let mouse = null;                 // 鼠标在画布上的世界坐标
let towerTab = "basic";           // 建塔面板当前分类Tab
let expandedCategory = null;      // 展开的分类（旧版折叠模式）

// ─── 波次选择状态 ───
let waveChoiceTimerInterval = null;   // 波次选择倒计时定时器
let waveChoiceDeadlineAbs = null;     // 波次选择绝对截止时间戳
let latestGachaResult = null;         // 最近一次抽签结果
let activeFeaturePanel = null;        // 当前打开的功能面板（investment/gacha/pressure）
const clientLogs = [];                // 客户端本地战斗日志（补充服务端日志）
let prevWeatherName = null;           // 上一帧天气名称（用于检测天气变化）

// ═══════════════════════════════════════════════════════════════
// 3. 视觉反馈状态 — 伤害飘字、Boss警报、通知条等
// ═══════════════════════════════════════════════════════════════

// ─── 前端增强 v1.0: 视觉反馈状态 ───
const enemyHpMap = new Map(); // enemy.id -> lastHp, 用于检测受伤并生成飘字
let bossAlertActive = false;  // Boss 来袭全屏警报是否激活
let bossAlertTimer = 0;       // Boss 警报剩余显示时间（秒）
let prevLives = null;         // 上一帧总生命数（用于检测漏怪）
let screenFlashTimer = 0;     // 漏怪屏幕闪红剩余时间
const damageTexts = [];       // 伤害飘字数组 {x, y, text, color, alpha, vy, life}
const killGoldTexts = [];     // 击杀金币飘字数组 {x, y, text, alpha, vy, life}
const notifications = [];     // 顶部通知条数组 {text, icon, alpha, life, key}
const synergyToasts = [];     // 羁绊激活提示数组 {text, alpha, life}
const activeSynergyKeys = new Set(); // 已激活的羁绊key集合（去重）
let prevAutoWaveTimer = null; // 上一帧自动波次计时器值
let waveCountdownFlash = false; // 波次倒计时闪烁标记
const prevFactionCounts = {};   // 上一帧阵营计数
const prevEnemyIds = new Set(); // 上一帧敌人ID集合（用于检测击杀）
const enemyLastPos = new Map(); // enemy.id -> {x, y} 最后已知位置

// ─── 快捷键映射 & 护甲显示常量 ───
const HOTKEY_MAP = { arrow: 'Q', cannon: 'W', poison: 'E', aura_speed: 'A', frost: 'S', aura_damage: 'D', daily_report: 'F', reflect: 'Z', pua_immune: 'X', bootlicker: 'C' };
const ARMOR_ICON = { physical: '📋', magic: '💬', resistance: '💪', holy: '👔' };
const ARMOR_CN = { physical: '流程', magic: '沟通', resistance: '抗压', holy: '权威' };

// ─── 金币变动动画状态 ───
let prevGold = null;       // 上一帧金币数（用于检测变动）
let goldAnimTimer = 0;     // 金币动画剩余时间（ms）
let goldAnimDir = 0;       // 1=增加闪烁, -1=减少闪烁

// ─── 特殊波次通知条状态 ───
let prevSpecialWaveDesc = null;         // 上一帧特殊波次描述
const specialWaveNotifications = [];    // 特殊波次通知数组 {text, alpha, life}

// ═══════════════════════════════════════════════════════════════
// 4. 引导系统状态 — 首次进入的新手教程
// ═══════════════════════════════════════════════════════════════

let guideStep = 0;
/**
 * 引导步骤配置：3步教程
 * - 第1步：欢迎 + 游戏目标说明
 * - 第2步：建塔操作说明
 * - 第3步：准备开始说明
 */
const guideSteps = [
  { icon: '🗺️', title: '欢迎来到职场守护圈！', desc: '你的任务是守住自己的岗位区域，部署各种职场塔来抵御工作压力。每位玩家有自己的领地，不能越界建塔。' },
  { icon: '🏗️', title: '建造职场塔', desc: '选择右侧的职场塔按钮（或按 Q/W/E 等快捷键），然后点击你的区域内的空地来建塔。不同塔有不同的攻击方式和克制关系。' },
  { icon: '✅', title: '准备开始！', desc: '当你准备好了，点击「我准备好了」按钮。所有玩家准备完毕后，游戏自动开始。祝你好运！' }
];

// ─── 游戏内引导触发状态 ───
let firstTowerGuideShown = false;      // 首次金币够建塔时的提示
let firstBossGuideShown = false;       // 首次Boss出现时的提示
let firstWaveChoiceGuideShown = false; // 首次波次选择时的提示

// ─── 策略辅助状态 ───
let strategyHintText = '';  // 当前策略提示文本
let prevPhase = null;       // 上一帧游戏阶段（用于检测阶段变化）

// ═══════════════════════════════════════════════════════════════
// 5. 美术资源加载 — 塔/敌人/瓦片图片
// ═══════════════════════════════════════════════════════════════
const towerImages = {};  // 塔图标缓存 {typeKey -> Image}
const enemyImages = {};  // 敌人图片缓存 {enemyType -> Image}
const tileImages = {};   // 地图瓦片缓存 {tileType -> Image}
const uiImages = {};     // UI元素图片缓存
const ASSET_BASE = 'assets/';

/**
 * loadImage — 创建 Image 对象并开始异步加载
 * @param {string} src - 图片相对路径
 * @returns {HTMLImageElement} 加载中的 Image 对象
 */
function loadImage(src) {
  const img = new Image();
  img.src = src;
  return img;
}

// 塔图标
const towerKeys = ['arrow','cannon','poison','aura_speed','frost','aura_damage','daily_report','reflect','pua_immune','bootlicker','old_hand','slacking_immortal','layflat_god'];
towerKeys.forEach(k => { towerImages[k] = loadImage(`${ASSET_BASE}towers/${k}.png`); });

// 敌人
const enemyKeys = ['enemy_normal','enemy_fast','enemy_heavy','enemy_boss','enemy_airdrop','enemy_invisible','enemy_split'];
enemyKeys.forEach(k => { enemyImages[k] = loadImage(`${ASSET_BASE}enemies/${k}.png`); });
// Boss 特殊形象
enemyImages['boss_kpi'] = loadImage(`${ASSET_BASE}enemies/boss_kpi.png`);

// 地图瓦片
const tileKeys = ['tile_grass','tile_path','tile_water','tile_wall','tile_entrance','tile_center'];
tileKeys.forEach(k => { tileImages[k] = loadImage(`${ASSET_BASE}tiles/${k}.png`); });

// UI 元素
uiImages['logo'] = loadImage(`${ASSET_BASE}ui/logo.png`);

// 敌人类型→图片映射
/**
 * getEnemyImage — 根据敌人属性选择对应的图片资源
 * 优先级：Boss特殊形象 > 隐身 > 分裂 > 快速 > 重型 > 空降 > 普通
 * @param {Object} enemy - 敌人对象
 * @returns {HTMLImageElement} 敌人图片
 */
function getEnemyImage(enemy) {
  // Boss 特殊处理
  if (enemy.name === '年终 KPI' || enemy.isBoss) return enemyImages['boss_kpi'];
  // 根据敌人属性推断类型
  if (enemy.invisible || enemy.semiInvisible) return enemyImages['enemy_invisible'];
  if (enemy.splitCount > 0 || (enemy.name && enemy.name.includes('内卷'))) return enemyImages['enemy_split'];
  if (enemy.speed > 2) return enemyImages['enemy_fast'];
  if (enemy.maxHp > 500) return enemyImages['enemy_heavy'];
  if (enemy.name && (enemy.name.includes('空降') || enemy.name.includes('突击'))) return enemyImages['enemy_airdrop'];
  return enemyImages['enemy_normal'];
}

connect();
resizeCanvas();
requestAnimationFrame(drawLoop);

// ═══════════════════════════════════════════════════════════════
// 6. 坐标转换 — 网格坐标 ↔ 画布像素 ↔ 世界坐标
// ═══════════════════════════════════════════════════════════════
// Canvas 使用 CSS 像素处理指针输入，使用设备像素绘制，所有转换通过辅助函数完成。

/** resizeCanvas — 根据容器尺寸和设备像素比调整画布分辨率 */
function resizeCanvas() {
  if (!config) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
}
window.addEventListener("resize", () => { resizeCanvas(); });

function mapWidth() {
  return canvas.width;
}

function mapHeight() {
  return canvas.height;
}

function gridToMapX(x) {
  return (x / config.cols) * mapWidth();
}

function gridToMapY(y) {
  return (y / config.rows) * mapHeight();
}

function mapToGridX(x) {
  return Math.floor((x / mapWidth()) * config.cols);
}

function mapToGridY(y) {
  return Math.floor((y / mapHeight()) * config.rows);
}

function worldPoint(item) {
  return {
    x: gridToMapX(item.x / config.gridSize),
    y: gridToMapY(item.y / config.gridSize),
  };
}

function worldRadius(radius) {
  return radius * ((mapWidth() / (config.cols * config.gridSize) + mapHeight() / (config.rows * config.gridSize)) / 2);
}


/**
 * connect — 建立 WebSocket 连接并注册消息处理器
 * 消息类型：
 * - hello: 接收静态配置（塔类型、地图参数、玩家角色等）
 * - state: 接收游戏状态快照（每帧更新）
 * - error: 服务端错误提示
 * - gachaResult: 抽签结果
 */
function connect() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${protocol}://${location.host}`);
  ws.addEventListener("open", () => {
    connectionText.textContent = "已连接，输入昵称并选择位置。";
  });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "hello") {
      clientId = message.clientId;
      config = message;
      resizeCanvas();
      renderTowerButtons();
    }
    if (message.type === "state") {
      state = message;
      mySlot = findMySlot();
      updateUi();
    }
    if (message.type === "error") {
      connectionText.textContent = message.message;
    }
    if (message.type === "gachaResult") {
      console.log("[gacha] Result received:", message);
      latestGachaResult = message;
      renderFeatureModal();
    }
  });
  ws.addEventListener("close", () => {
    connectionText.textContent = "连接已断开，请刷新页面重连。";
  });
}

/**
 * send — 向服务端发送 WebSocket 消息
 * @param {string} type - 消息类型（join/build/upgrade/sell/ready 等）
 * @param {Object} payload - 消息附加数据
 */
function send(type, payload = {}) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...payload }));
}

/**
 * findMySlot — 从 state.players 中查找自己的槽位号
 * 遍历所有玩家，匹配 clientId 确认自己是几号位
 * @returns {number|null} 槽位号（1-8）或 null
 */
function findMySlot() {
  if (!state?.players) return null;
  const entry = Object.entries(state.players).find(([, player]) => player.clientId === clientId);
  return entry ? Number(entry[0]) : null;
}

/**
 * updateUi — 核心 UI 刷新函数
 * 从最新服务端快照更新所有可见 UI，避免在 DOM 中存储重复游戏状态
 * 处理内容：大厅/游戏视图切换、按钮状态、Boss警报、漏怪检测、
 * 事件通知、天气变化、羁绊提示、击杀金币飘字、波次倒计时等
 */
function updateUi() {
  if (!state || !config) return;
  const myPlayer = mySlot ? state.players[mySlot] : null;
  const canJoin = state.phase === "lobby";
  // Lobby / Game view toggle
  if (lobbyView) lobbyView.style.display = myPlayer ? "none" : "";
  if (gameToolbar) gameToolbar.style.display = myPlayer ? "" : "none";
  joinPanel.classList.toggle("hidden", Boolean(myPlayer));
  joinBtn.disabled = !canJoin;
  slotSelect.disabled = !canJoin;
  nameInput.disabled = !canJoin;
  if (!myPlayer && !canJoin) connectionText.textContent = "游戏已经开始，你现在是观战模式。";
  const isHost = mySlot === state.hostSlot;
  difficultySelect.disabled = !isHost || state.phase !== "lobby";
  sharedBuildInput.disabled = !isHost || state.phase !== "lobby";
  difficultySelect.value = state.difficulty;
  sharedBuildInput.checked = state.sharedBuild;
  // Tower count for tech panel (no longer displayed in sidebar, but kept for logic)
  const towerCount = myPlayer ? state.towers.filter((tower) => tower.ownerSlot === mySlot).length : 0;
  // Action button state machine: merge ready + startWave
  if (actionBtn) {
    if (!myPlayer) {
      actionBtn.disabled = true;
      actionBtn.textContent = "请先加入";
    } else if (state.phase !== "lobby") {
      actionBtn.disabled = true;
      actionBtn.textContent = "任务进行中";
    } else if (!myPlayer.ready) {
      actionBtn.disabled = false;
      actionBtn.textContent = "我准备好了";
    } else if (!allReady()) {
      actionBtn.disabled = false;
      actionBtn.textContent = "取消准备";
    } else {
      actionBtn.disabled = false;
      actionBtn.textContent = "全员就绪，开始！";
    }
  }
  speedBtn.disabled = !isHost;
  speedBtn.textContent = `${state.speed}x 速度`;
  const canReset = isHost || state.phase === "ended";
  resetBtn.disabled = !canReset;

  // ─── 前端增强 hooks ───
  // Boss 警报检测
  if (state.enemies.some(e => e.name === '年终 KPI' || e.isBoss)) {
    if (!bossAlertActive) { bossAlertActive = true; bossAlertTimer = 4; }
  } else {
    bossAlertActive = false;
  }
  // 漏怪闪红检测
  const totalLives = Object.values(state.players).reduce((s, p) => s + (p.lives || 0), 0);
  if (prevLives !== null && totalLives < prevLives) { screenFlashTimer = 0.6; }
  prevLives = totalLives;
  // 波次倒计时
  if (state.autoWaveTimer !== undefined) {
    if (prevAutoWaveTimer !== null && state.autoWaveTimer > prevAutoWaveTimer) { waveCountdownFlash = false; }
    if (state.autoWaveTimer <= 5 && state.autoWaveTimer > 0) waveCountdownFlash = true;
    prevAutoWaveTimer = state.autoWaveTimer;
  }
  // 事件通知条
  if (state.activeEvents) {
    state.activeEvents.forEach(ev => {
      const key = `ev_${ev.name}`;
      if (!notifications.find(n => n.key === key)) {
        // Bug #8: Show effects in notification
        let effectText = '';
        if (ev.effects) {
          const effectParts = Object.entries(ev.effects).map(([k, v]) => {
            const effectNames = { enemySpeed: '敌人移速', enemyHp: '敌人血量', towerDamage: '塔伤害', towerRange: '塔范围', goldBonus: '金币加成', enemyCount: '敌人数量', enemySpeedMult: '敌人移速', slowBonus: '减速加成', towerSpeedMult: '塔攻速', frostBonus: '冰冻加成', towerRangeMult: '塔射程', lightningChance: '雷击概率', damageBonus: '伤害加成', towerAllMult: '全属性' };
            const label = effectNames[k] || k;
            let valStr;
            if (typeof v === 'number') {
              if (v > 0 && v < 5) valStr = `${Math.round((v - 1) * 100)}%`;
              else valStr = v > 0 ? `+${v}` : `${v}`;
            } else { valStr = String(v); }
            return `${label}${valStr}`;
          });
          effectText = effectParts.length ? `：${effectParts.join('，')}` : '';
        }
        const waveText = ev.wavesLeft ? `，持续${ev.wavesLeft}波` : '';
        notifications.push({ text: `${ev.desc || ev.name}${effectText}${waveText}`, icon: ev.icon || '📢', alpha: 1, life: 5, key });
        // 同步写入客户端战斗日志
        clientLogs.push({ time: Date.now(), message: `${ev.icon || '📢'} ${ev.desc || ev.name}${effectText}${waveText}`, kind: 'event' });
      }
    });
  }
  // 天气变化通知
  if (state.weather && state.weather.name !== prevWeatherName) {
    if (prevWeatherName !== null) {
      const _effNameMap = {
        enemySpeedMult: '敌人移速', slowBonus: '减速加成', towerSpeedMult: '塔攻速',
        frostBonus: '冰冻加成', towerRangeMult: '塔射程', lightningChance: '雷击概率',
        damageBonus: '伤害加成', towerAllMult: '全属性',
        enemySpeed: '敌人移速', enemyHp: '敌人血量', towerDamage: '塔伤害',
        towerRange: '塔范围', goldBonus: '金币加成', enemyCount: '敌人数量',
      };
      function _fmtEff(v) {
        if (typeof v === 'number') {
          if (v > 0 && v < 10) return `${Math.round((v - 1) * 100)}%`;
          if (v >= 10) return `+${v}`;
          return `${Math.round((v - 1) * 100)}%`;
        }
        return String(v);
      }
      const weatherEffects = Object.entries(state.weather.effects || {}).map(([k, v]) => `${_effNameMap[k] || k} ${_fmtEff(v)}`).join('，') || '无额外影响';
      notifications.push({ text: `天气变化：${state.weather.name}（${weatherEffects}）`, icon: '🌤️', alpha: 1, life: 4, key: 'weather_change' });
      clientLogs.push({ time: Date.now(), message: `🌤️ 天气变化：${state.weather.name}（${weatherEffects}）`, kind: 'event' });
    }
    prevWeatherName = state.weather.name;
  }
  // 羁绊激活提示
  const currentSynergies = state.activeSynergies || [];
  currentSynergies.forEach(syn => {
    const key = syn.name;
    if (!activeSynergyKeys.has(key)) {
      activeSynergyKeys.add(key);
      synergyToasts.push({ text: `🔗 ${syn.name} 已激活！`, alpha: 1, life: 2.5 });
    }
  });
  // 击杀金币飘字检测
  const currentEnemyIds = new Set(state.enemies.map(e => e.id));
  state.enemies.forEach(e => {
    const pos = worldPoint(e);
    enemyLastPos.set(e.id, { x: pos.x, y: pos.y });
  });
  prevEnemyIds.forEach(id => {
    if (!currentEnemyIds.has(id)) {
      const pos = enemyLastPos.get(id);
      if (pos) {
        const goldReward = 15; // 默认击杀奖励
        spawnKillGoldText(pos.x, pos.y, goldReward);
      }
      enemyLastPos.delete(id);
    }
  });
  prevEnemyIds.clear();
  currentEnemyIds.forEach(id => prevEnemyIds.add(id));

  renderMyStatusBar();
  renderPlayers();
  renderFeatureSummaries();
  renderFeatureModal();
  renderLogs();
  renderEnvironmentPanel();
  if (window.updateSelectionPanel) window.updateSelectionPanel();
  if (window.updateWaveChoice) window.updateWaveChoice();
  updateWavePreview();
}

/**
 * allReady — 检查所有在线玩家是否都已准备
 * @returns {boolean} 全员准备完成返回 true
 */
function allReady() {
  const players = Object.values(state.players).filter((player) => player.connected);
  return players.length > 0 && players.every((player) => player.ready);
}

/**
 * getRecommendationText — 根据下一波敌人护甲类型生成建塔推荐文本
 * 物理→推荐沟通力塔，魔法→推荐执行力塔，以此类推
 * @returns {string} 推荐提示文本
 */
function getRecommendationText() {
  const nextArmor = state.nextWaveConfig?.armorType;
  const names = { physical: "流程型压力", magic: "沟通型压力", resistance: "抗压型压力", holy: "权威型压力" };
  const recommend = { physical: "沟通力", magic: "执行力", resistance: "专业力", holy: "创造力" };
  if (!nextArmor) return "等待下一轮任务压力情报。";
  return `下一轮是${names[nextArmor]}，推荐部署${recommend[nextArmor]}职场塔。`;
}

/**
 * renderEnvironmentPanel — 渲染右侧面板的环境状态区域
 * 显示：时段（早晨/白天/黄昏/夜晚/深夜）、天气名称及效果、
 * 当前随机事件、波次修正、塔增益、验收锁定等
 */
function renderEnvironmentPanel() {
  if (!environmentPanel || !state) return;
  const timeNames = { dawn: "早晨", day: "白天", dusk: "黄昏", night: "夜晚", midnight: "深夜" };
  const weather = state.weather || { name: "晴天", effects: {} };
  // 英文 key → 中文显示名映射
  const effectNameMap = {
    enemySpeedMult: '敌人移速', slowBonus: '减速加成', towerSpeedMult: '塔攻速',
    frostBonus: '冰冻加成', towerRangeMult: '塔射程', lightningChance: '雷击概率',
    damageBonus: '伤害加成', towerAllMult: '全属性',
    enemySpeed: '敌人移速', enemyHp: '敌人血量', towerDamage: '塔伤害',
    towerRange: '塔范围', goldBonus: '金币加成', enemyCount: '敌人数量',
  };
  // 效果值格式化：数值 → 百分比显示
  function formatEffectValue(v) {
    if (typeof v === 'number') {
      if (v > 0 && v < 10) return `${Math.round((v - 1) * 100)}%`;
      if (v >= 10) return `+${v}`;
      return `${Math.round((v - 1) * 100)}%`;
    }
    return String(v);
  }
  const effects = Object.entries(weather.effects || {}).map(([key, value]) => {
    const label = effectNameMap[key] || key;
    return `${label} ${formatEffectValue(value)}`;
  }).join(" · ") || "无额外影响";
  const events = state.activeEvents || [];
  const modifiers = state.activeModifiers || [];
  const buffs = state.towerBuffs || [];
  environmentPanel.innerHTML = `
    <div class="mini-row"><span>时段</span><strong>${timeNames[state.timeOfDay] || state.timeOfDay || "-"}</strong></div>
    <div class="mini-row"><span>天气</span><strong>${weather.name || "-"}</strong></div>
    <div class="mini-note">${effects}</div>
    ${events.length ? events.map((event) => `<div class="mini-card"><strong>${event.icon || ""} ${event.name}</strong><span>${event.desc || ""} · ${event.wavesLeft}波</span></div>`).join("") : `<div class="mini-note">暂无随机事件</div>`}
    ${modifiers.length ? `<div class="mini-note">波次修正：${modifiers.length} 个生效中</div>` : ""}
    ${buffs.length ? `<div class="mini-note">塔增益：${buffs.length} 个生效中</div>` : ""}
    ${state.noSellWaves > 0 ? `<div class="mini-note warn">验收锁定：${state.noSellWaves}波不能撤塔</div>` : ""}
  `;
}

function renderSynergyPanel() {
  if (!synergyPanel || !state || !config) return;
  const counts = state.factionCounts || {};
  // Faction icon map: tech/admin/slacker/special
  const factionIconMap = { tech: '🔧', admin: '📋', slacker: '🐟', special: '⭐' };
  const factionNameMap = config.factionNames || { tech: '技术部', admin: '行政部门', slacker: '摸鱼部', special: '特殊部门' };
  // Get tower names by faction for tooltip
  const towerNamesByFaction = {};
  Object.entries(config.towerTypes || {}).forEach(([key, tower]) => {
    const f = tower.faction;
    if (!f) return;
    if (!towerNamesByFaction[f]) towerNamesByFaction[f] = [];
    towerNamesByFaction[f].push(tower.name || key);
  });
  // Build synergy rules
  const rules = [];
  Object.entries(factionNameMap).forEach(([faction, name]) => {
    [2, 4, 6].forEach((need, idx) => {
      const levelNames = ['初级', '中级', '高级'];
      const effects = { 2: '攻速+10%', 4: '攻击+20%', 6: '范围+15%' };
      rules.push({
        faction,
        name: `${name}·${levelNames[idx]}`,
        icon: factionIconMap[faction] || '',
        effect: effects[need],
        current: counts[faction] || 0,
        need,
        missing: Math.max(0, need - (counts[faction] || 0)),
        pool: towerNamesByFaction[faction] || [],
      });
    });
  });
  // Build icon grid HTML
  let html = '<div class="synergy-grid">';
  rules.forEach(rule => {
    const active = rule.missing <= 0;
    const borderColor = active ? 'rgba(125,255,113,.6)' : 'rgba(255,255,255,.15)';
    const bgColor = active ? 'rgba(125,255,113,.1)' : 'rgba(255,255,255,.03)';
    const tooltipText = `${rule.name}\n效果: ${rule.effect}\n需要: ${rule.need}座 ${rule.faction}塔\n已有: ${rule.current}/${rule.need}\n${active ? '✅ 已激活' : `还差 ${rule.missing} 座`}\n塔: ${rule.pool.join(', ') || '无'}`;
    html += `<div class="synergy-icon-item" title="${tooltipText}" style="display:flex;flex-direction:column;align-items:center;padding:6px 4px;border:1px solid ${borderColor};border-radius:8px;background:${bgColor};cursor:help;transition:all .2s;position:relative;">
      <span style="font-size:1.4rem;">${rule.icon}</span>
      <span style="font-size:.65rem;color:${active ? '#fff2b0' : '#cceabd'};text-align:center;line-height:1.2;margin-top:2px;">${rule.name.split('·')[1] || ''}</span>
      <span style="font-size:.7rem;color:${active ? '#73ff66' : '#ff9b6a'};font-weight:700;">${rule.current}/${rule.need}</span>
    </div>`;
  });
  html += '</div>';
  // Add CSS for hover tooltip effect
  synergyPanel.innerHTML = html;
}

function renderFeatureSummaries() {
  if (!state) return;
  const player = mySlot ? state.players[mySlot] : null;
  if (investmentSummary) {
    const count = player?.investments?.length || 0;
    investmentSummary.textContent = player ? `${count}项持仓 · 上波利息 ${player.lastInterest || 0}` : "加入后查看投资";
  }
  if (gachaSummary) {
    const pityEpic = mySlot ? (state.gachaPityEpic?.[mySlot] || 0) : 0;
    const pityLegendary = mySlot ? (state.gachaPityLegendary?.[mySlot] || 0) : 0;
    gachaSummary.textContent = mySlot ? `史诗 ${pityEpic}/10 · 传说 ${pityLegendary}/30` : "加入后抽签";
  }
  if (pressureSummary) {
    const shield = mySlot ? (state.pressureShields?.[mySlot] || 0) : 0;
    const pending = (state.pendingPressure || []).length;
    pressureSummary.textContent = mySlot ? `护盾 ${shield}波 · 待到达 ${pending}` : "加入后竞争";
  }
}

// Feature modal is a second-level page: summaries stay on the sidebar, operations render here live.
function openFeaturePanel(panelKey) {
  activeFeaturePanel = panelKey;
  renderFeatureModal();
}

function closeFeaturePanel() {
  activeFeaturePanel = null;
  if (featureModal) featureModal.style.display = "none";
  if (featureModalBody) featureModalBody.innerHTML = "";
}

function renderFeatureModal() {
  if (!featureModal || !featureModalTitle || !featureModalBody) return;
  if (!activeFeaturePanel) {
    featureModal.style.display = "none";
    return;
  }
  const titleMap = { investment: "摸鱼理财", gacha: "面试抽签", pressure: "职场竞争" };
  featureModalTitle.textContent = titleMap[activeFeaturePanel] || "功能";
  featureModal.style.display = "flex";
  if (activeFeaturePanel === "investment") renderInvestmentPanel(featureModalBody);
  if (activeFeaturePanel === "gacha") renderGachaPanel(featureModalBody);
  if (activeFeaturePanel === "pressure") renderPressurePanel(featureModalBody);
}

function renderInvestmentPanel(panel) {
  if (!panel || !state) return;
  const player = mySlot ? state.players[mySlot] : null;
  const products = state.investmentProducts || {};
  const holdings = player?.investments || [];
  const productButtons = Object.entries(products).map(([productId, product]) => {
    const activeBought = holdings.filter((item) => item.productId === productId).length;
    const limitReached = (product.maxBuy && product.maxBuy !== null && product.maxBuy !== Infinity && activeBought >= product.maxBuy) || (productId === "deposit" && player?.depositUsed);
    const disabled = !player || state.phase !== "playing" || player.gold < product.cost || limitReached;
    return `<button type="button" class="mini-action" data-invest="${productId}" ${disabled ? "disabled" : ""}><strong>${product.name}</strong><span>${product.cost} 摸鱼时长 · ${product.desc}</span></button>`;
  }).join("");
  const holdingRows = holdings.length ? holdings.map((item) => {
    const product = products[item.productId] || { name: item.productId };
    return `<div class="mini-card"><strong>${product.name}</strong><span>${item.wavesLeft}波后返还 ${item.returnGold ?? "?"} 摸鱼时长</span></div>`;
  }).join("") : `<div class="mini-note">暂无持仓，战斗中可购买理财。</div>`;
  panel.innerHTML = `${player ? `<div class="mini-row"><span>上波利息</span><strong>${player.lastInterest || 0}</strong></div>` : ""}${productButtons}${holdingRows}`;
  panel.querySelectorAll("[data-invest]").forEach((button) => {
    button.addEventListener("click", () => send("invest", { productId: button.dataset.invest }));
  });
}

function renderGachaPanel(panel) {
  if (!panel || !state || !config) return;
  const player = mySlot ? state.players[mySlot] : null;
  const towerCount = mySlot ? state.towers.filter((tower) => tower.ownerSlot === mySlot).length : 0;
  const canGacha = player && state.phase === "playing" && player.gold >= 50 && towerCount < player.populationLimit;
  const pityEpic = mySlot ? (state.gachaPityEpic?.[mySlot] || 0) : 0;
  const pityLegendary = mySlot ? (state.gachaPityLegendary?.[mySlot] || 0) : 0;
  const resultText = latestGachaResult ? `${rarityName(latestGachaResult.rarity)} · ${config.towerTypes[latestGachaResult.towerType]?.name || latestGachaResult.towerType}` : "尚未抽签";
  const pool = (state.gachaPool || []).map((item) => `${rarityName(item.rarity)}:${config.towerTypes[item.type]?.name || item.type}`).join(" / ");
  panel.innerHTML = `
    <div class="mini-row"><span>保底</span><strong>史诗 ${pityEpic}/10 · 传说 ${pityLegendary}/30</strong></div>
    <button id="gachaBtn" type="button" class="mini-action" ${canGacha ? "" : "disabled"}><strong>抽签 50 摸鱼时长</strong><span>${towerCount}/${player?.populationLimit || "-"} 人口</span></button>
    <div class="mini-card"><strong>最近结果</strong><span>${resultText}</span></div>
    <div class="mini-note">${pool}</div>
  `;
  panel.querySelector("#gachaBtn")?.addEventListener("click", () => {
    console.log("[gacha] Sending gacha request, phase:", state?.phase, "gold:", player?.gold);
    send("gacha");
  });
}

function renderPressurePanel(panel) {
  if (!panel || !state) return;
  const player = mySlot ? state.players[mySlot] : null;
  const opponents = Object.values(state.players || {}).filter((item) => item.connected && item.slot !== mySlot);
  const selectedTarget = panel.querySelector("#pressureTargetSelect")?.value || opponents[0]?.slot || "";
  const cooldowns = mySlot ? (state.pressureCooldowns?.[mySlot] || {}) : {};
  const shield = mySlot ? (state.pressureShields?.[mySlot] || 0) : 0;
  const targetOptions = opponents.map((item) => `<option value="${item.slot}" ${String(item.slot) === String(selectedTarget) ? "selected" : ""}>${item.slot}号 ${item.name}</option>`).join("");
  const buttons = Object.entries(state.pressureTypes || {}).map(([key, pressure]) => {
    const isAssault = key === "assault";
    const cooldown = cooldowns[key] || 0;
    const usedAssault = isAssault && state.annualAssaultUsed?.[mySlot];
    const totalCost = isAssault ? pressure.cost * opponents.length : pressure.cost;
    const disabled = !player || state.phase !== "playing" || player.gold < totalCost || cooldown > 0 || usedAssault || (!isAssault && !selectedTarget) || (isAssault && opponents.length === 0);
    return `<button type="button" class="mini-action" data-pressure="${key}" ${disabled ? "disabled" : ""}><strong>${pressure.name}</strong><span>${totalCost} 摸鱼时长${cooldown > 0 ? ` · CD ${cooldown}波` : ""}${usedAssault ? " · 已用" : ""}</span></button>`;
  }).join("");
  const pending = (state.pendingPressure || []).length ? state.pendingPressure.map((item) => `<div class="mini-card"><strong>${item.fromSlot}号 → ${item.toSlot}号</strong><span>${state.pressureTypes?.[item.type]?.name || item.type} · ${item.arriveIn}波后</span></div>`).join("") : `<div class="mini-note">暂无待到达压力</div>`;
  panel.innerHTML = `
    <select id="pressureTargetSelect" ${opponents.length ? "" : "disabled"}>${targetOptions || `<option>无对手</option>`}</select>
    <button id="shieldBtn" type="button" class="mini-action" ${player && state.phase === "playing" && player.gold >= 150 && shield <= 0 ? "" : "disabled"}><strong>反甩锅护盾</strong><span>${shield > 0 ? `${shield}波剩余` : "150 摸鱼时长 · 免疫3波"}</span></button>
    ${buttons}
    ${pending}
  `;
  panel.querySelector("#shieldBtn")?.addEventListener("click", () => send("buyShield"));
  panel.querySelectorAll("[data-pressure]").forEach((button) => {
    button.addEventListener("click", () => {
      const pressureType = button.dataset.pressure;
      const targetSlot = Number(panel.querySelector("#pressureTargetSelect")?.value);
      send("sendPressure", { pressureType, targetSlot });
    });
  });
}

function rarityName(rarity) {
  return { common: "普通", rare: "稀有", epic: "史诗", legendary: "传说" }[rarity] || rarity || "未知";
}

function buildPlayerCard(slot, tc, highlight) {
  const player = state.players[slot];
  const role = config.playerRoles[slot];
  const towerCount = (tc || state.towerCounts || {})[slot] || 0;
  const div = document.createElement("div");
  div.className = `player-card${slot === mySlot ? " mine" : ""}`;
  div.style.borderColor = role.color;
  div.innerHTML = player
    ? `<strong>${slot}号 ${player.name}${slot === state.hostSlot ? "（房主）" : ""}</strong><span>${role.name} · ${player.connected ? "在线" : "离线"} · ${player.ready ? "已准备" : "未准备"}</span><span>准点值 ${player.lives} · 摸鱼时长 ${player.gold} · 职场塔 ${towerCount}/${player.populationLimit || '-'}</span>`
    : `<strong>${slot}号 ${role.name}${slot === state.hostSlot ? "（房主）" : ""}</strong><span>空位</span>`;
  if (highlight) {
    div.style.outline = '2px solid #ffd700';
    div.style.outlineOffset = '2px';
    div.style.background = 'rgba(255, 215, 0, .15)';
    div.style.boxShadow = '0 0 8px rgba(255, 215, 0, .3)';
  }
  return div;
}

function showAllPlayersModal() {
  // 创建模态框
  let modal = document.getElementById("allPlayersModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "allPlayersModal";
    modal.className = "feature-modal";
    modal.innerHTML = `<div class="feature-modal-overlay"></div>
      <section class="feature-modal-panel">
        <div class="feature-modal-header">
          <h2>👥 全部玩家状态</h2>
          <button id="allPlayersClose" type="button" class="secondary">关闭</button>
        </div>
        <div id="allPlayersBody" class="feature-modal-body" style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;"></div>
      </section>`;
    document.body.appendChild(modal);
    modal.querySelector("#allPlayersClose").addEventListener("click", () => { modal.style.display = "none"; });
    modal.querySelector(".feature-modal-overlay").addEventListener("click", () => { modal.style.display = "none"; });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && modal.style.display !== "none") modal.style.display = "none"; });
  }
  const body = modal.querySelector("#allPlayersBody");
  body.innerHTML = "";
  const tc = state.towerCounts || {};
  for (let slot = 1; slot <= 8; slot += 1) {
    body.appendChild(buildPlayerCard(slot, tc, false));
  }
  modal.style.display = "flex";
}

/**
 * renderMyStatusBar() - 在玩家状态面板顶部显示当前玩家的金币、准点值、波次、天气
 * 分两行：第一行💰金币 + ❤️准点值；第二行🌊波次 + 🌤️天气
 */
function renderMyStatusBar() {
  if (!myStatusBar || !state || !mySlot) { if (myStatusBar) myStatusBar.style.display = 'none'; return; }
  const player = state.players[mySlot];
  if (!player) { myStatusBar.style.display = 'none'; return; }
  const weatherIcons = { '晴天': '☀️', '阴天': '☁️', '雨天': '🌧️', '大风': '💨', '雷暴': '⛈️', '雾霾': '🌫️' };
  const wName = state.weather?.name || '-';
  const wIcon = weatherIcons[wName] || '🌤️';
  myStatusBar.style.display = 'flex';
  myStatusBar.innerHTML = `
    <div class="status-row">
      <div class="status-item"><span class="status-icon">💰</span><span class="status-value status-gold">${player.gold}</span></div>
      <div class="status-item"><span class="status-icon">❤️</span><span class="status-value status-lives">${player.lives}</span></div>
    </div>
    <div class="status-row">
      <div class="status-item"><span class="status-icon">🌊</span><span class="status-value status-wave">Wave ${state.wave}</span></div>
      <div class="status-item"><span class="status-icon">${wIcon}</span><span class="status-value status-weather">${wName}</span></div>
    </div>
  `;
}

/**
 * renderPlayers — 渲染右侧面板的玩家状态区域
 * 默认显示选中塔所属玩家（或自己），点击“全部玩家”按钮查看所有人
 * 同时更新怪物数量警告和标题栏按钮
 */
function renderPlayers() {
  playersPanel.innerHTML = "";
  const tc = state.towerCounts || {};
  const playerCount = Object.values(state.players).filter(p => p.connected).length;
  const leakLimit = playerCount * 50;
  const totalEnemies = state.enemies.length;
  if (leakLimit > 0 && totalEnemies > leakLimit * 0.8) {
    buildHint.style.color = totalEnemies >= leakLimit ? "#ff4444" : "#ffaa44";
    buildHint.textContent = `⚠ 场上怪物 ${totalEnemies}/${leakLimit}（漏怪上限）`;
  }
  // 更新标题栏，添加“全部玩家”按钮
  const playersCard = playersPanel.closest(".players-card");
  if (playersCard) {
    let header = playersCard.querySelector("h2");
    if (header && !header.querySelector(".all-players-btn")) {
      const btn = document.createElement("button");
      btn.className = "all-players-btn";
      btn.textContent = "👥 全部玩家";
      btn.style.cssText = "padding:2px 8px;font-size:.7rem;margin-left:8px;vertical-align:middle;";
      btn.addEventListener("click", showAllPlayersModal);
      header.appendChild(btn);
    }
  }
  // 默认只显示选中塔所属玩家（如果没有选中塔则显示自己）
  let displaySlot = mySlot;
  if (selectedTowerId) {
    const selTower = state.towers.find(t => t.id === selectedTowerId);
    if (selTower) displaySlot = selTower.ownerSlot;
  }
  if (displaySlot && state.players[displaySlot]) {
    playersPanel.appendChild(buildPlayerCard(displaySlot, tc, false));
  } else {
    // 回退：显示自己
    for (let slot = 1; slot <= 8; slot += 1) {
      if (state.players[slot]) { playersPanel.appendChild(buildPlayerCard(slot, tc, false)); break; }
    }
  }
}

/**
 * renderLogs — 渲染战斗日志面板
 * 合并服务端日志和客户端本地日志，按时间排序，不同种类着色
 * 日志种类：kill(绿)/leak(红)/build(金)/boss(紫)/event(蓝)/wave(橙) 等
 */
function renderLogs() {
  logList.innerHTML = "";
  const serverLogs = state.logs || [];
  const logs = [...serverLogs, ...clientLogs.slice(-30)].sort((a, b) => a.time - b.time);
  if (!logs.length) {
    const empty = document.createElement("p");
    empty.textContent = "暂无战斗日志。";
    logList.append(empty);
    return;
  }
  const kindColors = {
    kill: "#73ff66",
    leak: "#ff4444",
    build: "#ffd700",
    boss: "#c77dff",
    event: "#6ec6ff",
    wave: "#ff9b6a",
    synergy: "#c77dff",
    upgrade: "#ffd700",
    sell: "#ffa500",
    skill: "#ff69b4",
  };
  logs.forEach((log) => {
    const item = document.createElement("p");
    const time = new Date(log.time).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    item.textContent = `[${time}] ${log.message}`;
    const color = kindColors[log.kind];
    if (color) item.style.color = color;
    logList.append(item);
  });
}

/**
 * renderTowerButtons — 渲染建塔面板的塔按钮
 * 按分类Tab（基础输出/功能辅助/特殊效果/终极合成）分组显示
 * 波次≤3时显示新手推荐建塔提示
 */
function renderTowerButtons() {
  if (!config) return;
  const towerCategoryOrder = ["basic", "support", "special", "ultimate"];
  const towerCategoryLabels = { basic: "基础输出", support: "功能辅助", special: "特殊效果", ultimate: "终极合成" };
  const dtName = { physical: "执行", magic: "沟通", pierce: "专业", chaos: "创造" };
  const categories = { basic: [], support: [], special: [], ultimate: [] };
  const hotkeys = { arrow: "Q", cannon: "W", poison: "E", aura_speed: "A", frost: "S", aura_damage: "D", daily_report: "F", reflect: "Z", pua_immune: "X", bootlicker: "C" };
  Object.entries(config.towerTypes).forEach(([key, tower]) => {
    const cat = tower.category || "basic";
    if (!categories[cat]) return;
    categories[cat].push({ key, hotkey: hotkeys[key] || "" });
  });

  towerButtons.innerHTML = "";
  // #5: 新手推荐建塔提示 (wave <= 3)
  if (state && state.wave <= 3 && state.phase === "playing" && mySlot) {
    const dtMap = { physical: "arrow", magic: "cannon", pierce: "poison", chaos: "poison" };
    const nextArmor = state.nextWaveConfig?.armorType;
    const recommendKey = nextArmor ? dtMap[nextArmor] || "arrow" : "arrow";
    const recName = config.towerTypes[recommendKey]?.name || "箭塔";
    if (buildHint) {
      buildHint.style.color = "#ffd700";
      buildHint.textContent = `💡 新手推荐：先建 ${recName} (${HOTKEY_MAP[recommendKey] || "Q"}) 来应对下一波！`;
    }
  }
  const tabBar = document.createElement("div");
  tabBar.className = "tower-tab-bar";
  towerCategoryOrder.forEach((tab) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `tower-tab${towerTab === tab ? " active" : ""}`;
    btn.textContent = towerCategoryLabels[tab];
    btn.addEventListener("click", () => { towerTab = tab; expandedCategory = null; renderTowerButtons(); });
    tabBar.append(btn);
  });
  towerButtons.append(tabBar);

  const grid = document.createElement("div");
  grid.className = "command-grid";
  categories[towerTab].forEach((cmd) => renderTowerButton(grid, cmd, dtName));
  towerButtons.append(grid);
}

function renderTowerButton(container, cmd, dtName) {
  const tower = config.towerTypes[cmd.key];
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `command-button${selectedTowerType === cmd.key ? " selected" : ""}${tower.synthOnly ? " empty" : ""}`;
  const dtLabel = dtName[tower.damageType] || "";
  const costText = tower.synthOnly ? "合成获得" : `${tower.cost}摸鱼时长`;
  // Task 14: Show same-type tower count
  let countText = "";
  if (state && mySlot) {
    const count = state.towers.filter(t => t.ownerSlot === mySlot && t.typeKey === cmd.key).length;
    if (count > 0) countText = ` <span class="tower-count-badge">x${count}</span>`;
  }
  btn.innerHTML = `<strong>[${cmd.hotkey || "合"}]</strong><span>${tower.name}${countText}</span><small>${costText} [${dtLabel}]</small>`;
  btn.disabled = Boolean(tower.synthOnly);
  btn.addEventListener("click", () => { selectedTowerType = cmd.key; selectedTowerId = null; hideFloatingBar(); renderTowerButtons(); updateSelectionPanel(); });
  container.append(btn);
}

function renderCategorySection(catKey, label, items, dtName) {
  const section = document.createElement("div");
  section.className = "tower-category";
  const header = document.createElement("button");
  header.type = "button";
  header.className = `category-header${expandedCategory === catKey ? " expanded" : ""}`;
  header.innerHTML = `<span>${label}塔</span><small>${items.length}种</small><span class="arrow">${expandedCategory === catKey ? "▼" : "▶"}</span>`;
  header.addEventListener("click", () => {
    expandedCategory = expandedCategory === catKey ? null : catKey;
    renderTowerButtons();
  });
  section.append(header);
  if (expandedCategory === catKey) {
    const grid = document.createElement("div");
    grid.className = "command-grid category-content";
    items.forEach((cmd) => renderTowerButton(grid, cmd, dtName));
    section.append(grid);
  }
  towerButtons.append(section);
}

/**
 * updateSelectionPanel — 更新当前岗位面板（选中塔详情）
 * 三种模式：
 * 1. 选中已建塔 → 显示属性、技能、合成配方、操作按钮
 * 2. 选中待建类型 → 显示塔简介和克制关系
 * 3. 未选择 → 显示提示文本
 * 同时更新底部羁绊图标行
 */
function updateSelectionPanel() {
  if (!state || !config) return;
  const armorName = { physical: "流程型", magic: "沟通型", resistance: "抗压型", holy: "权威型" };
  const dmgName = { physical: "执行力", magic: "沟通力", pierce: "专业力", chaos: "创造力" };
  const counterMap = { physical: "magic", magic: "physical", pierce: "resistance", chaos: "holy" };
  const nextArmor = state.nextWaveConfig?.armorType;
  const tower = state.towers.find((item) => item.id === selectedTowerId);
  if (tower && tower.ownerSlot === mySlot) {
    const type = config.towerTypes[tower.typeKey];
    const cost = getUpgradeCost(tower);
    const dtLabel = dmgName[type.damageType] || "";
    const counter = nextArmor ? (counterMap[type.damageType] === nextArmor ? " ✓克制" : counterMap[nextArmor] === type.damageType ? " ✗被克" : "") : "";
    const skill = type.skill;
    const cooldown = Math.ceil(tower.skillCooldown || 0);
    selectionPanel.innerHTML = `<strong>${type.name} Lv.${tower.level}</strong> [${dtLabel}]${counter}<br>输出 ${Math.round(tower.damage)} · 范围 ${Math.round(tower.range)}<br>${tower.level >= 5 ? "已摸到满级" : `强化费用 ${cost} 摸鱼时长`}${skill ? `<br>技能：${skill.name} · ${skill.desc}${cooldown > 0 ? ` · 冷却${cooldown}秒` : ""}` : ""}${getSynthesisHint(tower)}${buildSelectionSynergyIcons()}`;
    upgradeBtn.disabled = tower.level >= 5 || state.players[mySlot].gold < cost;
    upgradeBtn.title = tower.level >= 5 ? "已满级" : (state.players[mySlot].gold < cost ? `摸鱼时长不足（需要 ${cost}）` : "");
    sellBtn.disabled = false; sellBtn.title = "";
    synthesizeBtn.disabled = !canSynthesize(tower);
    synthesizeBtn.title = canSynthesize(tower) ? "" : "合成材料未满足（需全部材料 Lv.5）";
    useSkillBtn.disabled = !skill || state.phase !== "playing" || cooldown > 0;
    useSkillBtn.title = !skill ? "该塔无技能" : (cooldown > 0 ? `冷却中 ${cooldown}秒` : "");
    buildHint.textContent = "已选择自己的职场塔，可强化、撤下或合成。";
    return;
  }
  const selected = config.towerTypes[selectedTowerType];
  if (!selected) {
    selectionPanel.innerHTML = '<span style="color:#cceabd;">🎯 选择一座塔查看详情，或选择塔类型后点击地图建塔</span>';
    upgradeBtn.disabled = true; upgradeBtn.title = "未选择塔";
    sellBtn.disabled = true; sellBtn.title = "未选择塔";
    synthesizeBtn.disabled = true; synthesizeBtn.title = "未选择塔";
    useSkillBtn.disabled = true; useSkillBtn.title = "未选择塔";
    buildHint.textContent = mySlot ? `你是 ${mySlot} 号，只能在自己的岗位区域部署职场塔。` : "先加入一个工位。";
    return;
  }
  const dtLabel = dmgName[selected.damageType] || "";
  const counter = nextArmor ? (counterMap[selected.damageType] === nextArmor ? " ✓克制下一波" : counterMap[nextArmor] === selected.damageType ? " ✗被下一波克制" : "") : "";
  selectionPanel.innerHTML = `<strong>${selected.name}</strong> [${dtLabel}]${counter}<br>${selected.synthOnly ? "由满级材料合成" : `部署消耗 ${selected.cost} 摸鱼时长`}<br>${selected.desc}${buildSelectionSynergyIcons()}`;
  upgradeBtn.disabled = true;
  sellBtn.disabled = true;
  synthesizeBtn.disabled = true;
  useSkillBtn.disabled = true;
  buildHint.textContent = mySlot ? `你是 ${mySlot} 号，只能在自己的岗位区域部署职场塔。` : "先加入一个工位。";
}

/**
 * buildSelectionSynergyIcons — 在选中面板底部构建阵营羁绊图标行
 * 每个阵营显示一个图标，灰色=未达成，金色=已激活
 * hover 显示详细 tooltip（含合成配方、已有塔列表）
 * @returns {string} HTML 字符串
 */
function buildSelectionSynergyIcons() {
  if (!state || !config) return "";
  const counts = state.factionCounts || {};
  const factionIconMap = { tech: '🔧', admin: '📋', slacker: '🐟', special: '⭐' };
  const factionNameMap = config.factionNames || { tech: '技术部', admin: '行政部门', slacker: '摸鱼部', special: '特殊部门' };
  // Tower names by faction for tooltip
  const towerNamesByFaction = {};
  Object.entries(config.towerTypes || {}).forEach(([key, tower]) => {
    const f = tower.faction;
    if (!f || tower.ultimate) return;
    if (!towerNamesByFaction[f]) towerNamesByFaction[f] = [];
    towerNamesByFaction[f].push(tower.name || key);
  });
  // Per-faction synergy thresholds
  const thresholds = [6, 4, 2];
  const levelNames = { 6: '高级', 4: '中级', 2: '初级' };
  const effects = { 2: '攻速+10%', 4: '攻击+20%', 6: '范围+15%' };
  // Build icons — show all factions (gray if unachieved, gold if achieved)
  const icons = Object.entries(factionNameMap)
    .map(([faction, name]) => {
    const current = counts[faction] || 0;
    const achieved = current >= 2; // 最低阈值
    let highestNeed = 0;
    let highestLevel = '';
    let highestEffect = '';
    for (const need of thresholds) {
      if (current >= need) { highestNeed = need; highestLevel = levelNames[need]; highestEffect = effects[need]; break; }
    }
    // Next target
    const nextNeed = thresholds.slice().reverse().find(n => current < n) || 0;
    const nextLevel = nextNeed ? levelNames[nextNeed] : '';
    const nextEffect = nextNeed ? effects[nextNeed] : '';
    const isMaxed = current >= 6;
    // 已拥有的该阵营塔
    const ownedTowers = (state.towers || []).filter(t => {
      const tt = config.towerTypes[t.typeKey];
      return tt && tt.faction === faction && t.ownerSlot === mySlot;
    }).map(t => `${config.towerTypes[t.typeKey]?.name || t.typeKey} Lv.${t.level}`);
    // 合成配方：查找需要该阵营材料的终极塔
    let synthRecipes = [];
    Object.entries(config.synthesisRules || {}).forEach(([ultKey, materials]) => {
      const ultTower = config.towerTypes[ultKey];
      if (!ultTower) return;
      const matNames = materials.map(mk => config.towerTypes[mk]?.name || mk);
      const hasMat = materials.includes(materials.find(mk => {
        const mt = config.towerTypes[mk];
        return mt && mt.faction === faction;
      }));
      if (hasMat) synthRecipes.push(`${ultTower.name}：${matNames.join(' + ')} 均 Lv.5`);
    });
    // Tooltip text (HTML formatted for custom tooltip div)
    let tipHtml = `<strong>${name}</strong>`;
    if (highestNeed) tipHtml += ` · ${highestLevel}：${highestEffect}`;
    tipHtml += `<br>当前：${current}座`;
    if (nextNeed && !isMaxed) tipHtml += ` · 下一级：${nextLevel}(${nextNeed}座)：${nextEffect}`;
    if (isMaxed) tipHtml += ` · <span style="color:#73ff66;">已满级</span>`;
    tipHtml += `<br>所属塔：${towerNamesByFaction[faction]?.join('、') || '无'}`;
    if (ownedTowers.length) tipHtml += `<br>已有：${ownedTowers.join('、')}`;
    else tipHtml += `<br>已有：无`;
    if (synthRecipes.length) tipHtml += `<br>合成配方：${synthRecipes.join('；')}`;
    // Display — 灰色未达成 / 金色已达成
    const borderColor = achieved ? 'rgba(125,255,113,.6)' : 'rgba(128,128,128,.3)';
    const bgColor = achieved ? 'rgba(125,255,113,.1)' : 'rgba(128,128,128,.08)';
    const iconFilter = achieved ? 'none' : 'grayscale(1) opacity(0.5)';
    const countColor = achieved ? '#73ff66' : '#888';
    const textColor = achieved ? '#fff2b0' : '#888';
    // Store tooltip HTML in data attribute (escaped for HTML attribute)
    const escapedTip = tipHtml.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    return `<div data-synergy-tip="${escapedTip}" style="display:flex;flex-direction:column;align-items:center;padding:3px 4px;border:2px solid ${borderColor};border-radius:6px;background:${bgColor};cursor:help;min-width:32px;transition:all .2s;">
      <span style="font-size:1.1rem;filter:${iconFilter};">${factionIconMap[faction] || ''}</span>
      <span style="font-size:.55rem;color:${textColor};line-height:1.1;margin-top:1px;">${highestLevel || '未激活'}</span>
    </div>`;
  }).join('');
  if (!icons) return "";
  return `<div class="selection-synergy-icons" style="display:flex;gap:4px;margin-top:6px;padding-top:5px;border-top:1px solid rgba(255,255,255,.1);justify-content:center;">${icons}</div>`;
}

/**
 * canSynthesize — 检查指定塔是否满足合成条件
 * 条件：该塔是某终极塔的材料，且所有材料塔都达到 Lv.5
 * @param {Object} tower - 塔实例
 * @returns {boolean} 是否可合成
 */
function canSynthesize(tower) {
  const ultimateKey = getUltimateForMaterial(tower.typeKey);
  if (!ultimateKey || tower.ownerSlot !== mySlot) return false;
  return config.synthesisRules[ultimateKey].every((typeKey) => state.towers.some((item) => item.ownerSlot === mySlot && item.typeKey === typeKey && item.level >= 5));
}

/**
 * getSynthesisHint — 生成合成配方提示文本
 * @param {Object} tower - 塔实例
 * @returns {string} HTML 格式的合成提示，无配方则返回空串
 */
function getSynthesisHint(tower) {
  const ultimateKey = getUltimateForMaterial(tower.typeKey);
  if (!ultimateKey) return "";
  const materialNames = config.synthesisRules[ultimateKey].map((typeKey) => config.towerTypes[typeKey].name).join(" + ");
  const ultimateName = config.towerTypes[ultimateKey].name;
  return `<br>合成 ${ultimateName}：${materialNames} 均 Lv.5${canSynthesize(tower) ? " · 可合成" : ""}`;
}

/**
 * getUltimateForMaterial — 反查材料塔所属的终极塔类型
 * @param {string} typeKey - 材料塔类型key
 * @returns {string|null} 终极塔类型key，无则返回 null
 */
function getUltimateForMaterial(typeKey) {
  return Object.entries(config.synthesisRules || {}).find(([, materials]) => materials.includes(typeKey))?.[0] || null;
}

/**
 * showTowerDetailInfo — 显示任意塔的详细信息（包括非自己的塔）
 * 点击画布上的塔时调用，显示伤害、DPS、技能、所属玩家等
 * 非自己的塔会禁用所有操作按钮
 */
function showTowerDetailInfo(tower) {
  if (!state || !config || !selectionPanel) return;
  const type = config.towerTypes[tower.typeKey];
  if (!type) return;
  const dmgName = { physical: "执行力", magic: "沟通力", pierce: "专业力", chaos: "创造力" };
  const dtLabel = dmgName[type.damageType] || "";
  const dps = type.rate > 0 ? Math.round(tower.damage / type.rate) : 0;
  const skill = type.skill;
  const cooldown = Math.ceil(tower.skillCooldown || 0);
  const isOwn = tower.ownerSlot === mySlot;
  const cost = getUpgradeCost(tower);
  const ownerPlayer = state.players[tower.ownerSlot];
  let html = `<strong>${type.name} Lv.${tower.level}</strong> [${dtLabel}]<br>`;
  html += `伤害 ${Math.round(tower.damage)} · 范围 ${Math.round(tower.range)} · 攻速 ${(type.rate || 0).toFixed(2)}s<br>`;
  html += `DPS: ${dps}<br>`;
  if (skill) html += `技能：${skill.name} · ${skill.desc}${cooldown > 0 ? ` · 冷却${cooldown}秒` : ""}<br>`;
  html += `所属：${ownerPlayer ? ownerPlayer.name : "未知"} (${tower.ownerSlot}号)`;
  if (!isOwn) {
    html += `<br><span style="color:#ff9b6a;">⚠ 非自己的塔，无法操作</span>`;
  }
  selectionPanel.innerHTML = html;
  // 按钮状态 + 禁用原因
  if (isOwn) {
    const canUpgrade = tower.level < 5 && state.players[mySlot].gold >= cost;
    if (upgradeBtn) { upgradeBtn.disabled = !canUpgrade; upgradeBtn.title = tower.level >= 5 ? "已满级" : (state.players[mySlot].gold < cost ? `摸鱼时长不足（需要 ${cost}）` : ""); }
    if (sellBtn) { sellBtn.disabled = false; sellBtn.title = ""; }
    if (synthesizeBtn) { synthesizeBtn.disabled = !canSynthesize(tower); synthesizeBtn.title = canSynthesize(tower) ? "" : "合成材料未满足（需全部材料 Lv.5）"; }
    if (useSkillBtn) { useSkillBtn.disabled = !skill || state.phase !== "playing" || cooldown > 0; useSkillBtn.title = !skill ? "该塔无技能" : (cooldown > 0 ? `冷却中 ${cooldown}秒` : ""); }
  } else {
    if (upgradeBtn) { upgradeBtn.disabled = true; upgradeBtn.title = "非自己的塔，无法操作"; }
    if (sellBtn) { sellBtn.disabled = true; sellBtn.title = "非自己的塔，无法操作"; }
    if (synthesizeBtn) { synthesizeBtn.disabled = true; synthesizeBtn.title = "非自己的塔，无法操作"; }
    if (useSkillBtn) { useSkillBtn.disabled = true; useSkillBtn.title = "非自己的塔，无法操作"; }
  }
}

/**
 * showTowerOwnerInfo — 高亮显示塔所属玩家的卡片
 * 在玩家面板中突出显示塔的主人，淡化其他玩家
 */
function showTowerOwnerInfo(tower) {
  if (!state || !playersPanel) return;
  const ownerSlot = tower.ownerSlot;
  const player = state.players[ownerSlot];
  if (!player) return;
  // Highlight the owner card, dim others
  const cards = playersPanel.querySelectorAll(".player-card");
  cards.forEach((card, idx) => {
    card.style.outline = '';
    card.style.outlineOffset = '';
    card.style.background = '';
    card.style.boxShadow = '';
    card.style.opacity = '';
    if (idx === ownerSlot - 1) {
      card.style.outline = '2px solid #ffd700';
      card.style.outlineOffset = '2px';
      card.style.background = 'rgba(255, 215, 0, .15)';
      card.style.boxShadow = '0 0 8px rgba(255, 215, 0, .3)';
    } else {
      card.style.opacity = '0.45';
    }
  });
}

/**
 * canvasPoint — 将鼠标事件坐标转换为画布世界坐标
 * @param {MouseEvent} event - 鼠标事件
 * @returns {{x: number, y: number}} 画布内的世界坐标
 */
function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * mapWidth(),
    y: ((event.clientY - rect.top) / rect.height) * mapHeight(),
  };
}

/**
 * handleCanvasClick — 画布点击处理
 * 逻辑：
 * 1. 点击已有塔 → 选中该塔，显示详情和浮动操作栏
 * 2. 点击空地 → 如果已选建塔类型，发送 build 请求
 * 3. 点击空地（无选中类型）→ 取消选择
 */
function handleCanvasClick(event) {
  if (!state || !config || !mySlot) return;
  const point = canvasPoint(event);
  const tower = state.towers.find((item) => distance(point, worldPoint(item)) <= 14);
  if (tower) {
    selectedTowerId = tower.id;
    // Bug #3: Clicking any tower shows tower details + owner player info
    showTowerDetailInfo(tower);
    showTowerOwnerInfo(tower);
    updateSelectionPanel();
    showFloatingBar(tower);
    return;
  }
  // Clicked empty space — deselect and hide floating bar
  const gridX = mapToGridX(point.x);
  const gridY = mapToGridY(point.y);
  const selected = config.towerTypes[selectedTowerType];
  if (selected && !selected.synthOnly) {
    send("build", { gridX, gridY, towerType: selectedTowerType });
    selectedTowerId = null;
    hideFloatingBar();
  } else {
    selectedTowerId = null;
    hideFloatingBar();
    updateSelectionPanel();
  }
}

// ─── Floating action bar positioning ───
function showFloatingBar(tower) {
  if (!floatingActionBar || !canvas) return;
  const point = worldPoint(tower);
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / canvas.width;
  const scaleY = rect.height / canvas.height;
  const screenX = rect.left + point.x * scaleX;
  const screenY = rect.top + point.y * scaleY;
  floatingActionBar.style.display = "flex";
  floatingActionBar.style.left = (screenX + 20) + "px";
  floatingActionBar.style.top = (screenY - 20) + "px";
  // Update button states
  const type = config.towerTypes[tower.typeKey];
  const skill = type?.skill;
  const cooldown = Math.ceil(tower.skillCooldown || 0);
  const cost = getUpgradeCost(tower);
  if (floatUpgradeBtn) floatUpgradeBtn.disabled = tower.level >= 5 || state.players[mySlot].gold < cost;
  if (floatSellBtn) floatSellBtn.disabled = false;
  if (floatSkillBtn) floatSkillBtn.disabled = !skill || state.phase !== "playing" || cooldown > 0;
}
function hideFloatingBar() {
  if (floatingActionBar) floatingActionBar.style.display = "none";
}

/**
 * autoBuildRecommended — 一键推荐建塔（R键触发）
 * 在可建区域中找到距离路径最远的空格（覆盖范围最优），自动发送 build 请求
 */
function autoBuildRecommended() {
  if (!state || !config || !mySlot || !selectedTowerType) return;
  const type = config.towerTypes[selectedTowerType];
  if (!type || type.synthOnly) return;
  // Find best cell: path coverage distance optimal
  let bestDist = -1;
  let bestCell = null;
  Object.entries(config.buildAreas).forEach(([slot, areas]) => {
    if (!state.sharedBuild && Number(slot) !== mySlot) return;
    areas.forEach(area => {
      for (let gx = area.minX; gx <= area.maxX; gx++) {
        for (let gy = area.minY; gy <= area.maxY; gy++) {
          if (isPathCell(gx, gy)) continue;
          if (state.towers.some(t => t.gridX === gx && t.gridY === gy)) continue;
          let minD = Infinity;
          Object.values(config.pathRoutes || { main: config.mainPathCells }).forEach(route => {
            route.forEach(([px, py]) => {
              const d = Math.abs(gx - px) + Math.abs(gy - py);
              if (d < minD) minD = d;
            });
          });
          if (minD > bestDist) { bestDist = minD; bestCell = { gx, gy }; }
        }
      }
    });
  });
  if (bestCell) {
    send("build", { gridX: bestCell.gx, gridY: bestCell.gy, towerType: selectedTowerType });
  }
}

/**
 * drawLoop — 主绘制循环
 * 每帧调用 draw() 后请求下一帧，形成 requestAnimationFrame 循环
 */
function drawLoop() {
  draw();
  requestAnimationFrame(drawLoop);
}

/**
 * draw — 主绘制函数
 * 绘制顺序很重要：先地图，再实体，最后临时叠加层
 * 1. 清空画布
 * 2. 绘制地图（网格、路径、区域边框）
 * 3. 绘制塔（形状/图片、等级标识）
 * 4. 绘制敌人（图片/圆形、血条、护甲图标）
 * 5. 绘制弹道（圆形弹丸 + 拖尾）
 * 6. 绘制特效（范围圈、命中闪烁）
 * 7. 绘制叠加层（建塔预览、选中高亮、路径箭头、飘字、Boss警报、HUD等）
 */
function draw() {
  if (!config) return;
  resizeCanvas();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  window.drawMap();
  if (state) {
    window.drawTowers();
    window.drawEnemies();
    window.drawProjectiles();
    drawEffects();
    drawBuildPreview();
    drawSelection();
    drawBuildHighlight();
    drawPathArrows();
    drawDamageTexts();
    drawKillGoldTexts();
    drawBossAlert();
    drawScreenFlash();
    drawWaveCountdown();
    drawNotificationBar();
    drawSynergyToasts();
    drawCanvasHud();
    drawPhaseOverlay();
  }
}

/**
 * drawMap — 绘制游戏地图
 * 内容：
 * 1. 深绿色背景填充
 * 2. 路径格（浅绿）和非路径格（深绿交替棋盘格）
 * 3. 玩家区域边框（彩色描边，自己的区域加粗高亮）
 * 4. 路径主线（黄绿色粗线连接路径格中心）
 * 5. 中心标记点
 */
function drawMap() {
  const cellW = mapWidth() / config.cols;
  const cellH = mapHeight() / config.rows;
  ctx.fillStyle = "#102612";
  ctx.fillRect(0, 0, mapWidth(), mapHeight());

  const connectedCells = new Set(Object.values(config.pathRoutes || {}).flat().map(([x, y]) => `${x},${y}`));

  const virtualRoutes = [
    [...hCells(2, 27, 2), ...vCells(3, 17, 27), ...hCells(26, 2, 17), ...vCells(16, 3, 2), [3, 2]],
    [...hCells(6, 23, 5), ...vCells(6, 14, 23), ...hCells(22, 6, 14), ...vCells(13, 6, 6)],
  ];
  virtualRoutes.forEach((route) => route.forEach(([x, y]) => connectedCells.add(`${x},${y}`)));

  for (let y = 0; y < config.rows; y += 1) {
    for (let x = 0; x < config.cols; x += 1) {
      const buildSlot = getBuildSlotAt(x, y);
      const role = buildSlot ? config.playerRoles[buildSlot] : null;
      const path = connectedCells.has(`${x},${y}`);
      ctx.fillStyle = path ? "#3f6530" : (x + y) % 2 === 0 ? "#173819" : "#123015";
      ctx.fillRect(gridToMapX(x), gridToMapY(y), cellW, cellH);
      if (role && !path) {
        ctx.fillStyle = `${role.color}24`;
        ctx.fillRect(gridToMapX(x), gridToMapY(y), cellW, cellH);
      }
      ctx.strokeStyle = buildSlot === mySlot ? "rgba(255,240,168,.16)" : "rgba(255,255,255,.035)";
      ctx.strokeRect(gridToMapX(x), gridToMapY(y), cellW, cellH);
    }
  }

  Object.entries(config.buildAreas).forEach(([slot, areas]) => {
    const role = config.playerRoles[slot];
    areas.forEach((area) => {
      const x = gridToMapX(area.minX);
      const y = gridToMapY(area.minY);
      const w = (area.maxX - area.minX + 1) * cellW;
      const h = (area.maxY - area.minY + 1) * cellH;
      ctx.strokeStyle = role.color;
      ctx.lineWidth = Number(slot) === mySlot ? 3 : 1.5;
      ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
    });
  });

  Object.values(config.pathRoutes || { main: config.mainPathCells }).forEach((route) => {
    ctx.strokeStyle = "#d6f08b";
    ctx.lineWidth = Math.max(5, Math.min(cellW, cellH) * 0.18);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    route.forEach(([x, y], index) => {
      const px = gridToMapX(x + 0.5);
      const py = gridToMapY(y + 0.5);
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  });

  // Entry markers are drawn by drawEntryArrows() hook to avoid duplication
  drawMapMarker(mapWidth() / 2, mapHeight() / 2, "中心", "#ff9b6a");
}

function hCells(x1, x2, y) {
  const step = x1 <= x2 ? 1 : -1;
  const cells = [];
  for (let x = x1; x !== x2 + step; x += step) cells.push([x, y]);
  return cells;
}

function vCells(y1, y2, x) {
  const step = y1 <= y2 ? 1 : -1;
  const cells = [];
  for (let y = y1; y !== y2 + step; y += step) cells.push([x, y]);
  return cells;
}

function drawMapMarker(x, y, label, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "bold 14px sans-serif";
  ctx.fillText(label, x + 10, y - 10);
}

/**
 * drawTowers — 绘制所有塔
 * 使用图片渲染（如果图片已加载），否则 fallback 到圆形
 * 塔中心显示等级数字
 */
function drawTowers() {
  state.towers.forEach((tower) => {
    const type = config.towerTypes[tower.typeKey];
    const point = worldPoint(tower);
    ctx.fillStyle = type.color;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#10220f";
    ctx.font = "bold 8px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(tower.level, point.x, point.y + 3);
    ctx.textAlign = "left";
  });
}

function drawEnemies() {
  if (window.drawEnemiesEnhanced) window.drawEnemiesEnhanced();
  else drawEnemiesEnhanced();
}

/**
 * drawProjectiles — 绘制弹道（基础版，被增强版覆盖）
 * 每个弹丸绘制为带颜色的圆形
 */
function drawProjectiles() {
  state.projectiles.forEach((projectile) => {
    const point = worldPoint(projectile);
    ctx.fillStyle = projectile.color;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
  });
}

/**
 * drawEffects — 绘制临时特效（范围圈、命中闪烁等）
 * 特效带生命周期（life），随时间缩小并淡出
 */
function drawEffects() {
  state.effects.forEach((effect) => {
    const point = worldPoint(effect);
    ctx.strokeStyle = effect.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(point.x, point.y, worldRadius(effect.radius) * Math.max(0.2, effect.life * 4), 0, Math.PI * 2);
    ctx.stroke();
  });
}

/**
 * drawBuildPreview — 绘制建塔预览
 * 跟随鼠标在网格上显示：
 * - 绿色半透明方块（可建）/ 红色方块（不可建）
 * - 塔的攻击范围圆圈
 * 判定：自己的区域 + 非路径 + 非已占格
 */
function drawBuildPreview() {
  if (!mouse || !mySlot || selectedTowerId) return;
  const cellW = mapWidth() / config.cols;
  const cellH = mapHeight() / config.rows;
  const gridX = mapToGridX(mouse.x);
  const gridY = mapToGridY(mouse.y);
  const ownArea = state.sharedBuild ? Boolean(getBuildSlotAt(gridX, gridY)) : getBuildSlotAt(gridX, gridY) === mySlot;
  const blocked = isPathCell(gridX, gridY) || state.towers.some((tower) => tower.gridX === gridX && tower.gridY === gridY);
  const type = config.towerTypes[selectedTowerType];
  if (!type) return;
  const x = gridToMapX(gridX + 0.5);
  const y = gridToMapY(gridY + 0.5);
  const canBuild = ownArea && !blocked && !type.synthOnly;
  ctx.fillStyle = canBuild ? "rgba(143,255,112,.2)" : "rgba(255,78,78,.22)";
  ctx.fillRect(gridToMapX(gridX) + 1, gridToMapY(gridY) + 1, cellW - 2, cellH - 2);
  ctx.strokeStyle = canBuild ? "rgba(210,255,169,.8)" : "rgba(255,102,102,.85)";
  ctx.strokeRect(gridToMapX(gridX) + 2, gridToMapY(gridY) + 2, cellW - 4, cellH - 4);
  ctx.beginPath();
  ctx.arc(x, y, worldRadius(type.range), 0, Math.PI * 2);
  ctx.stroke();
}

/**
 * drawSelection — 绘制选中塔的攻击范围圆圈
 * 自己的塔用金色描边，非自己的塔用半透明白色
 */
function drawSelection() {
  const tower = state.towers.find((item) => item.id === selectedTowerId);
  if (!tower) return;
  const point = worldPoint(tower);
  ctx.strokeStyle = tower.ownerSlot === mySlot ? "#fff0a8" : "rgba(255,255,255,.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(point.x, point.y, worldRadius(tower.range), 0, Math.PI * 2);
  ctx.stroke();
}

/**
 * drawPhaseOverlay — 绘制非游戏阶段的全屏遮罩
 * lobby阶段显示“等待玩家准备”，ended阶段显示“游戏结束”
 */
function drawPhaseOverlay() {
  if (state.phase === "playing") return;
  ctx.fillStyle = "rgba(0,0,0,.45)";
  ctx.fillRect(0, 0, mapWidth(), mapHeight());
  ctx.fillStyle = "#fff0a8";
  ctx.font = "bold 40px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(state.phase === "lobby" ? "等待玩家准备" : "游戏结束", mapWidth() / 2, mapHeight() / 2);
  ctx.textAlign = "left";
}

/**
 * isPathCell — 检查网格坐标是否在主路径上
 * @param {number} gridX - 网格X坐标
 * @param {number} gridY - 网格Y坐标
 * @returns {boolean} 是路径格返回 true
 */
function isPathCell(gridX, gridY) {
  return config.mainPathCells.some((cell) => cell[0] === gridX && cell[1] === gridY);
}

/**
 * getBuildSlotAt — 检查网格坐标属于哪个玩家的建造区域
 * @param {number} gridX - 网格X坐标
 * @param {number} gridY - 网格Y坐标
 * @returns {number|null} 玩家槽位号（1-8），不在任何区域返回 null
 */
function getBuildSlotAt(gridX, gridY) {
  const entry = Object.entries(config.buildAreas).find(([, areas]) => (
    areas.some((area) => gridX >= area.minX && gridX <= area.maxX && gridY >= area.minY && gridY <= area.maxY)
  ));
  return entry ? Number(entry[0]) : null;
}

/**
 * getUpgradeCost — 计算塔的升级费用
 * 公式：基础费用 × (0.75 + 等级 × 0.58)
 * @param {Object} tower - 塔实例
 * @returns {number} 升级所需金币
 */
function getUpgradeCost(tower) {
  return Math.round(config.towerTypes[tower.typeKey].cost * (0.75 + tower.level * 0.58));
}

/**
 * distance — 计算两点之间的欧几里得距离
 * @param {{x: number, y: number}} a - 点A
 * @param {{x: number, y: number}} b - 点B
 * @returns {number} 距离
 */
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ═══════════════════════════════════════════════════════════════
// 7. 波次选择 UI — Roguelike 抉择面板
// ═══════════════════════════════════════════════════════════════
// 波次选择是模态的：阻止游戏推进直到玩家选择或计时器超时

/**
 * updateWaveChoice — 更新波次选择面板
 * 服务端每4波触发一次，客户端渲染3个选项卡片 + 15秒倒计时
 * 超时后由服务端随机选择
 */
function updateWaveChoice() {
  const panel = document.getElementById("waveChoicePanel");
  if (!panel) return;
  if (!state || !state.waveChoiceActive || !state.waveChoiceOptions || state.waveChoiceOptions.length === 0) {
    panel.style.display = "none";
    if (waveChoiceTimerInterval) { clearInterval(waveChoiceTimerInterval); waveChoiceTimerInterval = null; }
    waveChoiceDeadlineAbs = null;
    return;
  }
  panel.style.display = "flex";
  const optionsDiv = document.getElementById("waveChoiceOptions");
  const timerP = document.getElementById("waveChoiceTimer");

  // 渲染选项
  optionsDiv.innerHTML = "";
  const tagLabels = { combat: "战斗", buff: "增益", risk: "挑战", special: "特殊" };
  state.waveChoiceOptions.forEach(option => {
    const div = document.createElement("div");
    div.className = "wave-choice-option";
    const tags = (option.tags || []).map(t => `<span class="option-tag">${tagLabels[t] || t}</span>`).join("");
    div.innerHTML = `<span class="option-icon">${option.icon || "❓"}</span><span class="option-name">${option.name}</span><span class="option-desc">${option.desc}</span>${tags}`;
    div.addEventListener("click", () => {
      console.log("chooseWave clicked", option.id);
      send("chooseWave", { optionId: option.id });
    });
    optionsDiv.append(div);
  });

  // 更新倒计时（兼容时间戳和相对秒数两种格式）
  if (waveChoiceTimerInterval) clearInterval(waveChoiceTimerInterval);
  if (state.waveChoiceDeadline > 1e12) {
    waveChoiceDeadlineAbs = state.waveChoiceDeadline;
  } else if (state.waveChoiceDeadline > 0 && !waveChoiceDeadlineAbs) {
    waveChoiceDeadlineAbs = Date.now() + state.waveChoiceDeadline * 1000;
  } else if (!waveChoiceDeadlineAbs) {
    waveChoiceDeadlineAbs = Date.now() + 15000; // 默认15秒
  }
  waveChoiceTimerInterval = setInterval(() => {
    if (!state?.waveChoiceActive) { clearInterval(waveChoiceTimerInterval); waveChoiceDeadlineAbs = null; return; }
    const remaining = Math.max(0, Math.ceil((waveChoiceDeadlineAbs - Date.now()) / 1000));
    timerP.textContent = `剩余 ${remaining} 秒`;
    timerP.style.color = remaining <= 5 ? "#ff4444" : "#ff9b6a";
  }, 200);
}

/**
 * updateWavePreview — 更新波次预告条
 * 显示当前波次的特殊描述（如“内卷潮”、“隐身潮”）
 * 或下一波的预告信息
 */
function updateWavePreview() {
  const preview = document.getElementById("wavePreview");
  if (!preview || !state || state.phase !== "playing") { if (preview) preview.style.display = "none"; return; }

  // 显示当前波次特殊描述或下一波预告
  const currentDesc = state.specialWaveDesc;
  const nextDesc = state.nextSpecialWaveDesc;
  const desc = currentDesc || nextDesc;

  if (desc) {
    preview.style.display = "block";
    const label = currentDesc ? `当前波次：` : `下一波预告：`;
    preview.innerHTML = `<span class="preview-icon">⚠️</span>${label}<span class="preview-desc">${desc}</span>`;
  } else {
    preview.style.display = "none";
  }
}

// ─── 特殊敌人渲染增强 ───
const originalDrawEnemies = typeof drawEnemies === "function" ? drawEnemies : null;

/**
 * drawEnemiesEnhanced — 增强版敌人绘制
 * 在基础圆形上添加：
 * - 隐身效果（透明度降低）
 * - 光环范围指示（虚线圆）
 * - 加速效果（红色脉冲）
 * - 回复效果（绿色光环）
 * - 敌人图片（优先使用图片，fallback 到圆形）
 * - 血条（绿色进度条）
 * - 护甲类型图标（📋/💬/💪/👔）
 * - 波次编号（中心数字）
 */
function drawEnemiesEnhanced() {
  if (!state) return;
  const cellSize = Math.min(mapWidth() / config.cols, mapHeight() / config.rows);
  state.enemies.forEach((enemy) => {
    const point = worldPoint(enemy);
    const radius = enemy.name === "年终 KPI" ? cellSize * 0.56 : cellSize * 0.44;

    // 伤害检测: 比较上一帧HP
    const lastHp = enemyHpMap.get(enemy.id);
    if (lastHp !== undefined && enemy.hp < lastHp) {
      const dmg = Math.round(lastHp - enemy.hp);
      spawnDamageText(point.x, point.y - radius - 10, `-${dmg}`, '#ff6b6b');
    }
    enemyHpMap.set(enemy.id, enemy.hp);

    // 隐身效果
    if (enemy.invisible) {
      ctx.globalAlpha = 0.2;
    } else if (enemy.semiInvisible) {
      ctx.globalAlpha = 0.45;
    }

    // 光环范围指示
    if (enemy.auraType) {
      ctx.strokeStyle = "rgba(155,89,182,.3)";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(point.x, point.y, worldRadius(100), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 加速效果（红色脉冲）
    if (enemy.accelerate && enemy.survivalTime > 2) {
      ctx.strokeStyle = "rgba(230,126,34,.4)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius + 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 回复效果（绿色光环）
    if (enemy.regenRate > 0) {
      ctx.strokeStyle = "rgba(46,204,113,.4)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius + 3, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 绘制敌人本体 — 优先使用图片
    const enemyImg = getEnemyImage(enemy);
    if (enemyImg && enemyImg.complete && enemyImg.naturalWidth > 0) {
      const imgSize = radius * 2.2;
      ctx.drawImage(enemyImg, point.x - imgSize/2, point.y - imgSize/2, imgSize, imgSize);
    } else {
      // fallback: 原来的圆形绘制
      ctx.fillStyle = enemy.slowTimer > 0 ? "#8fdcff" : enemy.color;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // 血条
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(0,0,0,.65)";
    ctx.fillRect(point.x - cellSize * 0.38, point.y - radius - 7, cellSize * 0.76, 4);
    ctx.fillStyle = "#73ff66";
    ctx.fillRect(point.x - cellSize * 0.38, point.y - radius - 7, cellSize * 0.76 * Math.max(0, enemy.hp / enemy.maxHp), 4);

    // 护甲类型图标
    const armorType = enemy.armorType || enemy.armor;
    if (armorType && ARMOR_ICON[armorType]) {
      ctx.font = `${Math.max(10, Math.round(radius * 0.7))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(ARMOR_ICON[armorType], point.x, point.y + radius + 12);
    }

    // 波次编号
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "rgba(0,0,0,.75)";
    ctx.lineWidth = 3;
    ctx.font = `bold ${Math.max(10, Math.round(radius * 0.9))}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const label = String(enemy.waveNumber || "?");
    ctx.strokeText(label, point.x, point.y);
    ctx.fillText(label, point.x, point.y);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.globalAlpha = 1;
  });
}

// Event listeners are the only place UI gestures become WebSocket commands.
// ─── 前端增强 v1.0: 新增绘制函数 ───

// 伤害飘字 spawn helper
function spawnDamageText(x, y, text, color) {
  damageTexts.push({ x, y, text, color: color || '#ff6b6b', alpha: 1, vy: -1.5, life: 1.0 });
}

function spawnKillGoldText(x, y, gold) {
  killGoldTexts.push({ x, y, text: `+${gold}💰`, alpha: 1, vy: -1.2, life: 1.2 });
}

// (1) 伤害飘字绘制
function drawDamageTexts() {
  const dt = 1 / 60;
  for (let i = damageTexts.length - 1; i >= 0; i--) {
    const t = damageTexts[i];
    t.y += t.vy;
    t.life -= dt;
    t.alpha = Math.max(0, t.life);
    if (t.life <= 0) { damageTexts.splice(i, 1); continue; }
    ctx.globalAlpha = t.alpha;
    ctx.fillStyle = t.color;
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(t.text, t.x, t.y);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }
}

// (2) 击杀金币飘字绘制
function drawKillGoldTexts() {
  const dt = 1 / 60;
  for (let i = killGoldTexts.length - 1; i >= 0; i--) {
    const t = killGoldTexts[i];
    t.y += t.vy;
    t.life -= dt;
    t.alpha = Math.max(0, t.life / 1.2);
    if (t.life <= 0) { killGoldTexts.splice(i, 1); continue; }
    ctx.globalAlpha = t.alpha;
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(t.text, t.x, t.y);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }
}

// (3) Boss 全屏警报
function drawBossAlert() {
  if (!bossAlertActive) return;
  const dt = 1 / 60;
  bossAlertTimer -= dt;
  if (bossAlertTimer <= 0) { bossAlertActive = false; return; }
  const alpha = Math.min(1, bossAlertTimer / 1.5);
  const bannerH = 60;
  ctx.globalAlpha = alpha * 0.85;
  ctx.fillStyle = '#cc0000';
  ctx.fillRect(0, 0, mapWidth(), bannerH);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 30px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('⚠️ 年终KPI 来袭！', mapWidth() / 2, bannerH / 2 + 10);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

// (4) 漏怪屏幕闪红
function drawScreenFlash() {
  if (screenFlashTimer <= 0) return;
  const dt = 1 / 60;
  screenFlashTimer -= dt;
  const alpha = Math.min(0.35, screenFlashTimer * 0.7);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, mapWidth(), mapHeight());
  ctx.globalAlpha = 1;
}

// (9) 建塔区域高亮
function drawBuildHighlight() {
  if (!selectedTowerType || selectedTowerId || !mySlot) return;
  const cellW = mapWidth() / config.cols;
  const cellH = mapHeight() / config.rows;
  const type = config.towerTypes[selectedTowerType];
  if (!type || type.synthOnly) return;
  // 高亮可建区域
  Object.entries(config.buildAreas).forEach(([slot, areas]) => {
    if (!state.sharedBuild && Number(slot) !== mySlot) return;
    areas.forEach(area => {
      for (let gx = area.minX; gx <= area.maxX; gx++) {
        for (let gy = area.minY; gy <= area.maxY; gy++) {
          if (isPathCell(gx, gy)) continue;
          if (state.towers.some(t => t.gridX === gx && t.gridY === gy)) continue;
          ctx.fillStyle = 'rgba(100, 255, 100, 0.12)';
          ctx.fillRect(gridToMapX(gx), gridToMapY(gy), cellW, cellH);
        }
      }
    });
  });
}

// (10) 路径流动箭头
let pathArrowOffset = 0;
function drawPathArrows() {
  const dt = 1 / 60;
  pathArrowOffset = (pathArrowOffset + dt * 30) % 20;
  const cellW = mapWidth() / config.cols;
  const cellH = mapHeight() / config.rows;
  ctx.fillStyle = 'rgba(214, 240, 139, 0.45)';
  Object.values(config.pathRoutes || { main: config.mainPathCells }).forEach(route => {
    for (let i = 0; i < route.length - 1; i += 2) {
      const [x1, y1] = route[i];
      const [x2, y2] = route[Math.min(i + 1, route.length - 1)];
      const px = gridToMapX((x1 + x2) / 2 + 0.5);
      const py = gridToMapY((y1 + y2) / 2 + 0.5);
      const angle = Math.atan2(y2 - y1, x2 - x1);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(5, 0);
      ctx.lineTo(-3, -3);
      ctx.lineTo(-3, 3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  });
}

// (7) 波次倒计时 HUD
function drawWaveCountdown() {
  if (state.phase !== 'playing' || state.autoWaveTimer === undefined) return;
  const secs = Math.ceil(state.autoWaveTimer);
  if (secs <= 0) return;
  const flash = waveCountdownFlash && secs <= 5;
  ctx.globalAlpha = flash ? (Math.sin(Date.now() / 150) * 0.3 + 0.7) : 0.8;
  ctx.fillStyle = flash ? '#ff4444' : '#ff9b6a';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`下一波: ${secs}s`, mapWidth() / 2, 30);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

// (14) 天气/事件通知条
function drawNotificationBar() {
  const dt = 1 / 60;
  let y = 80;
  for (let i = notifications.length - 1; i >= 0; i--) {
    const n = notifications[i];
    n.life -= dt;
    if (n.life <= 0) { notifications.splice(i, 1); continue; }
    n.alpha = Math.min(1, n.life);
    const barW = Math.min(mapWidth() * 0.7, 500);
    const barX = (mapWidth() - barW) / 2;
    ctx.globalAlpha = n.alpha * 0.85;
    ctx.fillStyle = '#1a3a5c';
    ctx.fillRect(barX, y, barW, 36);
    ctx.strokeStyle = '#6ec6ff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(barX, y, barW, 36);
    ctx.globalAlpha = n.alpha;
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${n.icon || '📢'} ${n.text}`, mapWidth() / 2, y + 23);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
    y += 44;
  }
}

// (15) 羁绊激活提示
function drawSynergyToasts() {
  const dt = 1 / 60;
  for (let i = synergyToasts.length - 1; i >= 0; i--) {
    const t = synergyToasts[i];
    t.life -= dt;
    if (t.life <= 0) { synergyToasts.splice(i, 1); continue; }
    t.alpha = Math.min(1, t.life);
    ctx.globalAlpha = t.alpha;
    ctx.fillStyle = '#c77dff';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(t.text, mapWidth() / 2, mapHeight() / 2 - 40 + (2.5 - t.life) * -20);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }
}

// (11) Canvas HUD: 已移除天气显示（天气已在状态栏展示）
/**
 * drawCanvasHud() - Canvas HUD 已清空
 * 所有信息（金币、准点值、波次、天气）已移至右侧面板的 renderMyStatusBar()
 */
function drawCanvasHud() {
  // 所有 HUD 信息已在状态栏显示，Canvas 不再绘制
}

// ═══════════════════════════════════════════════════════════════
// 8. 事件监听器 — UI 手势转为 WebSocket 命令的唯一入口
// ═══════════════════════════════════════════════════════════════

// ─── 大厅操作 ───
joinBtn.addEventListener("click", () => send("join", { name: nameInput.value, slot: Number(slotSelect.value) }));
difficultySelect.addEventListener("change", () => send("lobbyOptions", { difficulty: difficultySelect.value, sharedBuild: sharedBuildInput.checked }));
sharedBuildInput.addEventListener("change", () => send("lobbyOptions", { difficulty: difficultySelect.value, sharedBuild: sharedBuildInput.checked }));

// ─── 聊天 ───
chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  send("chat", { text: chatInput.value });
  chatInput.value = "";
});
// Action button: merge ready + start
// ─── 主操作按钮：合并准备/取消准备/开始 ───
actionBtn.addEventListener("click", () => {
  if (!mySlot || !state) return;
  const myPlayer = state.players[mySlot];
  if (state.phase === "lobby" && !myPlayer.ready) {
    send("ready", { ready: true });
  } else if (state.phase === "lobby" && myPlayer.ready && !allReady()) {
    send("ready", { ready: false }); // toggle unready
  } else if (state.phase === "lobby" && allReady()) {
    send("startWave");
  }
});
// ─── 速度切换（1x/2x/3x/5x/10x 循环） ───
speedBtn.addEventListener("click", () => {
  const speeds = [1, 2, 3, 5, 10];
  const index = speeds.indexOf(state.speed);
  send("speed", { speed: speeds[(index + 1) % speeds.length] });
});
// ─── 塔操作按钮（重置/升级/合成/技能） ───
resetBtn.addEventListener("click", () => send("reset"));
upgradeBtn.addEventListener("click", () => selectedTowerId && send("upgrade", { towerId: selectedTowerId }));
synthesizeBtn.addEventListener("click", () => selectedTowerId && send("synthesize", { towerId: selectedTowerId }));
useSkillBtn.addEventListener("click", () => selectedTowerId && send("useSkill", { towerId: selectedTowerId }));

// ─── 功能面板按钮（理财/抽签/竞争） ───
openInvestmentBtn.addEventListener("click", () => openFeaturePanel("investment"));
openGachaBtn.addEventListener("click", () => openFeaturePanel("gacha"));
openPressureBtn.addEventListener("click", () => openFeaturePanel("pressure"));
featureModalClose.addEventListener("click", closeFeaturePanel);
featureModal?.querySelector(".feature-modal-overlay")?.addEventListener("click", closeFeaturePanel);

// ─── 出售按钮 ───
sellBtn.addEventListener("click", () => {
  if (!selectedTowerId) return;
  send("sell", { towerId: selectedTowerId });
  selectedTowerId = null;
  hideFloatingBar();
});
// Feature center collapse toggle
if (featureCenterToggle) {
  featureCenterToggle.addEventListener("click", () => {
    featureCenterExpanded = !featureCenterExpanded;
    if (featureCenterBody) featureCenterBody.style.display = featureCenterExpanded ? "" : "none";
    const arrow = featureCenterToggle.querySelector(".collapse-arrow");
    if (arrow) arrow.classList.toggle("open", featureCenterExpanded);
  });
}
// Floating action bar buttons
if (floatUpgradeBtn) {
  floatUpgradeBtn.addEventListener("click", () => {
    if (selectedTowerId) send("upgrade", { towerId: selectedTowerId });
  });
}
if (floatSellBtn) {
  floatSellBtn.addEventListener("click", () => {
    if (selectedTowerId) {
      send("sell", { towerId: selectedTowerId });
      selectedTowerId = null;
      hideFloatingBar();
    }
  });
}
if (floatSkillBtn) {
  floatSkillBtn.addEventListener("click", () => {
    if (selectedTowerId) send("useSkill", { towerId: selectedTowerId });
  });
}
canvas.addEventListener("click", handleCanvasClick);
canvas.addEventListener("mousemove", (event) => { mouse = canvasPoint(event); });
canvas.addEventListener("mouseleave", () => { mouse = null; });
/**
 * 键盘快捷键处理
 * - Escape: 关闭功能面板或取消塔选择
 * - U: 升级选中塔
 * - S: 出售选中塔
 * - R: 释放技能（有选中塔时）/ 一键推荐建塔（无选中塔时）
 * - Q/W/E/A/S/D/F/Z/X/C: 选择建塔类型（对应10种基础塔）
 * - 1-0: 备用快捷键选择建塔类型
 */
document.addEventListener("keydown", (event) => {
  if (event.code === "Escape") {
    if (activeFeaturePanel) {
      closeFeaturePanel();
    } else if (selectedTowerId) {
      selectedTowerId = null;
      hideFloatingBar();
      updateSelectionPanel();
    }
    return;
  }
  if (event.target === chatInput) return;
  // U = upgrade, S = sell, R = skill (when tower selected)
  if (selectedTowerId) {
    if (event.code === "KeyU") {
      send("upgrade", { towerId: selectedTowerId });
      return;
    }
    if (event.code === "KeyS") {
      send("sell", { towerId: selectedTowerId });
      selectedTowerId = null;
      hideFloatingBar();
      return;
    }
    if (event.code === "KeyR") {
      send("useSkill", { towerId: selectedTowerId });
      return;
    }
  }
  // R = one-key recommend build (when tower type selected but no tower selected)
  if (event.code === "KeyR" && selectedTowerType && !selectedTowerId) {
    autoBuildRecommended();
    return;
  }
  const keyMap = {
    Digit1: "arrow",
    Digit2: "cannon",
    Digit3: "poison",
    Digit4: "aura_speed",
    Digit5: "frost",
    Digit6: "aura_damage",
    Digit7: "daily_report",
    Digit8: "reflect",
    Digit9: "pua_immune",
    Digit0: "bootlicker",
    KeyQ: "arrow",
    KeyW: "cannon",
    KeyE: "poison",
    KeyA: "aura_speed",
    KeyS: "frost",
    KeyD: "aura_damage",
    KeyF: "daily_report",
    KeyZ: "reflect",
    KeyX: "pua_immune",
    KeyC: "bootlicker",
  };
  const typeKey = keyMap[event.code];
  if (!typeKey || !config || config.towerTypes[typeKey]?.synthOnly) return;
  selectedTowerType = typeKey;
  selectedTowerId = null;
  renderTowerButtons();
  updateSelectionPanel();
});

// ─── 羁绊图标自定义 tooltip（替换 title 属性） ───
if (selectionPanel) {
  selectionPanel.addEventListener('mouseenter', (e) => {
    const icon = e.target.closest('[data-synergy-tip]');
    if (!icon || !towerTooltip) return;
    towerTooltip.innerHTML = icon.getAttribute('data-synergy-tip');
    towerTooltip.style.display = 'block';
    towerTooltip.style.transform = 'none';
    // 先用默认位置渲染，再检测边界
    const tipRect = towerTooltip.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = e.pageX + 12;
    if (left + tipRect.width > vw - 10) left = e.pageX - tipRect.width - 12;
    let top = e.pageY - tipRect.height - 8;
    if (top < 10) top = e.pageY + 12;
    towerTooltip.style.left = left + 'px';
    towerTooltip.style.top = top + 'px';
  }, true);
  selectionPanel.addEventListener('mouseleave', (e) => {
    const icon = e.target.closest('[data-synergy-tip]');
    if (icon && towerTooltip) towerTooltip.style.display = 'none';
  }, true);
}

// ════════════════════════════════════════════════════════════════
// UX 增强 v2.0 — 全部 Batch 功能 (23项)
// ════════════════════════════════════════════════════════════════

// ─── #1 快速开始 ───
if (quickStartBtn) {
  quickStartBtn.addEventListener("click", () => {
    const nickname = "玩家" + Math.floor(Math.random() * 9000 + 1000);
    // 找第一个空位
    let emptySlot = 1;
    for (let s = 1; s <= 8; s++) {
      if (!state?.players?.[s] || !state.players[s].connected) { emptySlot = s; break; }
    }
    if (difficultySelect) difficultySelect.value = "novice";
    send("join", { name: nickname, slot: emptySlot });
  });
}

// ─── #2 分享链接 ───
function showShareLink() {
  if (shareLink) shareLink.style.display = "";
  if (shareUrl) shareUrl.value = window.location.href;
}
if (copyShareBtn) {
  copyShareBtn.addEventListener("click", () => {
    const url = shareUrl?.value || window.location.href;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        copyShareBtn.textContent = "已复制 ✓";
        setTimeout(() => { copyShareBtn.textContent = "复制"; }, 1500);
      });
    } else {
      shareUrl?.select();
      document.execCommand("copy");
      copyShareBtn.textContent = "已复制 ✓";
      setTimeout(() => { copyShareBtn.textContent = "复制"; }, 1500);
    }
  });
}

// ─── #4 塔按钮 tooltip (DOM hover) ───
if (towerTooltip) {
  document.addEventListener("mouseover", (e) => {
    const btn = e.target.closest(".command-button");
    if (!btn || !config) { towerTooltip.style.display = "none"; return; }
    // 通过按钮的 data 属性或文本匹配 tower type
    const btnText = btn.textContent;
    let matchedKey = null;
    Object.entries(config.towerTypes).forEach(([key, t]) => {
      if (btnText.includes(t.name)) matchedKey = key;
    });
    if (!matchedKey) { towerTooltip.style.display = "none"; return; }
    const t = config.towerTypes[matchedKey];
    const dt = { physical: "执行", magic: "沟通", pierce: "专业", chaos: "创造" };
    const ctr = { physical: "沟通", magic: "执行", pierce: "抗压", chaos: "权威" };
    const hk = HOTKEY_MAP[matchedKey] || "";
    const dps = t.rate > 0 ? Math.round(t.damage / t.rate) : 0;
    towerTooltip.innerHTML = `<strong>${t.name}</strong><br>伤害: ${t.damage} · 攻速: ${t.rate?.toFixed(2)}s<br>DPS: ${dps} · 范围: ${t.range}<br>类型: ${dt[t.damageType] || t.damageType} · 克制: ${ctr[t.damageType] || "无"}<br>快捷键: ${hk} · 费用: ${t.cost}`;
    towerTooltip.style.display = "block";
  });
  document.addEventListener("mousemove", (e) => {
    if (towerTooltip.style.display !== "none") {
      towerTooltip.style.left = (e.clientX + 12) + "px";
      towerTooltip.style.top = (e.clientY - 10) + "px";
    }
  });
  document.addEventListener("mouseout", (e) => {
    if (!e.target.closest(".command-button")) towerTooltip.style.display = "none";
  });
}

// ─── #12 按钮主次区分 ───
(function applyButtonClasses() {
  if (joinBtn) joinBtn.classList.add("primary-action");
  if (quickStartBtn) quickStartBtn.classList.add("primary-action");
  // readyBtn removed — merged into actionBtn
  if (sellBtn) sellBtn.classList.add("danger-action");
})();

// ─── #15 首次引导浮层 ───
function initGuide() {
  if (localStorage.getItem("gameGuided") === "true") return;
  if (!guideOverlay || !guideContent || !guideNextBtn || !guideSkipBtn) return;
  guideStep = 0;
  renderGuideStep();
  guideOverlay.style.display = "";
  guideNextBtn.addEventListener("click", () => {
    guideStep++;
    if (guideStep >= guideSteps.length) { finishGuide(); return; }
    renderGuideStep();
  });
  guideSkipBtn.addEventListener("click", finishGuide);
}
function renderGuideStep() {
  if (!guideContent) return;
  const s = guideSteps[guideStep];
  if (!s) return;
  guideContent.innerHTML = `<div class="guide-step"><span class="guide-icon">${s.icon}</span><h3>${s.title}</h3><p>${s.desc}</p><small>步骤 ${guideStep + 1} / ${guideSteps.length}</small></div>`;
  if (guideNextBtn) guideNextBtn.textContent = guideStep >= guideSteps.length - 1 ? "开始游戏" : "下一步";
}
function finishGuide() {
  localStorage.setItem("gameGuided", "true");
  if (guideOverlay) guideOverlay.style.display = "none";
}
initGuide();

// ════════════════════════════════════════════════════════════════
// 函数钩子: 在已有函数末尾追加调用
// ════════════════════════════════════════════════════════════════

// Hook updateUi: 金币动画 + 特殊波次通知 + 分享链接 + 游戏内引导 + 策略提示
const _origUpdateUi = typeof updateUi === 'function' ? updateUi : null;
if (_origUpdateUi) {
  // 用 try-catch 包裹原 updateUi，在其末尾追加逻辑
  // 不能直接 override（因为是声明），所以通过 Interval 检测
}
// 使用 MutationObserver 不可行，直接用 interval hook
setInterval(() => {
  if (!state || !mySlot) return;
  const player = state.players[mySlot];
  if (!player) return;

  // #2: 加入后显示分享链接
  if (mySlot && shareLink && shareLink.style.display === "none") showShareLink();

  // #6: 金币变动动画 (Canvas-based)
  if (prevGold !== null && player.gold !== prevGold) {
    const diff = player.gold - prevGold;
    const dir = diff > 0 ? 1 : -1;
    goldAnimDir = dir;
    goldAnimTimer = 500; // 500ms 动画
    // 飘字
    const hx = 10 + 40;
    const hy = mapHeight() - 10;
    spawnKillGoldText(hx, hy - 20, diff > 0 ? `+${diff}` : `${diff}`);
  }
  prevGold = player.gold;
  if (goldAnimTimer > 0) goldAnimTimer -= 200;

  // #7: 特殊波次通知检测
  const swd = state.specialWaveDesc;
  if (swd && swd !== prevSpecialWaveDesc) {
    specialWaveNotifications.push({ text: `⚠️ ${swd}`, alpha: 1, life: 3 });
  }
  prevSpecialWaveDesc = swd;

  // #16: 游戏内引导 — 首次金币够建塔
  if (!firstTowerGuideShown && player.gold >= 50 && state.phase === "playing") {
    firstTowerGuideShown = true;
    buildHint.style.color = "#ffd700";
    buildHint.textContent = "💡 你的摸鱼时长够建一座塔了！点击右侧按钮或按快捷键建塔。";
    buildHint.style.animation = "hint-pulse 1s ease-in-out 3";
    setTimeout(() => { buildHint.style.animation = ""; }, 3000);
  }

  // #20: 策略提示
  updateStrategyHint();
}, 200);

// Hook drawMap: 网格线 + 路径发光 + 入口箭头
const _origDrawMap = drawMap;
window.drawMap = function() {
  _origDrawMap.call(this);
  // #3: 入口大箭头 (覆盖原圆形标记)
  drawEntryArrows();
  // #17: 地图网格线
  drawMapGridLines();
  // #18: 路径发光
  drawMapPathGlow();
};

// Hook drawTowers: 形状差异化
const _origDrawTowers = drawTowers;
window.drawTowers = function() {
  drawTowersEnhanced();
};

// Hook drawProjectiles: 拖尾
const _origDrawProjectiles = drawProjectiles;
window.drawProjectiles = function() {
  drawProjectilesEnhanced();
};

// Hook drawBuildPreview: 推荐位置闪烁
const _origDrawBuildPreview = drawBuildPreview;
window.drawBuildPreview = function() {
  _origDrawBuildPreview.call(this);
  // #19: 推荐建塔位置闪烁
  if (!mouse || !mySlot || selectedTowerId) return;
  drawRecommendedBuildSpots();
};

// Hook drawEnemies: Boss增强 + 克制关系
const _origDrawEnemiesEnhanced = drawEnemiesEnhanced;
window.drawEnemiesEnhanced = function() {
  _origDrawEnemiesEnhanced.call(this);
  // #15 Boss视觉增强: 放大 + 紫色光环 + 名字
  enhanceBossVisuals();
  // #8 克制关系: ✅/❌
  drawCounterIndicators();
};

// Hook updateSelectionPanel: DPS + 升级预览
const _origUpdateSelectionPanel = updateSelectionPanel;
window.updateSelectionPanel = function() {
  _origUpdateSelectionPanel.call(this);
  // #9: DPS显示
  appendDPSToSelection();
  // #17: 升级预览
  appendUpgradePreview();
};

// Hook updateWaveChoice: 推荐标记
const _origUpdateWaveChoice = updateWaveChoice;
window.updateWaveChoice = function() {
  _origUpdateWaveChoice.call(this);
  // #21: 波次选择推荐
  markRecommendedWaveChoices();
};

// Hook endGame: 失败分析 + 战绩卡 (endGame 在 server 端触发 state 变化，
// 前端通过 updateUi 检测 phase 变化)
// 我们用 phase 变化检测来触发
setInterval(() => {
  if (!state) return;
  const curPhase = state.phase;
  if (curPhase === "ended" && prevPhase !== "ended") {
    // #22: 失败分析
    showEndGameAnalysis();
    // #23: 战绩卡
    showBattleCard();
  }
  prevPhase = curPhase;
}, 500);

// Hook draw(): 在 drawSelection 和 drawPhaseOverlay 之间插入新层
const _origDraw = draw;
window.draw = function() {
  if (!config) return;
  resizeCanvas();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  window.drawMap();
  if (state) {
    window.drawTowers();
    window.drawEnemies();
    window.drawProjectiles();
    drawEffects();
    window.drawBuildPreview();
    drawPathArrows();
    drawDamageTexts();
    drawKillGoldTexts();
    drawBossAlert();
    drawScreenFlash();
    drawWaveCountdown();
    drawNotificationBar();
    drawSynergyToasts();
    drawCanvasHud();
    // ── 新增层 ──
    drawSpecialWaveNotifications();
    drawStrategyHintBar();
    drawPhaseOverlay();
  }
};

// ════════════════════════════════════════════════════════════════
// UX 增强 v2.0 — 实现函数
// ════════════════════════════════════════════════════════════════

// ─── #5: 新手推荐建塔提示 (renderTowerButtons 中已追加) ───

// ─── #7: 特殊波次通知绘制 ───
function drawSpecialWaveNotifications() {
  const dt = 1 / 60;
  let y = 50;
  for (let i = specialWaveNotifications.length - 1; i >= 0; i--) {
    const n = specialWaveNotifications[i];
    n.life -= dt;
    if (n.life <= 0) { specialWaveNotifications.splice(i, 1); continue; }
    n.alpha = Math.min(1, n.life);
    const barW = Math.min(mapWidth() * 0.75, 520);
    const barX = (mapWidth() - barW) / 2;
    ctx.globalAlpha = n.alpha * 0.9;
    ctx.fillStyle = '#5c1a1a';
    ctx.fillRect(barX, y, barW, 38);
    ctx.strokeStyle = '#ff6b6b';
    ctx.lineWidth = 2;
    ctx.strokeRect(barX, y, barW, 38);
    ctx.globalAlpha = n.alpha;
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(n.text, mapWidth() / 2, y + 24);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
    y += 46;
  }
}

// ─── #8: 克制关系显示 (✅/❌ 在血条下方) ───
function drawCounterIndicators() {
  if (!state || !config) return;
  const nextArmor = state.nextWaveConfig?.armorType;
  if (!nextArmor) return;
  const counterMap = { physical: 'magic', magic: 'physical', pierce: 'resistance', chaos: 'holy' };
  const cellSize = Math.min(mapWidth() / config.cols, mapHeight() / config.rows);
  state.enemies.forEach(enemy => {
    const point = worldPoint(enemy);
    const armorType = enemy.armorType || enemy.armor;
    if (!armorType) return;
    const isCountered = counterMap[armorType] === nextArmor;
    const isWeak = counterMap[nextArmor] === armorType;
    if (isCountered || isWeak) {
      const icon = isCountered ? '✅' : '❌';
      const radius = enemy.name === '年终 KPI' ? cellSize * 0.56 : cellSize * 0.44;
      ctx.font = `${Math.max(10, Math.round(radius * 0.6))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(icon, point.x, point.y + radius + 22);
      ctx.textAlign = 'left';
    }
  });
}

// ─── #9: DPS 显示 ───
function appendDPSToSelection() {
  if (!state || !config || !mySlot) return;
  const tower = state.towers.find(t => t.id === selectedTowerId);
  if (tower && tower.ownerSlot === mySlot) {
    const type = config.towerTypes[tower.typeKey];
    if (type && type.rate > 0) {
      const dps = Math.round(tower.damage / type.rate);
      const dpsEl = document.createElement('div');
      dpsEl.className = 'tower-dps';
      dpsEl.style.cssText = 'color:#ffd700;font-weight:bold;margin-top:4px;';
      dpsEl.textContent = `DPS: ${dps}`;
      selectionPanel.appendChild(dpsEl);
    }
  }
}

// ─── #13: 升级预览 ───
function appendUpgradePreview() {
  if (!state || !config || !mySlot) return;
  const tower = state.towers.find(t => t.id === selectedTowerId);
  if (!tower || tower.ownerSlot !== mySlot || tower.level >= 5) return;
  const type = config.towerTypes[tower.typeKey];
  if (!type || !type.rate) return;
  const nextDamage = Math.round(tower.damage * 1.25);
  const nextDps = Math.round(nextDamage / type.rate);
  const curDps = Math.round(tower.damage / type.rate);
  const previewEl = document.createElement('div');
  previewEl.className = 'upgrade-preview';
  previewEl.style.cssText = 'color:#6ec6ff;font-size:0.85em;margin-top:4px;';
  previewEl.textContent = `Lv.${tower.level + 1}: 伤害 ${Math.round(tower.damage)}→${nextDamage} | DPS ${curDps}→${nextDps}`;
  selectionPanel.appendChild(previewEl);
}

// ─── #14: 塔形状差异化 ───
function drawTowersEnhanced() {
  if (!state) return;
  const cellW = mapWidth() / config.cols;
  const cellH = mapHeight() / config.rows;
  const maxSize = Math.min(cellW, cellH) * 0.45;
  state.towers.forEach(tower => {
    const type = config.towerTypes[tower.typeKey];
    const point = worldPoint(tower);
    const size = maxSize * (0.35 + 0.13 * tower.level);
    const faction = type.faction || 'tech';

    // 尝试使用图片绘制
    const img = towerImages[tower.typeKey];
    if (img && img.complete && img.naturalWidth > 0) {
      const imgSize = size * 2.2; // 图片尺寸略大于形状
      ctx.drawImage(img, point.x - imgSize/2, point.y - imgSize/2, imgSize, imgSize);
    } else {
      // fallback: 原来的形状绘制
      ctx.fillStyle = type.color;
      ctx.beginPath();
      switch (faction) {
        case 'tech':
          ctx.arc(point.x, point.y, size, 0, Math.PI * 2);
          break;
        case 'admin':
          ctx.rect(point.x - size, point.y - size, size * 2, size * 2);
          break;
        case 'slacker':
          ctx.moveTo(point.x, point.y - size);
          ctx.lineTo(point.x + size, point.y);
          ctx.lineTo(point.x, point.y + size);
          ctx.lineTo(point.x - size, point.y);
          ctx.closePath();
          break;
        case 'special':
          ctx.moveTo(point.x, point.y - size);
          ctx.lineTo(point.x + size, point.y + size * 0.7);
          ctx.lineTo(point.x - size, point.y + size * 0.7);
          ctx.closePath();
          break;
        default:
          ctx.arc(point.x, point.y, size, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    // 等级标识始终绘制
    ctx.fillStyle = '#10220f';
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeText(tower.level, point.x, point.y + size + 10);
    ctx.fillText(tower.level, point.x, point.y + size + 10);
    ctx.textAlign = 'left';
  });
}

// ─── #15: Boss 视觉增强 (放大 + 紫色光环 + 名字) ───
function enhanceBossVisuals() {
  if (!state) return;
  state.enemies.forEach(enemy => {
    if (enemy.name !== '年终 KPI' && !enemy.isBoss) return;
    const point = worldPoint(enemy);
    const cellSize = Math.min(mapWidth() / config.cols, mapHeight() / config.rows);
    const radius = cellSize * 0.56;
    // 紫色光环
    ctx.save();
    ctx.shadowColor = '#9b59b6';
    ctx.shadowBlur = 18;
    ctx.strokeStyle = 'rgba(155,89,182,0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius + 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();
    // Boss 名字
    ctx.fillStyle = '#c77dff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(enemy.name || 'BOSS', point.x, point.y - radius - 12);
    ctx.textAlign = 'left';
  });
}

// ─── #16: 弹丸拖尾 ───
const projectileHistory = new Map(); // id -> [{x,y}]
function drawProjectilesEnhanced() {
  if (!state) return;
  state.projectiles.forEach(proj => {
    const point = worldPoint(proj);
    const hist = projectileHistory.get(proj.id) || [];
    hist.push({ x: point.x, y: point.y });
    if (hist.length > 4) hist.shift();
    projectileHistory.set(proj.id, hist);
    // 画拖尾
    for (let i = 0; i < hist.length - 1; i++) {
      const alpha = (i / hist.length) * 0.5;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = proj.color;
      ctx.beginPath();
      const r = 3 * (i / hist.length);
      ctx.arc(hist[i].x, hist[i].y, Math.max(1, r), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // 画弹丸本体
    ctx.fillStyle = proj.color;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
  });
  // 清理已消失的弹丸历史
  const activeIds = new Set(state.projectiles.map(p => p.id));
  for (const [id] of projectileHistory) {
    if (!activeIds.has(id)) projectileHistory.delete(id);
  }
}

// ─── #3: 入口大箭头 ───
function drawEntryArrows() {
  if (!config) return;
  const routes = config.pathRoutes || { main: config.mainPathCells };
  Object.values(routes).forEach(route => {
    if (!route || route.length < 2) return;
    const [sx, sy] = route[0];
    const [nx, ny] = route[1];
    const px = gridToMapX(sx + 0.5);
    const py = gridToMapY(sy + 0.5);
    const angle = Math.atan2(ny - sy, nx - sx);
    // 画黄色三角箭头
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.fillStyle = '#fff0a8';
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-8, -10);
    ctx.lineTo(-8, 10);
    ctx.closePath();
    ctx.fill();
    // 描边
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
    // 文字标签
    ctx.fillStyle = '#fff0a8';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('任务入口', px, py - 16);
    ctx.textAlign = 'left';
  });
}

// ─── #17: 地图网格线 ───
function drawMapGridLines() {
  if (!config) return;
  const cellW = mapWidth() / config.cols;
  const cellH = mapHeight() / config.rows;
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= config.cols; x++) {
    ctx.beginPath();
    ctx.moveTo(gridToMapX(x), 0);
    ctx.lineTo(gridToMapX(x), mapHeight());
    ctx.stroke();
  }
  for (let y = 0; y <= config.rows; y++) {
    ctx.beginPath();
    ctx.moveTo(0, gridToMapY(y));
    ctx.lineTo(mapWidth(), gridToMapY(y));
    ctx.stroke();
  }
}

// ─── #18: 路径发光 ───
function drawMapPathGlow() {
  if (!config) return;
  ctx.save();
  ctx.shadowColor = '#d6f08b';
  ctx.shadowBlur = 12;
  ctx.strokeStyle = 'rgba(214,240,139,0.25)';
  ctx.lineWidth = Math.max(6, Math.min(mapWidth() / config.cols, mapHeight() / config.rows) * 0.22);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  Object.values(config.pathRoutes || { main: config.mainPathCells }).forEach(route => {
    ctx.beginPath();
    route.forEach(([x, y], i) => {
      const px = gridToMapX(x + 0.5);
      const py = gridToMapY(y + 0.5);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  });
  ctx.shadowBlur = 0;
  ctx.restore();
}

// ─── #19: 推荐建塔位置闪烁 ───
function drawRecommendedBuildSpots() {
  if (!state || !config || !mySlot) return;
  const cellW = mapWidth() / config.cols;
  const cellH = mapHeight() / config.rows;
  const type = config.towerTypes[selectedTowerType];
  if (!type || type.synthOnly) return;
  // 计算每个可建格子到路径的最近距离，取最优位置
  let bestDist = -1;
  let bestCells = [];
  Object.entries(config.buildAreas).forEach(([slot, areas]) => {
    if (!state.sharedBuild && Number(slot) !== mySlot) return;
    areas.forEach(area => {
      for (let gx = area.minX; gx <= area.maxX; gx++) {
        for (let gy = area.minY; gy <= area.maxY; gy++) {
          if (isPathCell(gx, gy)) continue;
          if (state.towers.some(t => t.gridX === gx && t.gridY === gy)) continue;
          // 到路径最短距离
          let minD = Infinity;
          Object.values(config.pathRoutes || { main: config.mainPathCells }).forEach(route => {
            route.forEach(([px, py]) => {
              const d = Math.abs(gx - px) + Math.abs(gy - py);
              if (d < minD) minD = d;
            });
          });
          if (minD > bestDist) { bestDist = minD; bestCells = [{ gx, gy }]; }
          else if (minD === bestDist) bestCells.push({ gx, gy });
        }
      }
    });
  });
  // 闪烁最优位置
  if (bestCells.length === 0) return;
  const flash = Math.sin(Date.now() / 300) * 0.3 + 0.5;
  bestCells.forEach(({ gx, gy }) => {
    ctx.fillStyle = `rgba(255,215,0,${flash * 0.35})`;
    ctx.fillRect(gridToMapX(gx), gridToMapY(gy), cellW, cellH);
    ctx.strokeStyle = `rgba(255,215,0,${flash})`;
    ctx.lineWidth = 2;
    ctx.strokeRect(gridToMapX(gx) + 1, gridToMapY(gy) + 1, cellW - 2, cellH - 2);
  });
}

// ─── #20: 策略提示 ───
function updateStrategyHint() {
  if (!state || !mySlot || state.phase !== 'playing') { strategyHintText = ''; return; }
  const player = state.players[mySlot];
  if (!player) return;
  const towerCount = state.towers.filter(t => t.ownerSlot === mySlot).length;
  const gold = player.gold;
  const wave = state.wave;
  if (gold >= 150 && towerCount < 3) {
    strategyHintText = '💡 建议：先多建几座塔再升级';
  } else if (towerCount >= 3 && gold >= 80) {
    strategyHintText = '💡 建议：升级已有塔提升输出';
  } else if (towerCount >= 2 && wave >= 5) {
    const mats = Object.keys(config.synthesisRules || {});
    strategyHintText = mats.length ? '💡 建议：关注合成材料，准备合成终极塔' : '';
  } else {
    strategyHintText = '';
  }
}
function drawStrategyHintBar() {
  if (!strategyHintText) return;
  const barW = Math.min(mapWidth() * 0.6, 420);
  const barX = (mapWidth() - barW) / 2;
  const barY = mapHeight() - 50;
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = 'rgba(26,58,92,0.7)';
  ctx.fillRect(barX, barY, barW, 28);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#6ec6ff';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(strategyHintText, mapWidth() / 2, barY + 18);
  ctx.textAlign = 'left';
}

// ─── #21: 波次选择推荐 ───
function markRecommendedWaveChoices() {
  if (!state || !config) return;
  const optionsDiv = document.getElementById('waveChoiceOptions');
  if (!optionsDiv) return;
  const cards = optionsDiv.querySelectorAll('.wave-choice-option');
  const myTowers = state.towers.filter(t => t.ownerSlot === mySlot);
  const factionCounts = {};
  myTowers.forEach(t => {
    const f = config.towerTypes[t.typeKey]?.faction;
    if (f) factionCounts[f] = (factionCounts[f] || 0) + 1;
  });
  cards.forEach((card, i) => {
    const option = state.waveChoiceOptions?.[i];
    if (!option) return;
    const tags = option.tags || [];
    const effects = option.effects || {};
    let isRecommended = false;
    // buff 类型通常推荐
    if (tags.includes('buff')) isRecommended = true;
    // 有金币加成推荐
    if (effects.goldBonus || effects.bonusGold) isRecommended = true;
    // 有塔加成且当前塔少时推荐 combat
    if (tags.includes('combat') && myTowers.length < 3) isRecommended = true;
    if (isRecommended && !card.querySelector('.recommend-badge')) {
      const badge = document.createElement('span');
      badge.className = 'recommend-badge';
      badge.style.cssText = 'background:#ffd700;color:#000;padding:2px 6px;border-radius:3px;font-size:0.75em;font-weight:bold;margin-left:6px;';
      badge.textContent = '⭐推荐';
      card.appendChild(badge);
    }
  });
}

// ─── #22: 失败分析 ───
function showEndGameAnalysis() {
  if (!state || !endGameBody || !endGameCard) return;
  endGameCard.style.display = '';
  const endGameTitleEl = document.querySelector('#endGameTitle');
  if (endGameTitleEl) endGameTitleEl.textContent = '🏆 战绩统计';
  endGameBody.innerHTML = '';
  const player = mySlot ? state.players[mySlot] : null;
  if (!player) return;
  const myTowers = state.towers.filter(t => t.ownerSlot === mySlot);
  const towerTypes = {};
  myTowers.forEach(t => {
    const f = config.towerTypes[t.typeKey]?.faction || 'unknown';
    towerTypes[f] = (towerTypes[f] || 0) + 1;
  });
  const hints = [];
  if (!towerTypes.magic && !towerTypes.special) hints.push('建议建一些沟通型塔来应对沟通压力');
  if (myTowers.length < 4) hints.push('下次多建几座塔，数量很重要');
  if (myTowers.length > 0 && myTowers.every(t => t.level <= 1)) hints.push('记得升级塔，满级塔输出翻倍');
  if (!Object.keys(config.synthesisRules || {}).some(k => myTowers.some(t => t.typeKey === k))) hints.push('尝试合成终极塔来应对后期波次');
  if (hints.length > 0) {
    const hintDiv = document.createElement('div');
    hintDiv.className = 'endgame-analysis';
    hintDiv.style.cssText = 'margin-top:12px;padding:10px;background:rgba(110,198,255,0.1);border-radius:6px;border:1px solid rgba(110,198,255,0.3);';
    hintDiv.innerHTML = `<strong style='color:#6ec6ff;'>💡 策略建议</strong><br>${hints.map(h => `• ${h}`).join('<br>')}`;
    endGameBody.appendChild(hintDiv);
  }
}

// ─── #23: 战绩卡 ───
function showBattleCard() {
  if (!state || !endGameBody) return;
  const cardDiv = document.createElement('div');
  cardDiv.className = 'battle-card';
  cardDiv.style.cssText = 'margin-top:12px;padding:12px;background:rgba(255,215,0,0.08);border-radius:8px;border:1px solid rgba(255,215,0,0.3);';
  // 统计
  const kills = {};
  const towerCounts = {};
  Object.keys(state.players).forEach(slot => { kills[slot] = 0; towerCounts[slot] = 0; });
  (state.logs || []).forEach(log => {
    if (log.kind === 'kill' && log.slot) kills[log.slot] = (kills[log.slot] || 0) + 1;
  });
  state.towers.forEach(t => { towerCounts[t.ownerSlot] = (towerCounts[t.ownerSlot] || 0) + 1; });
  let mvpSlot = null;
  let maxKills = 0;
  Object.entries(kills).forEach(([slot, count]) => {
    if (count > maxKills) { maxKills = count; mvpSlot = Number(slot); }
  });
  const mvpName = mvpSlot && state.players[mvpSlot] ? state.players[mvpSlot].name : '无';
  let html = `<strong style='color:#ffd700;'>🏆 战绩卡</strong><br>`;
  html += `<span style='color:#ffd700;'>MVP: ${mvpName} (${maxKills} 击杀)</span><br>`;
  html += `坚持波数: ${state.wave}<br>`;
  html += `<div style='margin-top:8px;'>`;
  Object.entries(state.players).forEach(([slot, p]) => {
    if (!p || !p.connected) return;
    html += `<div style='margin:4px 0;'>${slot}号 ${p.name}: ${kills[slot] || 0}击杀 · ${towerCounts[slot] || 0}座塔</div>`;
  });
  html += `</div>`;
  cardDiv.innerHTML = html;
  endGameBody.appendChild(cardDiv);
}

// ─── 结束弹窗关闭 ───
if (endGameCloseBtn) {
  endGameCloseBtn.addEventListener('click', () => {
    if (endGameCard) endGameCard.style.display = 'none';
  });
}

// ─── CSS 注入 (用于动画) ───
(function injectUXStyles() {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes hint-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.7; transform: scale(1.05); }
    }
    .primary-action { background: linear-gradient(135deg, #ffd700, #e6ac00) !important; color: #000 !important; font-weight: bold; }
    .secondary-action { background: linear-gradient(135deg, #2d5a27, #1a3a15) !important; color: #d6f08b !important; }
    .danger-action { background: linear-gradient(135deg, #8b2020, #5c1515) !important; color: #ff9b9b !important; }
    .command-button:hover .tower-tooltip { display: block; }
    .guide-step { text-align: center; padding: 20px; }
    .guide-icon { font-size: 48px; display: block; margin-bottom: 12px; }
    .recommend-badge { display: inline-block; vertical-align: middle; }
  `;
  document.head.appendChild(style);
})();
