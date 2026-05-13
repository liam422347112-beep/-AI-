/**
 * 职场守护圈 — 服务端
 * 
 * 功能概述：
 * - WebSocket 游戏服务器，管理 8 人塔防对战
 * - 处理玩家加入/准备/建塔/升级/合成/抽签/投资等核心逻辑
 * - 管理波次推进、敌人生成、战斗计算、随机事件
 * 
 * 主要模块：
 * - 游戏配置（塔类型、敌人类型、羁绊规则等）
 * - 玩家管理（加入、准备、断线）
 * - 建塔系统（部署、升级、合成、出售）
 * - 战斗系统（敌人生成、移动、攻击、死亡）
 * - 波次系统（普通波次、特殊波次、抉择）
 * - 经济系统（金币、投资、抽签）
 * - 事件系统（天气、随机事件）
 */

// Authoritative Node server for the LAN tower-defense game.
// It serves static files, owns all game state, advances simulation ticks, and broadcasts snapshots to browser clients.
const http = require("http");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { WebSocketServer } = require("ws");

// ═══════════════════════════════════════════════════════════
// 游戏核心配置常量
// ═══════════════════════════════════════════════════════════

// Core tuning values shared by map math, wave generation, and the browser renderer.
const port = Number(process.env.PORT || 5252);   // 服务端口
const publicDir = path.join(__dirname, "public"); // 静态文件目录
const tickRate = 30;    // 每秒逻辑帧数（30fps）
const gridSize = 38;    // 每个网格格子的像素尺寸
const cols = 30;         // 地图列数
const rows = 20;         // 地图行数
const totalWaves = Infinity; // 总波次（无尽模式）
const protocolVersion = 1;   // 客户端协议版本号

/**
 * 难度配置：影响敌人属性、自动波次延迟、人口上限和利息
 * - novice（新人摸鱼）：敌人少血薄，延迟14秒，人口18，利息10%
 * - normal（正常上班）：标准难度，延迟10秒，人口16，利息8%
 * - hard（卷王模式）：敌人多血厚，延迟7秒，人口14，利息5%
 */
const difficultyOptions = {
  novice: { name: "新人摸鱼", hp: 1, count: 1, reward: 1, delay: 14, population: 18, interestRate: 0.10, interestCap: 50 },
  normal: { name: "正常上班", hp: 1.25, count: 1.15, reward: 1.05, delay: 10, population: 16, interestRate: 0.08, interestCap: 40 },
  hard: { name: "卷王模式", hp: 1.55, count: 1.3, reward: 1.1, delay: 7, population: 14, interestRate: 0.05, interestCap: 30 },
};

/**
 * 投资产品配置
 * - fund（基金定投）：100金，3波后返还150金
 * - risky（高风险理财）：200金，1波后50%返还400金/50%返还50金
 * - deposit（定期存款）：300金，6波后返还450金，每人限1次
 */
const investmentProducts = {
  fund:    { name: "基金定投", cost: 100, returnGold: 150, waves: 3, maxBuy: Infinity, desc: "3波后返还150金" },
  risky:   { name: "高风险理财", cost: 200, waves: 1, maxBuy: Infinity, desc: "50%返还400金，50%返还50金", isRisky: true },
  deposit: { name: "定期存款", cost: 300, returnGold: 450, waves: 6, maxBuy: 1, desc: "6波后返还450金，限1次" },
};

/**
 * 特殊波次类型配置
 * 每5波出现一种特殊敌人类型，为游戏增加多样性
 * - 内卷潮：击败后分裂成小怪
 * - 隐身潮：普通塔无法攻击
 * - 光环潮：范围内护甲+50%
 * - 加速潮：越拖越快
 * - 回复潮：每秒回血
 * - 半隐身潮：50%闪避
 * - 闪现潮：周期性前跳
 */
const specialWaveTypes = [
  { name: "内卷潮", splitCount: 1, color: "#ff6b9d", desc: "压力分裂！击败后分裂成小怪" },
  { name: "隐身潮", invisible: true, color: "#4a6a7a", desc: "摸鱼怪来袭！普通塔无法攻击" },
  { name: "光环潮", auraType: "armor", color: "#9b59b6", desc: "汇报怪带队！范围内护甲+50%" },
  { name: "加速潮", accelerate: true, color: "#e67e22", desc: "加班怪冲锋！越拖越快" },
  { name: "回复潮", regenRate: 0.03, color: "#2ecc71", desc: "养生怪入侵！每秒回血" },
  { name: "半隐身潮", semiInvisible: true, color: "#34495e", desc: "划水怪来袭！50%闪避" },
  { name: "闪现潮", flashInterval: 5, flashDistance: 3, color: "#f39c12", desc: "闪现怪来袭！周期性前跳" },
];

/**
 * 昼夜/天气系统配置
 * 天气池：每波随机一种天气，影响敌人和塔的属性
 * - 晴天：无额外影响
 * - 雨天：敌人移速-10%，减速效果+20%
 * - 寒潮：塔攻速+15%，冰冻效果翻倍
 * - 大雾：塔射程-20%
 * - 雷暴：3%概率雷击，伤害+50%
 * - 彩虹：全属性+20%（稀有）
 */
const weatherPool = [
  { id: "clear",   name: "☀️ 晴天", weight: 35, effects: {} },
  { id: "rain",    name: "🌧️ 雨天", weight: 25, effects: { enemySpeedMult: 0.9, slowBonus: 1.2 } },
  { id: "cold",    name: "❄️ 寒潮", weight: 15, effects: { towerSpeedMult: 1.15, frostBonus: 2.0 } },
  { id: "fog",     name: "🌫️ 大雾", weight: 15, effects: { towerRangeMult: 0.8 } },
  { id: "storm",   name: "⚡ 雷暴", weight: 8,  effects: { lightningChance: 0.03, damageBonus: 1.5 } },
  { id: "rainbow", name: "🌈 彩虹", weight: 2,  effects: { towerAllMult: 1.2 } },
];

/**
 * getTimeOfDay — 根据波次号确定时段
 * 波次1-4=早晨，5-8=白天，9-12=黄昏，13-16=夜晚，17+=深夜
 * @param {number} wave - 波次号
 * @returns {string} 时段标识
 */
function getTimeOfDay(wave) {
  if (wave <= 4) return "dawn";
  if (wave <= 8) return "day";
  if (wave <= 12) return "dusk";
  if (wave <= 16) return "night";
  return "midnight";
}

const timeOfDayNames = { dawn: "🌅 早晨", day: "☀️ 白天", dusk: "🌆 黄昏", night: "🌙 夜晚", midnight: "🌑 深夜" };

/**
 * getTimeModifiers — 获取时段对敌人的属性修正
 * 深夜敌人更难（HP+20%、移速+20%、奖励+20%）
 * @param {string} timeOfDay - 时段标识
 * @returns {{hpMult: number, speedMult: number, rewardMult: number}}
 */
function getTimeModifiers(timeOfDay) {
  const mods = {
    dawn:    { hpMult: 1.0, speedMult: 1.0, rewardMult: 1.0 },
    day:     { hpMult: 1.0, speedMult: 1.0, rewardMult: 1.0 },
    dusk:    { hpMult: 1.0, speedMult: 1.15, rewardMult: 1.0 },
    night:   { hpMult: 1.3, speedMult: 1.0, rewardMult: 1.5 },
    midnight:{ hpMult: 1.2, speedMult: 1.2, rewardMult: 1.2 },
  };
  return mods[timeOfDay];
}

/**
 * rollWeather — 从天气池中按权重随机抽取天气
 * @returns {Object} 天气配置对象
 */
function rollWeather() {
  const totalWeight = weatherPool.reduce((s, w) => s + w.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const w of weatherPool) {
    roll -= w.weight;
    if (roll <= 0) return w;
  }
  return weatherPool[0];
}

/**
 * 随机事件系统
 * 每波30%概率触发（第3波起），分三类：
 * - positive（正面，45%概率）：发工资、团建、技术突破等
 * - negative（负面，35%概率）：加班、裁员、需求变更等
 * - neutral（中性，20%概率）：部门合并、培训、竞标等
 */
const randomEvents = {
  positive: [
    { id: "boss_trip",      name: "领导出差",   icon: "✈️",  desc: "老板不在，摸起来~", effects: { enemySpeedMult: 0.8 }, duration: 2, category: "positive" },
    { id: "payday",         name: "发工资了",   icon: "💰",  desc: "叮！工资到账！", effects: { instantGold: 100 }, duration: 0, category: "positive" },
    { id: "bonus_double",   name: "年终奖翻倍", icon: "🎁",  desc: "今年绩效不错嘛", effects: { killGoldMult: 2 }, duration: 2, category: "positive" },
    { id: "team_build",     name: "团建通知",   icon: "🎉",  desc: "走走走，吃火锅去", effects: { towerSpeedBuff: 0.8 }, duration: 2, category: "positive" },
    { id: "new_hire",       name: "新员工入职", icon: "👶",  desc: "新人来了，带带他", effects: { freeTowers: 2 }, duration: 0, category: "positive" },
    { id: "tech_break",     name: "技术突破",   icon: "💡",  desc: "这个bug终于修了！", effects: { randomUpgrade5: 1 }, duration: 0, category: "positive" },
    { id: "flex_work",      name: "弹性工作",   icon: "🕐",  desc: "几点来都行，活干完就行", effects: { buildCostMult: 0.7 }, duration: 3, category: "positive" },
    { id: "client_gone",    name: "甲方消失",   icon: "🏃",  desc: "甲方爸爸出差了！", effects: { skipNextWave: true }, duration: 1, category: "positive" },
    { id: "dept_dinner",    name: "部门聚餐",   icon: "🍜",  desc: "吃吃喝喝~", effects: { goldPerSec: 2 }, duration: 3, category: "positive" },
    { id: "promotion",      name: "升职加薪",   icon: "📈",  desc: "恭喜高升！", effects: { populationBonus: 2 }, duration: -1, category: "positive" },
  ],
  negative: [
    { id: "overtime",       name: "紧急加班",   icon: "📋",  desc: "周末来加班！", effects: { enemyCountMult: 1.5 }, duration: 1, category: "negative" },
    { id: "client_urgent",  name: "甲方催命",   icon: "👔",  desc: "这个需求很急！", effects: { enemySpeedMult: 1.25 }, duration: 2, category: "negative" },
    { id: "sys_crash",      name: "系统崩溃",   icon: "💀",  desc: "又蓝屏了...", effects: { disableRandomTowers: 3 }, duration: 1, category: "negative" },
    { id: "layoff_warn",    name: "裁员警告",   icon: "✂️",  desc: "末位淘汰制了解一下", effects: { populationPenalty: -2 }, duration: 3, category: "negative" },
    { id: "boss_inspect",   name: "领导巡查",   icon: "🔍",  desc: "领导来了别摸鱼！", effects: { buildCostMult: 1.5 }, duration: 2, category: "negative" },
    { id: "req_change",     name: "需求变更",   icon: "🔄",  desc: "需求又改了...", effects: { shuffleTowers: true }, duration: 0, category: "negative" },
    { id: "budget_cut",     name: "预算削减",   icon: "📉",  desc: "这个季度预算不够了", effects: { instantGold: -80 }, duration: 0, category: "negative" },
    { id: "allnighter",     name: "通宵赶工",   icon: "🌃",  desc: "通宵了，困死了...", effects: { towerSpeedPenalty: 1.2 }, duration: 2, category: "negative" },
    { id: "client_stay",    name: "甲方驻场",   icon: "🏢",  desc: "甲方来了，装忙！", effects: { enemyHpMult: 1.3 }, duration: 2, category: "negative" },
    { id: "server_down",    name: "服务器宕机", icon: "🔌",  desc: "运维在修了在修了", effects: { disableAura: true }, duration: 1, category: "negative" },
  ],
  neutral: [
    { id: "dept_merge",     name: "部门合并",   icon: "🤝",  desc: "合并了，大家一家人", effects: { shareFactions: true }, duration: 3, category: "neutral" },
    { id: "training",       name: "全员培训",   icon: "📚",  desc: "培训期间不准玩手机", effects: { pauseTowers: true, upgradeAfter: true }, duration: 2, category: "neutral" },
    { id: "bid_start",      name: "竞标开始",   icon: "📊",  desc: "拿下这个项目！", effects: { spawnBoss: true }, duration: 1, category: "neutral" },
    { id: "weekly_report",  name: "周报时间",   icon: "📝",  desc: "写个周报汇报一下", effects: { showNextWave: true }, duration: 1, category: "neutral" },
    { id: "job_hopping",    name: "跳槽季",     icon: "🏃",  desc: "有人跳槽了", effects: { freeSell: true }, duration: 0, category: "neutral" },
    { id: "referral",       name: "内推奖励",   icon: "🎁",  desc: "内推成功有奖金", effects: { newTowerBonusLevel: 1 }, duration: 3, category: "neutral" },
    { id: "office_move",    name: "办公搬家",   icon: "📦",  desc: "换工位了！", effects: { shuffleBuildAreas: true }, duration: 0, category: "neutral" },
  ],
};

/**
 * rollEvent — 从事件池中按权重随机抽取事件
 * 正面45% / 负面35% / 中性20%
 * @returns {Object} 事件配置对象
 */
function rollEvent() {
  const categories = ["positive", "negative", "neutral"];
  const weights = [45, 35, 20]; // 正面概率稍高
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  let roll = Math.random() * totalWeight;
  let catIdx = 0;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll <= 0) { catIdx = i; break; }
  }
  const cat = categories[catIdx];
  const pool = randomEvents[cat];
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * 波次选择 Roguelike 选项池
 * 每4波触发一次，玩家从3个选项中选择一个
 * 四类选项：
 * - A. 压力类型选择：指定下一波敌人护甲类型，获得金币奖励
 * - B. 增益选择：跳过波次、塔攻速加成、人口增加等
 * - C. 风险/挑战：Boss战、996模式、不能卖塔等高风险高回报
 * - D. 特殊事件：特定塔伤害翻倍、跨部门支援等
 */
const waveChoicePool = [
  // A. 压力类型选择
  { id: "rush_overtime", name: "紧急加班", icon: "📋", desc: "下一波敌人数量×2，但奖励丰厚", enemyModifiers: [{ countMult: 2 }], rewards: [{ type: "gold", amount: 60 }], tags: ["combat"] },
  { id: "authority_flood", name: "甲方改需求", icon: "👔", desc: "下一波全为权威型压力", enemyModifiers: [{ armorType: "holy" }], rewards: [{ type: "gold", amount: 80 }], tags: ["combat"] },
  { id: "comm_flood", name: "沟通地狱", icon: "💬", desc: "下一波全为沟通型压力", enemyModifiers: [{ armorType: "magic" }], rewards: [{ type: "gold", amount: 50 }], tags: ["combat"] },
  { id: "process_flood", name: "流程审计", icon: "📑", desc: "下一波全为流程型压力", enemyModifiers: [{ armorType: "physical" }], rewards: [{ type: "gold", amount: 70 }], tags: ["combat"] },
  { id: "resist_flood", name: "抗压测试", icon: "💪", desc: "下一波全为抗压型压力", enemyModifiers: [{ armorType: "resistance" }], rewards: [{ type: "gold", amount: 90 }], tags: ["combat"] },

  // B. 增益选择
  { id: "free_build", name: "摸鱼时光", icon: "🐟", desc: "接下来3波无敌人，自由建塔升级", enemyModifiers: [{ skipWaves: 3 }], rewards: [], tags: ["buff"] },
  { id: "team_speed", name: "团建活动", icon: "🎉", desc: "全体塔攻速+30%，持续3波", enemyModifiers: [], rewards: [], towerBuffs: [{ stat: "rate", mult: 0.7, wavesLeft: 3 }], tags: ["buff"] },
  { id: "recruit", name: "紧急招聘", icon: "📢", desc: "人口上限+3（永久），但下一波HP+50%", enemyModifiers: [{ hpMult: 1.5 }], rewards: [{ type: "population", amount: 3 }], tags: ["buff"] },
  { id: "tech_share", name: "技术分享", icon: "🎓", desc: "随机3座塔各升1级，但下一波出现额外精英", enemyModifiers: [{ eliteCount: 2 }], rewards: [{ type: "upgrade_random", count: 3 }], tags: ["buff"] },
  { id: "budget", name: "部门预算", icon: "💰", desc: "金币+150，但接下来2波击杀不给金币", enemyModifiers: [{ noKillGold: 2 }], rewards: [{ type: "gold", amount: 150 }], tags: ["buff"] },

  // C. 风险/挑战
  { id: "boss_rush", name: "年终述职", icon: "📊", desc: "下一波出现Boss「年终KPI」，击败后金币+200", enemyModifiers: [{ spawnBoss: true }], rewards: [{ type: "gold", amount: 200 }], tags: ["risk"] },
  { id: "full_996", name: "全员996", icon: "🔥", desc: "接下来5波敌人数量+50%，每波结束金币+40", enemyModifiers: [{ countMult: 1.5, wavesLeft: 5 }], rewards: [{ type: "gold_per_wave", amount: 40, waves: 5 }], tags: ["risk"] },
  { id: "no_sell", name: "甲方验收", icon: "🔒", desc: "10波内不能卖塔，全体塔攻击力永久+15%", enemyModifiers: [], rewards: [{ type: "tower_buff", stat: "damage", mult: 1.15 }], tags: ["risk"] },
  { id: "layoff", name: "裁员风波", icon: "✂️", desc: "必须卖掉2座塔，剩余塔全体升1级", enemyModifiers: [], rewards: [{ type: "sell_required", count: 2 }, { type: "upgrade_all", levels: 1 }], tags: ["risk"] },

  // D. 特殊事件
  { id: "poison_boost", name: "摸鱼大赛", icon: "🏆", desc: "接下来3波，摸鱼塔伤害翻倍", enemyModifiers: [], towerBuffs: [{ typeKey: "poison", stat: "damage", mult: 2, wavesLeft: 3 }], tags: ["special"] },
  { id: "arrow_boost", name: "加班狂潮", icon: "⚡", desc: "接下来3波，甩锅塔攻速翻倍", enemyModifiers: [], towerBuffs: [{ typeKey: "arrow", stat: "rate", mult: 0.5, wavesLeft: 3 }], tags: ["special"] },
  { id: "cross_support", name: "跨部门支援", icon: "🤝", desc: "获得1座随机终极塔，金币-100", enemyModifiers: [], rewards: [{ type: "random_ultimate" }], tags: ["special"] },
  { id: "intern", name: "实习生入职", icon: "👶", desc: "免费获得3座Lv.1随机塔，人口+3", enemyModifiers: [], rewards: [{ type: "random_towers", count: 3 }, { type: "population", amount: 3 }], tags: ["special"] },
  { id: "speed_challenge", name: "极限挑战", icon: "⏱️", desc: "下一波敌人移速×2，击败奖励×3", enemyModifiers: [{ speedMult: 2 }], rewards: [{ type: "gold_mult", mult: 3 }], tags: ["risk"] },
  { id: "thick_skin", name: "厚脸皮特训", icon: "🛡️", desc: "下一波敌人护甲×2，但击杀金币+30", enemyModifiers: [{ armorMult: 2 }], rewards: [{ type: "kill_gold_bonus", amount: 30 }], tags: ["risk"] },
];

/**
 * 塔类型配置 — 游戏内所有塔的唯一数据源
 * 包含：费用、伤害、射程、攻速、颜色、描述、伤害类型、
 * 阵营、分类、特殊效果（减速/溅射/毒/光环等）和主动技能
 * 
 * 塔分类：
 * - basic（基础输出）：甩锅塔、划水塔、摸鱼塔
 * - support（功能辅助）：咖啡塔、请假条塔、摸鱼群塔、日报塔
 * - special（特殊效果）：反甩锅塔、PUA免疫塔、舔狗塔
 * - ultimate（终极合成）：职场老油条、摸鱼仙人、躺平大神（合成获得）
 * 
 * 伤害类型克制关系：
 * - 执行力(physical) 克 沟通型护甲
 * - 沟通力(magic) 克 流程型护甲
 * - 专业力(pierce) 克 抗压型护甲
 * - 创造力(chaos) 克 权威型护甲
 */
const towerTypes = {
  arrow: { name: "甩锅塔", cost: 50, damage: 22, range: 133, rate: 0.6, color: "#d8f6ff", desc: "单体甩锅", damageType: "physical", category: "basic", faction: "tech", skill: { name: "终极甩锅", desc: "对目标造成攻击力×5伤害", cooldown: 30, fn: "skill_arrow_ultimate" } },
  cannon: { name: "划水塔", cost: 100, damage: 35, range: 119, rate: 1.15, color: "#ffb347", splash: 64, desc: "范围划水", damageType: "pierce", category: "basic", faction: "tech", skill: { name: "范围划水", desc: "下3次攻击范围翻倍", cooldown: 25, fn: "skill_cannon_splash" } },
  poison: { name: "摸鱼塔", cost: 80, damage: 16, range: 128, rate: 0.48, color: "#a6ff4d", desc: "高速摸鱼", damageType: "chaos", category: "basic", faction: "slacker", skill: { name: "摸鱼传染", desc: "周围所有敌人获得毒debuff（5秒）", cooldown: 40, fn: "skill_poison_spread" } },
  aura_speed: { name: "咖啡塔", cost: 150, damage: 0, range: 190, rate: 9999, color: "#ffe680", desc: "周围+20%效率", damageType: "magic", isAura: true, auraType: "speed", category: "support", faction: "slacker", skill: { name: "紧急加班", desc: "范围内塔攻速翻倍5秒", cooldown: 40, fn: "skill_caffeine_boost" } },
  frost: { name: "请假条塔", cost: 70, damage: 9, range: 124, rate: 0.9, color: "#85d7ff", slow: 0.45, slowTime: 1.35, desc: "拖延任务", damageType: "magic", category: "support", faction: "tech", skill: { name: "长假连休", desc: "冻结范围内所有敌人3秒", cooldown: 45, fn: "skill_frost_freeze" } },
  aura_damage: { name: "摸鱼群塔", cost: 170, damage: 0, range: 175, rate: 9999, color: "#ffb0e0", desc: "周围+15%输出", damageType: "magic", isAura: true, auraType: "damage", category: "support", faction: "slacker", skill: { name: "集体摸鱼", desc: "范围内塔攻击力+50%持续8秒", cooldown: 50, fn: "skill_slacker_boost" } },
  daily_report: { name: "日报塔", cost: 180, damage: 18, range: 133, rate: 0.65, color: "#ffd700", desc: "击败+3摸鱼时长，可发现隐身怪", damageType: "physical", growthType: "gold", category: "support", faction: "admin", revealInvisible: true, skill: { name: "周报风暴", desc: "本波击杀金币×2持续10秒", cooldown: 60, fn: "skill_gold_boost" } },
  reflect: { name: "反甩锅塔", cost: 120, damage: 14, range: 131, rate: 0.95, color: "#ff6b6b", desc: "命中扩散伤害", damageType: "physical", reflectSplash: 72, category: "special", faction: "admin", skill: { name: "甩锅反弹", desc: "下次攻击伤害×10并扩散", cooldown: 35, fn: "skill_reflect_boost" } },
  pua_immune: { name: "PUA免疫塔", cost: 140, damage: 24, range: 138, rate: 0.72, color: "#b8ff3b", desc: "克制权威压力", damageType: "chaos", holyBonus: 1.8, category: "special", faction: "special", skill: { name: "反PUA宣言", desc: "5秒内权威型压力伤害归零", cooldown: 60, fn: "skill_pua_immune" } },
  bootlicker: { name: "舔狗塔", cost: 190, damage: 20, range: 122, rate: 0.82, color: "#ff8bd1", desc: "小怪概率送走", damageType: "magic", executeChance: 0.12, bossPercentDamage: 0.035, category: "special", faction: "admin", skill: { name: "拍马屁", desc: "目标精英怪30%概率直接死亡", cooldown: 90, fn: "skill_bootlicker_execute" } },
  old_hand: { name: "职场老油条", cost: 0, damage: 70, range: 9999, rate: 1.35, color: "#f2ffcd", desc: "全图甩锅伤害", damageType: "chaos", category: "ultimate", ultimate: true, synthOnly: true, splash: 9999, skill: { name: "甩锅风暴", desc: "全图所有敌人受到攻击力×3伤害", cooldown: 60, fn: "skill_old_hand_storm" } },
  slacking_immortal: { name: "摸鱼仙人", cost: 0, damage: 0, range: 9999, rate: 9999, color: "#7dff71", desc: "全局塔效率翻倍", damageType: "magic", isAura: true, auraType: "global_double", category: "ultimate", ultimate: true, synthOnly: true, skill: { name: "全员摸鱼", desc: "全体塔攻击力×3持续10秒", cooldown: 90, fn: "skill_immortal_boost" } },
  layflat_god: { name: "躺平大神", cost: 0, damage: 0, range: 9999, rate: 2.2, color: "#b98cff", desc: "普通压力消失", damageType: "chaos", category: "ultimate", ultimate: true, synthOnly: true, layflat: true, skill: { name: "躺平宣言", desc: "清除场上所有普通压力", cooldown: 120, fn: "skill_layflat_clear" } },
};

/**
 * 合成规则：指定每个终极塔所需的材料塔列表
 * 材料塔必须全部达到 Lv.5 才能合成
 */
const synthesisRules = {
  old_hand: ["arrow", "cannon", "poison"],
  slacking_immortal: ["aura_speed", "frost", "aura_damage", "daily_report"],
  layflat_god: ["reflect", "pua_immune", "bootlicker"],
};

/**
 * 合成名称映射：终极塔类型key → 中文名称
 */
const synthesisNames = {
  old_hand: "职场老油条",
  slacking_immortal: "摸鱼仙人",
  layflat_god: "躺平大神",
};

/**
 * 材料→终极塔反向查找表
 * 从合成规则构建，用于快速判断某材料塔属于哪个终极塔配方
 */
const materialToUltimate = Object.entries(synthesisRules).reduce((acc, [ultimate, materials]) => {
  materials.forEach((material) => { acc[material] = ultimate; });
  return acc;
}, {});

const damageTypes = { physical: "执行力", magic: "沟通力", pierce: "专业力", chaos: "创造力" };
const armorTypes = { physical: "流程型压力", magic: "沟通型压力", resistance: "抗压型压力", holy: "权威型压力" };
const counterMap = {
  physical: "magic",    // 物理克魔法护甲
  magic: "physical",    // 魔法克物理护甲
  pierce: "resistance", // 穿刺克抗性护甲
  chaos: "holy",        // 混乱克神圣护甲
};
const weakAgainst = {
  physical: "holy",       // 物理被神圣护甲克制
  magic: "magic",         // 魔法被魔法护甲克制
  pierce: "physical",     // 穿刺被物理护甲克制
  chaos: "resistance",    // 混乱被抗性护甲克制
};

/**
 * 阵营/羁绊系统配置
 * 四个阵营：技术部(tech)、行政部门(admin)、摸鱼部(slacker)、特殊部门(special)
 * 羁绊触发条件（同阵营塔数量）：
 * - 2座：初级羁绊（攻速+10%）
 * - 4座：中级羁绊（攻击+20%）
 * - 6座：高级羁绊（范围+15%）
 * 跨阵营组合：
 * - 技术部2+行政部2：全体攻速+25%
 * - 摸鱼部2+特殊部1：击杀金币+50%
 * - 技术部2+摸鱼部2+行政部2：全属性+15%
 */
const factionNames = { tech: "技术部", admin: "行政部门", slacker: "摸鱼部", special: "特殊部门" };
const factionIcons = { tech: "🔧", admin: "📋", slacker: "🐟", special: "⭐" };

/**
 * calculateSynergies — 计算当前塔阵的阵营羁绊效果
 * @param {Array} towers - 当前所有塔实例
 * @returns {{buffs: Object, activeSynergies: Array, factionCounts: Object}}
 */
function calculateSynergies(towers) {
  const buffs = { speedMult: 1, damageMult: 1, rangeMult: 1, goldBonus: 0 };
  const factionCounts = {};
  const activeSynergies = [];

  // 统计每个阵营的塔数量（不含终极塔）
  towers.forEach(t => {
    const f = towerTypes[t.typeKey]?.faction;
    if (f) factionCounts[f] = (factionCounts[f] || 0) + 1;
  });

  // 同阵营羁绊
  for (const [faction, count] of Object.entries(factionCounts)) {
    if (count >= 2) {
      buffs.speedMult *= 0.9;
      activeSynergies.push({ name: `${factionIcons[faction]}${factionNames[faction]}·初级羁绊`, effect: "攻速+10%" });
    }
    if (count >= 4) {
      buffs.damageMult *= 1.2;
      activeSynergies.push({ name: `${factionIcons[faction]}${factionNames[faction]}·中级羁绊`, effect: "攻击+20%" });
    }
    if (count >= 6) {
      buffs.rangeMult *= 1.15;
      activeSynergies.push({ name: `${factionIcons[faction]}${factionNames[faction]}·高级羁绊`, effect: "范围+15%" });
    }
  }

  // 跨阵营组合
  const tech = factionCounts.tech || 0;
  const admin = factionCounts.admin || 0;
  const slacker = factionCounts.slacker || 0;
  const special = factionCounts.special || 0;

  if (tech >= 2 && admin >= 2) {
    buffs.speedMult *= 0.75;
    activeSynergies.push({ name: "🤝 跨部门协作", effect: "全体攻速+25%" });
  }
  if (slacker >= 2 && special >= 1) {
    buffs.goldBonus += 5;
    activeSynergies.push({ name: "🐟⭐ 摸鱼同盟", effect: "击杀金币+50%" });
  }
  if (tech >= 2 && slacker >= 2 && admin >= 2) {
    buffs.speedMult *= 0.85;
    buffs.damageMult *= 1.15;
    buffs.rangeMult *= 1.15;
    activeSynergies.push({ name: "🏢 全公司联动", effect: "全属性+15%" });
  }

  return { buffs, activeSynergies, factionCounts };
}

/**
 * 抽签（面试模式）卡池配置
 * 按稀有度分：普通(20+15+15权重)、稀有(12+10+8)、史诗(7+5+3)、传说(5)
 * 保底机制：10次必出史诗，30次必出传说
 */
const gachaPool = [
  { type: "arrow",   weight: 20, rarity: "common" },
  { type: "cannon",  weight: 15, rarity: "common" },
  { type: "poison",  weight: 15, rarity: "common" },
  { type: "frost",   weight: 12, rarity: "rare" },
  { type: "aura_speed",  weight: 10, rarity: "rare" },
  { type: "aura_damage", weight: 8,  rarity: "rare" },
  { type: "daily_report", weight: 7, rarity: "epic" },
  { type: "reflect",     weight: 5, rarity: "epic" },
  { type: "pua_immune",  weight: 3, rarity: "epic" },
  { type: "bootlicker",  weight: 5, rarity: "legendary" },
];

/**
 * 送怪类型配置
 * - normal（甩锅传送）：80金，3波CD，送5个普通怪
 * - elite（甲方转嫁）：200金，5波CD，送1个精英怪（HP×3）
 * - clear（部门支援）：50金，无CD，清除目标普通怪
 * - assault（年终突击）：500金，一次性，给所有对手各送1个Boss
 */
const pressureTypes = {
  normal:  { name: "甩锅传送", cost: 80,  cooldown: 3, count: 5, hpMult: 1.0, speedMult: 1.0 },
  elite:   { name: "甲方转嫁", cost: 200, cooldown: 5, count: 1, hpMult: 3.0, speedMult: 0.7, armor: 0.4 },
  clear:   { name: "部门支援", cost: 50,  cooldown: 0, count: 0, clearNormal: true },
  assault: { name: "年终突击", cost: 500, cooldown: 0, count: 1, hpMult: 5.0, speedMult: 0.5, armor: 0.3, isBoss: true },
};

/**
 * getDamageMultiplier — 计算伤害倍率
 * 克制关系：2倍伤害 / 被克制：0.3倍 / 普通：1倍
 * @param {string} damageType - 攻击方伤害类型
 * @param {string} armorType - 防御方护甲类型
 * @returns {number} 伤害倍率
 */
function getDamageMultiplier(damageType, armorType) {
  if (counterMap[damageType] === armorType) return 2.0;   // 克制：2倍伤害
  if (weakAgainst[damageType] === armorType) return 0.3;  // 被克：0.3倍
  return 1.0;                                              // 普通：1倍
}

// ═══════════════════════════════════════════════════════════
// 地图路径配置
// ═══════════════════════════════════════════════════════════
// 经典绿色循环圈：四条独立路径，每个玩家有专属入口
// 外圈顺时针 → 中圈逆时针 → 内圈顺时针 → 中心出口
// 30x20 网格布局

// hLine/vLine 辅助函数：生成水平/垂直线段的网格坐标数组
function range(start, end) {
  const step = start <= end ? 1 : -1;
  const cells = [];
  for (let value = start; value !== end + step; value += step) cells.push(value);
  return cells;
}

/**
 * 生成水平线路径（从 x1 到 x2，固定 y 坐标）
 * @param {number} x1 - 起始列
 * @param {number} x2 - 结束列
 * @param {number} y - 行坐标
 * @returns {Array<[number,number]>} 坐标数组
 */
function hLine(x1, x2, y) { return range(x1, x2).map(x => [x, y]); }

/**
 * 生成垂直线路径（从 y1 到 y2，固定 x 坐标）
 * @param {number} y1 - 起始行
 * @param {number} y2 - 结束行
 * @param {number} x - 列坐标
 * @returns {Array<[number,number]>} 坐标数组
 */
function vLine(y1, y2, x) { return range(y1, y2).map(y => [x, y]); }

/**
 * 标准地图路径定义
 * 4条路径分别对应4个外圈玩家的入口位置：
 * - path1: 左上入口 [0,2]
 * - path2: 右上入口 [27,0]
 * - path3: 右下入口 [29,17]
 * - path4: 左下入口 [2,19]
 * 每条路径经过外圈→中圈→内圈→中心
 */
const path1 = [
  [0, 2], [1, 2],
  ...hLine(2, 27, 2), ...vLine(3, 17, 27), ...hLine(26, 2, 17), ...vLine(16, 2, 2), ...hLine(3, 14, 2),
  ...vLine(3, 5, 14),
  ...hLine(15, 23, 5), ...vLine(6, 14, 23), ...hLine(22, 6, 14), ...vLine(13, 5, 6), ...hLine(7, 11, 5),
  ...vLine(6, 9, 11), ...hLine(12, 14, 9),
];

const path2 = [
  [27, 0], [27, 1],
  ...vLine(2, 17, 27), ...hLine(26, 2, 17), ...vLine(16, 2, 2), ...hLine(3, 27, 2), ...vLine(3, 9, 27),
  ...hLine(26, 23, 9),
  ...vLine(10, 14, 23), ...hLine(22, 6, 14), ...vLine(13, 5, 6), ...hLine(7, 23, 5), ...vLine(6, 8, 23),
  ...hLine(22, 15, 8), [15, 9],
];

const path3 = [
  [29, 17], [28, 17],
  ...hLine(27, 2, 17), ...vLine(16, 2, 2), ...hLine(3, 27, 2), ...vLine(3, 17, 27), ...hLine(26, 15, 17),
  ...vLine(16, 14, 15),
  ...hLine(16, 6, 14), ...vLine(13, 5, 6), ...hLine(7, 23, 5), ...vLine(6, 14, 23), ...hLine(22, 19, 14),
  ...vLine(13, 10, 19), ...hLine(18, 15, 10),
];

const path4 = [
  [2, 19], [2, 18],
  ...vLine(17, 2, 2), ...hLine(3, 27, 2), ...vLine(3, 17, 27), ...hLine(26, 2, 17), ...vLine(16, 10, 2),
  ...hLine(3, 6, 10),
  ...vLine(9, 5, 6), ...hLine(7, 23, 5), ...vLine(6, 14, 23), ...hLine(22, 6, 14), ...vLine(13, 12, 6),
  ...hLine(7, 14, 12), ...vLine(11, 10, 14),
];

/**
 * pathRoutes — 4条路径的映射表（玩家槽位 → 路径坐标数组）
 */
const pathRoutes = { 1: path1, 2: path2, 3: path3, 4: path4 };
/** mainPathCells — 所有路径格的去重合并（用于路径碰撞检测） */
const mainPathCells = [...new Map(Object.values(pathRoutes).flat().map(cell => [`${cell[0]},${cell[1]}`, cell])).values()];
const mainPathSet = new Set(mainPathCells.map(([x, y]) => `${x},${y}`));

// ═══════════════════════════════════════════════════════════
// 玩家角色 & 建造区域配置
// ═══════════════════════════════════════════════════════════

/**
 * playerRoles — 8个玩家的位置和颜色标识
 * 1-4号为外圈，5-8号为内圈
 */
const playerRoles = {
  1: { name: "左上外圈", ring: "outer", color: "#6ee76a" },
  2: { name: "右上外圈", ring: "outer", color: "#6ab2ff" },
  3: { name: "右下外圈", ring: "outer", color: "#ffcf5a" },
  4: { name: "左下外圈", ring: "outer", color: "#ff7fd1" },
  5: { name: "左上内圈", ring: "inner", color: "#ff9b6a" },
  6: { name: "右上内圈", ring: "inner", color: "#b98cff" },
  7: { name: "右下内圈", ring: "inner", color: "#73e6ff" },
  8: { name: "左下内圈", ring: "inner", color: "#c7ff5a" },
};
/**
 * buildAreas — 每个玩家可建造塔的网格区域
 * 外圈玩家(1-4)：14x5格的大区域
 * 内圈玩家(5-8)：7x3格的小区域
 */
const buildAreas = {
  1: [{ minX: 0, maxX: 13, minY: 0, maxY: 4 }],
  2: [{ minX: 16, maxX: 29, minY: 0, maxY: 4 }],
  3: [{ minX: 16, maxX: 29, minY: 15, maxY: 19 }],
  4: [{ minX: 0, maxX: 13, minY: 15, maxY: 19 }],
  5: [{ minX: 7, maxX: 13, minY: 6, maxY: 8 }],
  6: [{ minX: 16, maxX: 22, minY: 6, maxY: 8 }],
  7: [{ minX: 16, maxX: 22, minY: 11, maxY: 13 }],
  8: [{ minX: 7, maxX: 13, minY: 11, maxY: 13 }],
};

let game = createGame();

/**
 * createGame — 创建新游戏状态对象
 * 返回可序列化的比赛状态（不含 Set/Map 等非序列化类型）
 * @returns {Object} 初始游戏状态
 */
function createGame() {
  return {
    phase: "lobby",
    hostSlot: null,
    wave: 0,
    spawning: false,
    spawnTimer: 0,
    spawnCount: 0,
    speed: 1,
    players: {},
    towers: [],
    enemies: [],
    projectiles: [],
    effects: [],
    nextTowerId: 1,
    nextEnemyId: 1,
    nextProjectileId: 1,
    logs: [],
    difficulty: "novice",
    sharedBuild: false,
    autoWaveTimer: 0,
    // ─── 波次选择 Roguelike v1.0 ───
    waveChoiceActive: false,
    waveChoiceOptions: [],
    waveChoiceDeadline: 0,
    activeModifiers: [],     // 当前生效的波次修改器
    towerBuffs: [],          // 当前生效的塔buff
    noKillGoldWaves: 0,      // 剩余无击杀金币波数
    goldPerWaveBonus: 0,     // 每波额外金币
    goldPerWaveWaves: 0,     // 额外金币剩余波数
    skipWavesLeft: 0,        // 跳过波次剩余
    usedChoiceIds: new Set(), // 已使用的选择ID
    // ─── 昼夜/天气系统 v1.0 ───
    timeOfDay: "dawn",
    weather: { id: "clear", name: "☀️ 晴天", effects: {} },
    activeEvents: [],        // 当前生效的随机事件
    // ─── 送怪系统 v1.0 ───
    pendingPressure: [],     // 待到达的送怪
    pressureCooldowns: {},   // { slot: { type: wavesLeft } }
    pressureShields: {},     // { slot: wavesLeft }
    annualAssaultUsed: {},   // { slot: true }
    // ─── 塔主动技能 v1.0 ───
    // (技能CD存在tower实例上)
    // ─── 随机塔/面试模式 v1.0 ───
    gachaMode: false,
    gachaPityEpic: {},       // { slot: count }
    gachaPityLegendary: {},  // { slot: count }
    gachaConsecutive: {},    // { slot: { typeKey: count } }
  };
}

/**
 * createPlayer — 创建新玩家对象
 * @param {number} clientId - WebSocket 客户端ID
 * @param {number} slot - 玩家槽位（1-8）
 * @param {string} name - 玩家昵称（最长12字符）
 * @returns {Object} 玩家状态对象
 */
function createPlayer(clientId, slot, name) {
  return {
    clientId,
    slot,
    name: name.slice(0, 12) || `玩家${slot}`,
    lives: 20,
    gold: 220,
    ready: false,
    population: 0,
    populationLimit: difficultyOptions[game.difficulty].population,
    connected: true,
    // ─── 利息/投资系统 v1.0 ───
    investments: [],       // [{productId, amount, wavesLeft}]
    zeroGoldWaves: 0,      // 连续0金币波次数
    lastInterest: 0,       // 上波利息
    moonlightDebuff: false, // 月光族debuff
    depositUsed: false,    // 定期存款是否已购买过
  };
}

// HTTP serves files from public/ only; WebSocket clients connect to the same host/port.
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const filePath = path.join(publicDir, urlPath === "/" ? "index.html" : urlPath);
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType(filePath) });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
const clients = new Map();
let nextClientId = 1;

/**
 * WebSocket 连接处理
 * 每个浏览器客户端获得一个 clientId，然后可以在大厅中选择一个玩家槽位
 * 连接时发送 hello 消息（包含所有静态配置），断线时标记玩家离线
 */
wss.on("connection", (ws) => {
  const clientId = nextClientId++;
  clients.set(clientId, { ws, slot: null });
  send(ws, "hello", { protocolVersion, clientId, towerTypes, synthesisRules, difficultyOptions, playerRoles, buildAreas, pathRoutes, mainPathCells, gridSize, cols, rows, totalWaves, factionNames, factionIcons, gachaPool, pressureTypes });
  broadcastState();

  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    handleMessage(clientId, message);
  });

  ws.on("close", () => {
    const client = clients.get(clientId);
    if (client?.slot && game.players[client.slot]) {
      game.players[client.slot].connected = false;
      addLog(`${game.players[client.slot].name} 断开连接。`);
    }
    clients.delete(clientId);
    if (activePlayers().length === 0) {
      game = createGame();
    } else {
      updateHostSlot();
    }
    broadcastState();
  });
});

/**
 * handleMessage — WebSocket 消息分发
 * 故意使用显式 if 分支，方便审计和扩展新命令
 * 消息类型：
 * - join: 加入游戏槽位
 * - lobbyOptions: 房主设置难度/共享建造
 * - chat: 发送聊天消息
 * - ready: 准备/取消准备
 * - startWave: 房主开始游戏
 * - build: 建塔
 * - upgrade: 升级塔
 * - synthesize: 合成终极塔
 * - sell: 出售塔
 * - speed: 切换游戏速度
 * - reset: 重置游戏
 * - invest: 购买理财产品
 * - chooseWave: 波次选择
 * - sendPressure: 送怪
 * - useSkill: 释放塔技能
 * - gacha: 面试抽签
 * - buyShield: 购买反甩锅护盾
 */
function handleMessage(clientId, message) {
  const client = clients.get(clientId);
  if (!client) return;

  if (message.type === "join") joinSlot(clientId, message);
  if (message.type === "lobbyOptions") setLobbyOptions(clientId, message);
  if (message.type === "chat") handleChat(clientId, message);
  if (message.type === "ready") setReady(clientId, message.ready);
  if (message.type === "startWave") startWave(clientId);
  if (message.type === "build") buildTower(clientId, message);
  if (message.type === "upgrade") upgradeTower(clientId, message.towerId);
  if (message.type === "synthesize") synthesizeTower(clientId, message.towerId);
  if (message.type === "sell") sellTower(clientId, message.towerId);
  if (message.type === "speed") setSpeed(clientId, message.speed);
  if (message.type === "reset") resetGame(clientId);
  if (message.type === "invest") handleInvest(clientId, message);
  if (message.type === "chooseWave") handleChooseWave(clientId, message);
  if (message.type === "sendPressure") handleSendPressure(clientId, message);
  if (message.type === "useSkill") handleUseSkill(clientId, message);
  if (message.type === "gacha") handleGacha(clientId, message);
  if (message.type === "buyShield") handleBuyShield(clientId);
}

/**
 * joinSlot — 处理玩家加入槽位请求
 * 校验：游戏必须在大厅阶段、槽位有效、未被占用
 */
function joinSlot(clientId, message) {
  if (game.phase !== "lobby") {
    send(clients.get(clientId).ws, "error", { message: "游戏已经开始，只能观战。" });
    return;
  }
  const slot = Number(message.slot);
  if (!playerRoles[slot]) return;
  const existing = game.players[slot];
  if (existing?.connected && existing.clientId !== clientId) {
    send(clients.get(clientId).ws, "error", { message: "该位置已经有人。" });
    return;
  }
  const client = clients.get(clientId);
  if (client.slot && game.players[client.slot]?.clientId === clientId) delete game.players[client.slot];
  client.slot = slot;
  game.players[slot] = createPlayer(clientId, slot, String(message.name || ""));
  updateHostSlot();
  addLog(`${game.players[slot].name} 加入 ${slot} 号位。`);
  broadcastState();
}

/**
 * setLobbyOptions — 房主设置大厅选项（难度、共享建造）
 * 仅房主可操作，更新所有玩家的人口上限
 */
function setLobbyOptions(clientId, message) {
  if (!isHostClient(clientId) || game.phase !== "lobby") return;
  if (difficultyOptions[message.difficulty]) game.difficulty = message.difficulty;
  game.sharedBuild = Boolean(message.sharedBuild);
  activePlayers().forEach((player) => { player.populationLimit = difficultyOptions[game.difficulty].population; });
  addLog(`规则已更新：${difficultyOptions[game.difficulty].name} · ${game.sharedBuild ? "共享建造空间" : "各守岗位"}。`);
  broadcastState();
}

/**
 * handleChat — 处理聊天消息
 * 隐藏彩蛋：输入 "wd" 所有塔属性暴涨，输入 "bf" 金币+9999
 */
function handleChat(clientId, message) {
  const player = getPlayerByClient(clientId);
  if (!player) return;
  const text = String(message.text || "").trim().slice(0, 80);
  if (!text) return;
  if (text.toLowerCase() === "wd") {
    game.towers.forEach((tower) => {
      tower.damage += 9999;
      tower.range += 9999;
      tower.rate = Math.max(0.05, tower.rate * 0.1);
    });
    addLog(`${player.name} 输入 wd：所有职场塔属性暴涨。`, "chat");
    broadcastState();
    return;
  }
  if (text.toLowerCase() === "bf") {
    player.gold += 9999;
    addLog(`${player.name} 输入 bf：摸鱼时长 +9999。`, "chat");
    broadcastState();
    return;
  }
  addLog(`${player.name}：${text}`, "chat");
  broadcastState();
}

function setReady(clientId, ready) {
  const player = getPlayerByClient(clientId);
  if (!player || game.phase !== "lobby") return;
  player.ready = Boolean(ready);
  addLog(`${player.name}${player.ready ? "已准备" : "取消准备"}。`);
  broadcastState();
}

/**
 * startWave — 波次生命周期边界
 * 处理内容：
 * 1. 大厅→playing 阶段转换
 * 2. 昼夜/天气更新
 * 3. 随机事件触发（30%概率）
 * 4. 送怪系统处理
 * 5. 波次选择触发（每4波）
 * 6. 跳过波次处理（摸鱼时光）
 * 7. 敌人生成配置计算
 */
function startWave(clientId = null) {
  if (clientId && !isHostClient(clientId)) return;
  if (game.phase === "ended") return;
  if (game.phase === "lobby") {
    const active = activePlayers();
    if (active.length === 0 || active.some((player) => !player.ready)) return;
    game.phase = "playing";
    game.autoWaveTimer = 0;
  }
  if (game.spawning || game.enemies.length > 0) return;
  game.wave += 1;

  // ─── 昼夜/天气更新 ───
  game.timeOfDay = getTimeOfDay(game.wave);
  game.weather = rollWeather();
  // 递减事件持续时间
  game.activeEvents = game.activeEvents
    .map(e => ({ ...e, wavesLeft: e.wavesLeft - 1 }))
    .filter(e => e.wavesLeft > 0);
  // 随机事件触发（30%概率，第3波起，不在波次选择期间）
  if (Math.random() < 0.3 && game.wave > 2 && !game.waveChoiceActive) {
    const event = rollEvent();
    if (game.activeEvents.length < 2) {
      game.activeEvents.push({ ...event, wavesLeft: event.duration > 0 ? event.duration : 1 });
      addLog(`📢 事件：${event.icon} ${event.name} — ${event.desc}`);
      // 即时效果处理
      applyInstantEventEffects(event);
    }
  }
  // 处理事件中的跳过波次
  const skipEvent = game.activeEvents.find(e => e.effects?.skipNextWave);
  if (skipEvent) {
    addLog(`甲方消失！本波无敌人。`);
    game.autoWaveTimer = 8;
    game._interestPaidThisWave = true;
    broadcastState();
    return;
  }

  // ─── 送怪系统：处理待到达的送怪 ───
  for (let i = game.pendingPressure.length - 1; i >= 0; i--) {
    game.pendingPressure[i].arriveIn -= 1;
    if (game.pendingPressure[i].arriveIn <= 0) {
      spawnSentPressure(game.pendingPressure[i]);
      game.pendingPressure.splice(i, 1);
    }
  }
  // 递减送怪冷却
  for (const slot of Object.keys(game.pressureCooldowns)) {
    for (const type of Object.keys(game.pressureCooldowns[slot])) {
      game.pressureCooldowns[slot][type] -= 1;
      if (game.pressureCooldowns[slot][type] <= 0) delete game.pressureCooldowns[slot][type];
    }
  }
  // 递减护盾
  for (const slot of Object.keys(game.pressureShields)) {
    game.pressureShields[slot] -= 1;
    if (game.pressureShields[slot] <= 0) delete game.pressureShields[slot];
  }

  // ─── 波次选择触发：每4波 ───
  if (game.wave > 1 && game.wave % 4 === 0 && !game.waveChoiceActive) {
    triggerWaveChoice();
    return;
  }

  // 跳过波次（摸鱼时光）
  if (game.skipWavesLeft > 0) {
    game.skipWavesLeft -= 1;
    addLog(`摸鱼时光！剩余 ${game.skipWavesLeft} 波自由发育。`);
    game.autoWaveTimer = 8;
    game._interestPaidThisWave = true; // 防止重复发放利息
    // 发放每波额外金币
    if (game.goldPerWaveWaves > 0) {
      activePlayers().forEach(p => { p.gold += game.goldPerWaveBonus; });
      game.goldPerWaveWaves -= 1;
    }
    // 递减修改器
    decrementModifiers();
    broadcastState();
    return;
  }

  game.spawning = true;
  game.spawnTimer = 0;
  game.spawnCount = 0;
  game._interestPaidThisWave = false;
  const config = getWaveConfig(game.wave);
  addLog(`第 ${game.wave} 轮任务：${config.name} x ${config.count}。`);
  broadcastState();
}

/**
 * buildTower — 处理建塔请求
 * 校验：玩家有效、游戏未结束、格子有效、非路径、非已占、
 * 在可建区域、未超人口上限、金币足够
 */
function buildTower(clientId, message) {
  const player = getPlayerByClient(clientId);
  if (!player || game.phase === "ended") return;
  const type = towerTypes[message.towerType];
  const gridX = Number(message.gridX);
  const gridY = Number(message.gridY);
  if (!type || type.synthOnly) return;
  if (!Number.isInteger(gridX) || !Number.isInteger(gridY)) return;
  if (mainPathSet.has(`${gridX},${gridY}`)) return;
  if (game.towers.some((tower) => tower.gridX === gridX && tower.gridY === gridY)) return;
  if (!canBuildAt(player.slot, gridX, gridY)) return;
  const towerCount = game.towers.filter((tower) => tower.ownerSlot === player.slot).length;
  if (towerCount >= player.populationLimit) return;
  if (player.gold < type.cost) return;

  player.gold -= type.cost;
  game.towers.push({
    id: game.nextTowerId++,
    ownerSlot: player.slot,
    gridX,
    gridY,
    x: gridX * gridSize + gridSize / 2,
    y: gridY * gridSize + gridSize / 2,
    typeKey: message.towerType,
    level: 1,
    damage: type.damage,
    range: type.range,
    rate: type.rate,
    cooldown: 0,
    spent: type.cost,
    skillCooldown: 0,  // 塔主动技能冷却
  });
  addLog(`${player.name} 部署${type.name}。`);
  broadcastState();
}

/**
 * upgradeTower — 处理塔升级请求
 * 最高5级，每级伤害×1.42、射程+10、攻速×0.9（最低0.28秒）
 */
function upgradeTower(clientId, towerId) {
  const player = getPlayerByClient(clientId);
  const tower = game.towers.find((item) => item.id === towerId && item.ownerSlot === player?.slot);
  if (!player || !tower || tower.level >= 5) return;
  const cost = getUpgradeCost(tower);
  if (player.gold < cost) return;
  player.gold -= cost;
  tower.spent += cost;
  tower.level += 1;
  tower.damage *= 1.42;
  tower.range += 10;
  tower.rate = Math.max(0.28, tower.rate * 0.9);
  addLog(`${player.name} 强化${towerTypes[tower.typeKey].name}到 Lv.${tower.level}。`);
  broadcastState();
}

/**
 * sellTower — 处理塔出售请求
 * 退还65%已花费金币
 */
function sellTower(clientId, towerId) {
  const player = getPlayerByClient(clientId);
  const index = game.towers.findIndex((item) => item.id === towerId && item.ownerSlot === player?.slot);
  if (!player || index === -1) return;
  const tower = game.towers[index];
  const refund = Math.floor(tower.spent * 0.65);
  player.gold += refund;
  game.towers.splice(index, 1);
  addLog(`${player.name} 撤下${towerTypes[tower.typeKey].name}。`);
  broadcastState();
}

/**
 * synthesizeTower — 处理塔合成请求
 * 校验：所有材料塔都达到 Lv.5，合成后材料塔消失，在原位生成终极塔
 */
function synthesizeTower(clientId, towerId) {
  const player = getPlayerByClient(clientId);
  const selected = game.towers.find((item) => item.id === towerId && item.ownerSlot === player?.slot);
  if (!player || !selected) return;
  const ultimateKey = materialToUltimate[selected.typeKey];
  if (!ultimateKey) return;
  const materials = synthesisRules[ultimateKey];
  const materialTowers = materials.map((typeKey) => game.towers.find((tower) => tower.ownerSlot === player.slot && tower.typeKey === typeKey && tower.level >= 5));
  if (materialTowers.some((tower) => !tower)) return;
  const origin = materialTowers.find((tower) => tower.id === selected.id) || selected;
  game.towers = game.towers.filter((tower) => !materialTowers.some((material) => material.id === tower.id));
  const type = towerTypes[ultimateKey];
  game.towers.push({
    id: game.nextTowerId++,
    ownerSlot: player.slot,
    gridX: origin.gridX,
    gridY: origin.gridY,
    x: origin.x,
    y: origin.y,
    typeKey: ultimateKey,
    level: 1,
    damage: type.damage,
    range: type.range,
    rate: type.rate,
    cooldown: 0,
    spent: materialTowers.reduce((sum, tower) => sum + tower.spent, 0),
    skillCooldown: 0,
  });
  addLog(`${player.name} 合成${synthesisNames[ultimateKey]}。`);
  broadcastState();
}

function updateHostSlot() {
  const previous = game.hostSlot;
  const onlineSlots = Object.values(game.players)
    .filter((player) => player.connected)
    .map((player) => player.slot)
    .sort((a, b) => a - b);
  game.hostSlot = onlineSlots[0] || null;
  if (game.hostSlot && previous !== game.hostSlot) {
    const host = game.players[game.hostSlot];
    addLog(`房主已${previous ? "转移" : "分配"}给 ${game.hostSlot}号 ${host.name}。`);
  }
}

function isHostClient(clientId) {
  return game.hostSlot && game.players[game.hostSlot]?.clientId === clientId && game.players[game.hostSlot]?.connected;
}

function setSpeed(clientId, speed) {
  if (!isHostClient(clientId)) return;
  if (![1, 2, 3, 5, 10].includes(Number(speed))) return;
  game.speed = Number(speed);
  broadcastState();
}

function resetGame(clientId) {
  const client = clients.get(clientId);
  const canReset = isHostClient(clientId) || game.phase === "ended";
  if (!canReset) return;
  const oldPlayers = Object.values(game.players).filter((player) => player.connected);
  game = createGame();
  oldPlayers.forEach((player) => {
    const existingClient = clients.get(player.clientId);
    if (!existingClient) return;
    existingClient.slot = player.slot;
    game.players[player.slot] = createPlayer(player.clientId, player.slot, player.name);
  });
  if (client && !client.slot) client.slot = null;
  updateHostSlot();
  addLog("守护圈已重置。所有玩家请重新准备准点下班。");
  broadcastState();
}

// ─── 利息/投资系统 v1.0 ───
/**
 * handleInvest — 处理投资理财请求
 * 校验购买限制、金币是否足够，计算投资回报
 */
function handleInvest(clientId, message) {
  const player = getPlayerByClient(clientId);
  if (!player || game.phase !== "playing") return;
  const productId = message.productId;
  const product = investmentProducts[productId];
  if (!product) return;
  // 检查购买限制
  if (product.maxBuy && product.maxBuy !== Infinity) {
    const bought = player.investments.filter(inv => inv.productId === productId).length;
    if (bought >= product.maxBuy) return;
  }
  if (productId === "deposit" && player.depositUsed) return;
  if (player.gold < product.cost) return;

  player.gold -= product.cost;
  const investment = { productId, amount: product.cost, wavesLeft: product.waves };
  if (product.isRisky) {
    // 高风险理财：立即计算结果，延迟返还
    investment.returnGold = Math.random() < 0.5 ? 400 : 50;
  } else {
    investment.returnGold = product.returnGold;
  }
  player.investments.push(investment);
  if (productId === "deposit") player.depositUsed = true;
  addLog(`${player.name} 购买${product.name}（${product.cost}金）`);
  broadcastState();
}

/**
 * payInterest — 波次结束时发放利息和投资回报
 * 利息 = min(利息上限, 金币 × 利息率)
 * 同时处理投资产品到期返还和月光族debuff检测
 */
function payInterest(player) {
  const diff = difficultyOptions[game.difficulty];
  const interest = Math.min(diff.interestCap, Math.floor(player.gold * diff.interestRate));
  player.gold += interest;
  player.lastInterest = interest;

  // 处理投资回报
  for (let i = player.investments.length - 1; i >= 0; i--) {
    player.investments[i].wavesLeft -= 1;
    if (player.investments[i].wavesLeft <= 0) {
      player.gold += player.investments[i].returnGold;
      addLog(`${player.name} 收到${investmentProducts[player.investments[i].productId].name}回报 ${player.investments[i].returnGold}金`);
      player.investments.splice(i, 1);
    }
  }

  // 月光族检测
  if (player.gold <= 0) {
    player.zeroGoldWaves += 1;
    if (player.zeroGoldWaves >= 3) {
      player.moonlightDebuff = true;
      addLog(`${player.name} 月光族警告！存点钱吧~（全体塔攻速-10%）`);
    }
  } else {
    player.zeroGoldWaves = 0;
    player.moonlightDebuff = false;
  }

  return interest;
}

// ─── 波次选择 Roguelike v1.0 ───
/**
 * triggerWaveChoice — 触发波次选择（每4波）
 * 从选项池随机抽3个（去重），设置15秒决策时间
 */
function triggerWaveChoice() {
  game.waveChoiceActive = true;
  game.waveChoiceDeadline = Date.now() + 15000; // 15秒决策时间

  // 从选项池随机抽3个（去重）
  const available = waveChoicePool.filter(c => !game.usedChoiceIds.has(c.id));
  const pool = available.length >= 3 ? available : waveChoicePool; // 不够则重置
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  game.waveChoiceOptions = shuffled.slice(0, 3);

  addLog(`第 ${game.wave} 轮选择时间！请在15秒内做出选择。`);
  broadcastState();
}

function handleChooseWave(clientId, message) {
  if (!game.waveChoiceActive) return;
  const player = getPlayerByClient(clientId);
  if (!player) return;

  const optionId = message.optionId;
  const option = game.waveChoiceOptions.find(o => o.id === optionId);
  if (!option) return;

  applyWaveChoice(option, player);
}

/**
 * applyWaveChoice — 应用玩家选择的波次修改器
 * 处理敌人修改器、塔buff、各类奖励和特殊效果
 */
function applyWaveChoice(option, player) {
  game.waveChoiceActive = false;
  game.usedChoiceIds.add(option.id);

  addLog(`${player.name} 选择了「${option.name}」：${option.desc}`);

  // 应用敌人修改器
  if (option.enemyModifiers) {
    for (const mod of option.enemyModifiers) {
      const modifier = { ...mod };
      if (!modifier.wavesLeft) modifier.wavesLeft = 1;
      game.activeModifiers.push(modifier);
    }
  }

  // 应用塔buff
  if (option.towerBuffs) {
    for (const buff of option.towerBuffs) {
      game.towerBuffs.push({ ...buff });
    }
  }

  // 应用奖励
  if (option.rewards) {
    for (const reward of option.rewards) {
      applyReward(reward, player);
    }
  }

  // 处理额外精英怪
  const eliteMod = (option.enemyModifiers || []).find(m => m.eliteCount);
  if (eliteMod) {
    // 精英怪会在下一波通过修改器体现
    game.activeModifiers.push({ hpMult: 1.3, countMult: 1.2, wavesLeft: 1 });
  }

  // 处理无击杀金币
  const noKillMod = (option.enemyModifiers || []).find(m => m.noKillGold);
  if (noKillMod) {
    game.noKillGoldWaves = noKillMod.noKillGold;
  }

  // 处理每波额外金币
  const gpmReward = (option.rewards || []).find(r => r.type === "gold_per_wave");
  if (gpmReward) {
    game.goldPerWaveBonus = gpmReward.amount;
    game.goldPerWaveWaves = gpmReward.waves;
  }

  // 处理跳过波次
  const skipMod = (option.enemyModifiers || []).find(m => m.skipWaves);
  if (skipMod) {
    game.skipWavesLeft = skipMod.skipWaves;
  }

  // 处理不能卖塔
  const noSellReward = (option.rewards || []).find(r => r.type === "tower_buff" && option.id === "no_sell");
  if (noSellReward) {
    game._noSellWaves = 10;
    game.towers.forEach(t => { t.damage *= noSellReward.mult; });
  }

  broadcastState();
  // 继续下一波
  game.autoWaveTimer = 2;
}

/**
 * applyReward — 应用波次选择的奖励
 * 奖励类型：金币、人口、随机升级、全体升级、随机塔、终极塔、强制出售等
 */
function applyReward(reward, player) {
  switch (reward.type) {
    case "gold":
      player.gold += reward.amount;
      break;
    case "population":
      activePlayers().forEach(p => { p.populationLimit += reward.amount; });
      break;
    case "upgrade_random": {
      const playerTowers = game.towers.filter(t => t.ownerSlot === player.slot && t.level < 5);
      const shuffled = [...playerTowers].sort(() => Math.random() - 0.5);
      shuffled.slice(0, reward.count).forEach(t => {
        t.level += 1;
        t.damage *= 1.42;
        t.range += 10;
        t.rate = Math.max(0.28, t.rate * 0.9);
      });
      break;
    }
    case "upgrade_all":
      game.towers.filter(t => t.ownerSlot === player.slot).forEach(t => {
        for (let l = 0; l < reward.levels; l++) {
          if (t.level < 5) {
            t.level += 1;
            t.damage *= 1.42;
            t.range += 10;
            t.rate = Math.max(0.28, t.rate * 0.9);
          }
        }
      });
      break;
    case "tower_buff":
      // 永久buff已在外层处理
      break;
    case "random_towers": {
      const buildable = Object.entries(towerTypes).filter(([, t]) => !t.synthOnly && !t.ultimate);
      for (let c = 0; c < reward.count; c++) {
        const [typeKey] = buildable[Math.floor(Math.random() * buildable.length)];
        const areas = buildAreas[player.slot];
        if (!areas) break;
        const area = areas[0];
        // 找一个空位
        let placed = false;
        for (let gx = area.minX; gx <= area.maxX && !placed; gx++) {
          for (let gy = area.minY; gy <= area.maxY && !placed; gy++) {
            if (!mainPathSet.has(`${gx},${gy}`) && !game.towers.some(t => t.gridX === gx && t.gridY === gy)) {
              const type = towerTypes[typeKey];
              game.towers.push({
                id: game.nextTowerId++, ownerSlot: player.slot, gridX: gx, gridY: gy,
                x: gx * gridSize + gridSize / 2, y: gy * gridSize + gridSize / 2,
                typeKey, level: 1, damage: type.damage, range: type.range, rate: type.rate, cooldown: 0, spent: 0,
              });
              placed = true;
            }
          }
        }
      }
      break;
    }
    case "random_ultimate": {
      const ultimates = Object.keys(towerTypes).filter(k => towerTypes[k].synthOnly);
      const ultKey = ultimates[Math.floor(Math.random() * ultimates.length)];
      if (player.gold < 100) break;
      player.gold -= 100;
      const areas = buildAreas[player.slot];
      if (areas) {
        const area = areas[0];
        for (let gx = area.minX; gx <= area.maxX; gx++) {
          for (let gy = area.minY; gy <= area.maxY; gy++) {
            if (!mainPathSet.has(`${gx},${gy}`) && !game.towers.some(t => t.gridX === gx && t.gridY === gy)) {
              const type = towerTypes[ultKey];
              game.towers.push({
                id: game.nextTowerId++, ownerSlot: player.slot, gridX: gx, gridY: gy,
                x: gx * gridSize + gridSize / 2, y: gy * gridSize + gridSize / 2,
                typeKey: ultKey, level: 1, damage: type.damage, range: type.range, rate: type.rate, cooldown: 0, spent: 100,
              });
              break;
            }
          }
        }
      }
      break;
    }
    case "sell_required": {
      const playerTowers = game.towers.filter(t => t.ownerSlot === player.slot);
      const toSell = [...playerTowers].sort(() => Math.random() - 0.5).slice(0, reward.count);
      toSell.forEach(t => {
        const idx = game.towers.findIndex(tw => tw.id === t.id);
        if (idx >= 0) {
          player.gold += Math.floor(t.spent * 0.65);
          game.towers.splice(idx, 1);
        }
      });
      break;
    }
    case "gold_mult":
      // 标记下一波金币倍率
      game.activeModifiers.push({ goldMult: reward.mult, wavesLeft: 1 });
      break;
    case "kill_gold_bonus":
      game.activeModifiers.push({ killGoldBonus: reward.amount, wavesLeft: 1 });
      break;
  }
}

/**
 * decrementModifiers — 递减波次修改器和塔buff的持续时间
 * 每波结束时调用，归零后移除
 */
function decrementModifiers() {
  game.activeModifiers = game.activeModifiers
    .map(m => ({ ...m, wavesLeft: (m.wavesLeft || 1) - 1 }))
    .filter(m => m.wavesLeft > 0);
  game.towerBuffs = game.towerBuffs
    .map(b => ({ ...b, wavesLeft: (b.wavesLeft || 1) - 1 }))
    .filter(b => b.wavesLeft > 0);
  if (game.noKillGoldWaves > 0) game.noKillGoldWaves -= 1;
  if (game.goldPerWaveWaves > 0) {
    activePlayers().forEach(p => { p.gold += game.goldPerWaveBonus; });
    game.goldPerWaveWaves -= 1;
  }
  if (game._noSellWaves > 0) game._noSellWaves -= 1;
}

/**
 * canBuildAt — 检查指定网格坐标是否可建塔
 * 校验：在可建区域内 + 非路径 + 非已占格
 */
function canBuildAt(slot, gridX, gridY) {
  const areas = game.sharedBuild ? Object.values(buildAreas).flat() : buildAreas[slot];
  if (!areas) return false;
  return Number.isInteger(gridX)
    && Number.isInteger(gridY)
    && areas.some((area) => gridX >= area.minX && gridX <= area.maxX && gridY >= area.minY && gridY <= area.maxY)
    && !mainPathSet.has(`${gridX},${gridY}`)
    && !game.towers.some((tower) => tower.gridX === gridX && tower.gridY === gridY);
}

/**
 * update — 主逻辑帧更新（每 tick 调用）
 * 更新顺序：
 * 1. 波次选择超时处理
 * 2. 自动波次计时
 * 3. 敌人生成
 * 4. 敌人移动和特殊能力
 * 5. 塔攻击和弹道生成
 * 6. 弹道飞行和命中
 * 7. 特效生命周期
 * 8. 波次结束利息发放
 */
function update(dt) {
  if (game.phase !== "playing") return;

  // ─── 波次选择超时处理 ───
  if (game.waveChoiceActive) {
    if (Date.now() > game.waveChoiceDeadline) {
      // 超时随机选择
      const option = game.waveChoiceOptions[Math.floor(Math.random() * game.waveChoiceOptions.length)];
      const anyPlayer = activePlayers()[0];
      if (option && anyPlayer) applyWaveChoice(option, anyPlayer);
      addLog("选择超时，随机应用！");
    }
    return; // 选择期间暂停游戏
  }

  updateAutoWave(dt);
  updateSpawning(dt);
  updateEnemies(dt);
  updateTowers(dt);
  updateProjectiles(dt);
  updateEffects(dt);

  // ─── 利息/投资系统 v1.0：波次结束时发放利息 ───
  if (game.wave > 0 && !game.spawning && game.enemies.length === 0 && !game._interestPaidThisWave) {
    game._interestPaidThisWave = true;
    activePlayers().forEach(player => {
      const interest = payInterest(player);
      if (interest > 0) addLog(`${player.name} 收到利息 ${interest}金`);
    });
    // 递减波次修改器
    decrementModifiers();
    broadcastState();
  }

  // 无尽模式不在固定波次后结束。
  if (false) {
    game.phase = "ended";
    addLog("防守成功，全部波次已完成。");
  }
}

function updateAutoWave(dt) {
  if (game.phase !== "playing" || game.spawning || game.enemies.length > 0) return;
  game.autoWaveTimer -= dt;
  if (game.autoWaveTimer <= 0) startWave();
}

function updateSpawning(dt) {
  if (!game.spawning) return;
  const config = getWaveConfig(game.wave);
  game.spawnTimer -= dt;
  if (game.spawnTimer <= 0 && game.spawnCount < config.count) {
    spawnEnemy(config);
    game.spawnCount += 1;
    game.spawnTimer = config.interval;
  }
  if (game.spawnCount >= config.count) {
    game.spawning = false;
    game.autoWaveTimer = getAutoWaveDelay(config);
  }
}

function getAutoWaveDelay(config) {
  const routeSeconds = (mainPathCells.length * gridSize) / Math.max(1, config.speed);
  return routeSeconds + difficultyOptions[game.difficulty].delay;
}

/**
 * spawnEnemy — 在每条路径的入口生成一个敌人
 * 敌人属性从波次配置继承，特殊波次额外添加特殊能力
 */
function spawnEnemy(config) {
  Object.entries(pathRoutes).forEach(([slot, route]) => {
    const [x, y] = route[0];
    const special = config.special || {};
    const enemy = {
      id: game.nextEnemyId++,
      route,
      waveNumber: game.wave,
      name: config.name,
      x: x * gridSize + gridSize / 2,
      y: y * gridSize + gridSize / 2,
      pathIndex: 0,
      hp: Math.round(config.hp * 0.78),
      maxHp: Math.round(config.hp * 0.78),
      baseSpeed: config.speed,
      reward: Math.max(2, Math.round(config.reward * 0.45)),
      armor: config.armor,
      armorType: config.armorType,
      color: config.color,
      slowTimer: 0,
      slowFactor: 1,
      poisonTimer: 0,
      poisonDamage: 0,
      lastHitSlot: Number(slot),
      // ─── 特殊波次属性 ───
      splitCount: special.splitCount || 0,
      invisible: special.invisible || false,
      semiInvisible: special.semiInvisible || false,
      auraType: special.auraType || null,
      accelerate: special.accelerate || false,
      regenRate: special.regenRate || 0,
      flashInterval: special.flashInterval || 0,
      flashDistance: special.flashDistance || 0,
      flashTimer: special.flashInterval || 0,
      survivalTime: 0,
    };
    game.enemies.push(enemy);
  });
}

/**
 * updateEnemies — 更新所有敌人状态
 * 处理内容：
 * 1. 光环效果计算（护甲/速度/回复光环）
 * 2. 减速/毒debuff递减
 * 3. 回复能力（每秒回复最大HP百分比）
 * 4. 加速能力（每秒移速+5%）
 * 5. 闪现能力（周期性向前跳跃）
 * 6. 死亡处理（金币奖励、分裂能力）
 * 7. 到达终点处理（扣生命、判断游戏结束）
 */
function updateEnemies(dt) {
  // ─── 应用光环效果（每帧重置后重新计算）───
  game.enemies.forEach(e => { e._auraArmorBonus = 0; e._auraSpeedBonus = 0; e._auraRegenBonus = 0; });
  game.enemies.forEach(e => {
    if (e.auraType === "armor") {
      game.enemies.forEach(ally => {
        if (ally.id !== e.id && distance(e, ally) < 100) ally._auraArmorBonus = Math.max(ally._auraArmorBonus, 0.5);
      });
    }
    if (e.auraType === "speed") {
      game.enemies.forEach(ally => {
        if (ally.id !== e.id && distance(e, ally) < 100) ally._auraSpeedBonus = Math.max(ally._auraSpeedBonus, 0.2);
      });
    }
    if (e.auraType === "regen") {
      game.enemies.forEach(ally => {
        if (ally.id !== e.id && distance(e, ally) < 100) ally._auraRegenBonus = Math.max(ally._auraRegenBonus, 0.05);
      });
    }
  });

  for (let i = game.enemies.length - 1; i >= 0; i -= 1) {
    const enemy = game.enemies[i];
    enemy.survivalTime = (enemy.survivalTime || 0) + dt;
    if (enemy.slowTimer > 0) enemy.slowTimer -= dt;
    else enemy.slowFactor = 1;
    if (enemy.poisonTimer > 0) {
      enemy.poisonTimer -= dt;
      enemy.hp -= enemy.poisonDamage * dt;
    }
    // 腐蚀塔debuff：持续降低护甲
    if (enemy.armorDebuffTimer > 0) {
      enemy.armorDebuffTimer -= dt;
      enemy.armor = Math.max(0.3, (enemy.armor || 1) - (enemy.armorDebuff || 0) * dt);
    }

    // ─── 回复能力：每秒回复最大HP百分比 ───
    if (enemy.regenRate > 0 || enemy._auraRegenBonus > 0) {
      const totalRegen = (enemy.regenRate || 0) + (enemy._auraRegenBonus || 0);
      enemy.hp = Math.min(enemy.maxHp, enemy.hp + enemy.maxHp * totalRegen * dt);
    }

    // ─── 加速能力：每秒移速+5% ───
    if (enemy.accelerate) {
      enemy.baseSpeed *= (1 + 0.05 * dt);
    }

    // ─── 闪现能力：周期性向前闪现 ───
    if (enemy.flashInterval > 0) {
      enemy.flashTimer -= dt;
      if (enemy.flashTimer <= 0) {
        enemy.flashTimer = enemy.flashInterval;
        const route = enemy.route || mainPathCells;
        const newIndex = Math.min(enemy.pathIndex + enemy.flashDistance, route.length - 2);
        if (newIndex > enemy.pathIndex) {
          const cell = route[newIndex];
          enemy.pathIndex = newIndex;
          enemy.x = cell[0] * gridSize + gridSize / 2;
          enemy.y = cell[1] * gridSize + gridSize / 2;
          game.effects.push({ x: enemy.x, y: enemy.y, radius: 20, life: 0.3, color: "rgba(243,156,18,.5)" });
        }
      }
    }

    if (enemy.hp <= 0) {
      const player = game.players[enemy.lastHitSlot];
      const goldBonus = (game._activeSynergies || []).some(s => s.name.includes("摸鱼同盟")) ? 5 : 0;
      // 日报塔技能：周报风暴 → 击杀金币×2
      const hasGoldBoost = game.towers.some(t => t.ownerSlot === enemy.lastHitSlot && (t._goldBoostTimer || 0) > 0);
      const goldMult = hasGoldBoost ? 2 : 1;
      const killGold = game.noKillGoldWaves > 0 ? 0 : (enemy.reward + goldBonus) * goldMult;
      if (player) player.gold += killGold;
      game.towers.forEach((tower) => {
        if (tower.ownerSlot !== enemy.lastHitSlot) return;
        const type = towerTypes[tower.typeKey];
        if (type.growthType === "damage") tower.damage += 2;
        if (type.growthType === "gold" && player) player.gold += 3;
      });
      game.effects.push({ x: enemy.x, y: enemy.y, radius: 21, life: 0.25, color: "rgba(255,226,102,.5)" });

      // ─── 分裂能力：死亡后分裂 ───
      if (enemy.splitCount > 0) {
        const route = enemy.route || mainPathCells;
        for (let s = 0; s < 2; s++) {
          const splitEnemy = {
            ...enemy,
            id: game.nextEnemyId++,
            hp: Math.round(enemy.maxHp * 0.5),
            maxHp: Math.round(enemy.maxHp * 0.5),
            splitCount: enemy.splitCount - 1,
            pathIndex: Math.max(0, enemy.pathIndex - 1),
            x: enemy.x + (s === 0 ? -8 : 8),
            y: enemy.y + (s === 0 ? -8 : 8),
            baseSpeed: enemy.baseSpeed * 1.15,
            reward: Math.max(1, Math.floor(enemy.reward * 0.4)),
            survivalTime: 0,
            slowTimer: 0,
            slowFactor: 1,
          };
          game.enemies.push(splitEnemy);
        }
        game.effects.push({ x: enemy.x, y: enemy.y, radius: 28, life: 0.3, color: "rgba(255,107,157,.5)" });
      }

      game.enemies.splice(i, 1);
      continue;
    }
    moveEnemy(enemy, dt);
    const route = enemy.route || mainPathCells;
    if (enemy.pathIndex >= route.length - 1) {
      game.enemies.splice(i, 1);
      const damage = enemy.name === "年终 KPI" ? 5 : 1;
      activePlayers().forEach((player) => {
        player.lives = Math.max(0, player.lives - damage);
      });
      if (activePlayers().some((player) => player.lives <= 0)) {
        game.phase = "ended";
        addLog("工作压力突破防线，全队被迫加班。");
      }
    }
  }
}

/**
 * moveEnemy — 移动敌人到路径下一个格子
 * 根据基础速度、减速因子和帧时间计算位移
 */
function moveEnemy(enemy, dt) {
  const route = enemy.route || mainPathCells;
  const targetCell = route[enemy.pathIndex + 1];
  if (!targetCell) return;
  const target = { x: targetCell[0] * gridSize + gridSize / 2, y: targetCell[1] * gridSize + gridSize / 2 };
  const dx = target.x - enemy.x;
  const dy = target.y - enemy.y;
  const length = Math.hypot(dx, dy);
  const step = enemy.baseSpeed * enemy.slowFactor * dt;
  if (step >= length) {
    enemy.x = target.x;
    enemy.y = target.y;
    enemy.pathIndex += 1;
    return;
  }
  enemy.x += (dx / length) * step;
  enemy.y += (dy / length) * step;
}

/**
 * updateTowers — 更新所有塔状态
 * 处理内容：
 * 1. 光环效果计算（咖啡塔/摸鱼群塔/摸鱼仙人）
 * 2. 阵营羁绊buff应用
 * 3. 天气/事件对塔的影响
 * 4. 冷却递减和攻击判定
 * 5. 目标查找和弹道生成
 */
function updateTowers(dt) {
  game.towers.forEach((tower) => { tower.auraSpeedBuff = 1; tower.auraDamageBuff = 0; tower.synergySpeedMult = 1; tower.synergyDamageMult = 1; tower.synergyRangeMult = 1; });
  const hasImmortal = game.towers.some((tower) => towerTypes[tower.typeKey].auraType === "global_double");
  game.towers.forEach((tower) => {
    const type = towerTypes[tower.typeKey];
    if (type.auraType === "global_double") return;
    if (!type.isAura) return;
    game.towers.forEach((ally) => {
      if (ally.id === tower.id) return;
      if (distance(tower, ally) <= tower.range) {
        if (type.auraType === "speed") ally.auraSpeedBuff = Math.min(ally.auraSpeedBuff, 0.8);
        if (type.auraType === "damage") ally.auraDamageBuff = Math.max(ally.auraDamageBuff, 0.15);
      }
    });
  });
  if (hasImmortal) {
    game.towers.forEach((tower) => {
      if (towerTypes[tower.typeKey].ultimate) return;
      tower.auraSpeedBuff = Math.min(tower.auraSpeedBuff, 0.5);
      tower.auraDamageBuff = Math.max(tower.auraDamageBuff, 1);
    });
  }

  // ─── 应用阵营羁绊buff v1.0 ───
  const synergyResult = calculateSynergies(game.towers);
  game._activeSynergies = synergyResult.activeSynergies;
  game._factionCounts = synergyResult.factionCounts;
  const synBuffs = synergyResult.buffs;
  game.towers.forEach((tower) => {
    if (towerTypes[tower.typeKey].ultimate) return; // 终极塔不受羁绊影响
    const faction = towerTypes[tower.typeKey].faction;
    if (!faction) return;
    // 只有同阵营的塔受同阵营羁绊影响
    const count = synergyResult.factionCounts[faction] || 0;
    if (count >= 2) tower.synergySpeedMult = Math.min(tower.synergySpeedMult, 0.9);
    if (count >= 4) tower.synergyDamageMult = Math.max(tower.synergyDamageMult, 1.2);
    if (count >= 6) tower.synergyRangeMult = Math.max(tower.synergyRangeMult, 1.15);
    // 跨阵营组合（全体影响）
    tower.synergySpeedMult *= (synBuffs.speedMult / (tower.synergySpeedMult !== 1 ? tower.synergySpeedMult : 1));
    tower.synergyDamageMult = synBuffs.damageMult;
    tower.synergyRangeMult = synBuffs.rangeMult;
  });

  // ─── 应用天气对塔的影响 ───
  const weatherEffects = game.weather?.effects || {};
  const towerRangeMult = weatherEffects.towerRangeMult || 1;
  const weatherTowerSpeedMult = weatherEffects.towerSpeedMult || 1;
  const weatherDamageBonus = weatherEffects.damageBonus || 1;
  const towerAllMult = weatherEffects.towerAllMult || 1;
  // 事件对塔的影响
  let eventTowerSpeedMult = 1;
  let eventBuildCostMult = 1;
  let eventDisableAura = false;
  for (const evt of game.activeEvents) {
    const eff = evt.effects || {};
    if (eff.towerSpeedBuff) eventTowerSpeedMult *= eff.towerSpeedBuff;
    if (eff.towerSpeedPenalty) eventTowerSpeedMult *= eff.towerSpeedPenalty;
    if (eff.buildCostMult) eventBuildCostMult *= eff.buildCostMult;
    if (eff.disableAura) eventDisableAura = true;
  }
  game._eventBuildCostMult = eventBuildCostMult;

  game.towers.forEach((tower) => {
    const type = towerTypes[tower.typeKey];
    if (type.isAura && !type.layflat) return;
    // 天气/事件光环禁用
    if (type.isAura && eventDisableAura) return;
    tower.cooldown -= dt;
    if (tower.cooldown > 0) return;
    if (type.layflat) {
      tower.cooldown = tower.rate;
      triggerLayflat(tower);
      return;
    }
    const target = findTarget(tower);
    if (!target) return;
    // 融合：光环速度buff × 羁绊速度buff × 月光族debuff
    const owner = game.players[tower.ownerSlot];
    const moonlightPenalty = (owner && owner.moonlightDebuff) ? 0.9 : 1;
    // 技能CD递减
    if (tower.skillCooldown > 0) tower.skillCooldown -= dt;
    // 技能boost计时器递减
    if (tower._caffeineBoostTimer > 0) tower._caffeineBoostTimer -= dt;
    if (tower._slackerBoostTimer > 0) tower._slackerBoostTimer -= dt;
    if (tower._goldBoostTimer > 0) tower._goldBoostTimer -= dt;
    if (tower._immortalBoostTimer > 0) tower._immortalBoostTimer -= dt;
    if (tower._puaImmuneTimer > 0) tower._puaImmuneTimer -= dt;
    if (tower._splashBoostHits > 0) {} // 不递减，命中时消耗
    if (tower._reflectBoostHits > 0) {} // 不递减，命中时消耗
    // 紧急加班：攻速翻倍
    const caffeineBoost = (tower._caffeineBoostTimer > 0) ? 0.5 : 1;
    // 全员摸鱼：攻击力×3
    const immortalDmgBoost = (tower._immortalBoostTimer > 0) ? 3 : 1;
    // 集体摸鱼：攻击力+50%
    const slackerDmgBoost = (tower._slackerBoostTimer > 0) ? 0.5 : 0;
    const totalSpeedMult = tower.auraSpeedBuff * (tower.synergySpeedMult || 1) * moonlightPenalty * eventTowerSpeedMult * weatherTowerSpeedMult * towerAllMult * caffeineBoost;
    tower.cooldown = tower.rate * totalSpeedMult;
    const totalDamageMult = (1 + (tower.auraDamageBuff || 0) + slackerDmgBoost) * immortalDmgBoost;
    game.projectiles.push({ id: game.nextProjectileId++, x: tower.x, y: tower.y, targetId: target.id, towerId: tower.id, speed: type.splash ? 460 : 620, color: type.color, damageBonus: tower.auraDamageBuff, synergyDamageMult: tower.synergyDamageMult || 1, skillDamageMult: totalDamageMult, splashBoostHits: tower._splashBoostHits || 0, reflectBoostHits: tower._reflectBoostHits || 0, goldBoostTimer: tower._goldBoostTimer || 0 });
  });
}

/**
 * triggerLayflat — 躺平大神技能效果
 * 清除场上最多 8+level×2 个普通敌人
 * Boss受到最大HP 8%的伤害
 */
function triggerLayflat(tower) {
  const normals = game.enemies.filter((enemy) => enemy.name !== "年终 KPI");
  normals.slice(0, 8 + tower.level * 2).forEach((enemy) => {
    enemy.hp = 0;
    enemy.lastHitSlot = tower.ownerSlot;
    game.effects.push({ x: enemy.x, y: enemy.y, radius: 24, life: 0.22, color: "rgba(185,140,255,.45)" });
  });
  game.enemies.forEach((enemy) => {
    if (enemy.name !== "年终 KPI") return;
    enemy.hp -= enemy.maxHp * 0.08;
    enemy.lastHitSlot = tower.ownerSlot;
  });
}

/**
 * findTarget — 为塔寻找最优攻击目标
 * 选择路径进度最远的敌人（优先击杀即将到达终点的）
 * 隐身敌人需要日报塔才能发现
 */
function findTarget(tower) {
  let best = null;
  let bestProgress = -1;
  const effectiveRange = tower.range * (tower.synergyRangeMult || 1);
  const type = towerTypes[tower.typeKey];
  game.enemies.forEach((enemy) => {
    if (distance(tower, enemy) > effectiveRange) return;
    // ─── 隐身判定 ───
    if (enemy.invisible && !type.revealInvisible) return;
    if (enemy.semiInvisible && !type.revealInvisible && Math.random() < 0.5) return;
    const progress = enemy.pathIndex * 10000 + enemy.x + enemy.y;
    if (progress > bestProgress) {
      best = enemy;
      bestProgress = progress;
    }
  });
  return best;
}

/**
 * updateProjectiles — 更新弹道飞行
 * 弹丸追踪目标，到达后调用 hitEnemy 计算伤害
 */
function updateProjectiles(dt) {
  for (let i = game.projectiles.length - 1; i >= 0; i -= 1) {
    const projectile = game.projectiles[i];
    const tower = game.towers.find((item) => item.id === projectile.towerId);
    const target = game.enemies.find((enemy) => enemy.id === projectile.targetId);
    if (!tower || !target) {
      game.projectiles.splice(i, 1);
      continue;
    }
    const dx = target.x - projectile.x;
    const dy = target.y - projectile.y;
    const length = Math.hypot(dx, dy);
    const step = projectile.speed * dt;
    if (step >= length) {
      hitEnemy(tower, target, projectile.damageBonus || 0, projectile.synergyDamageMult || 1, {
        skillDamageMult: projectile.skillDamageMult || 1,
        splashBoostHits: projectile.splashBoostHits || 0,
        reflectBoostHits: projectile.reflectBoostHits || 0,
        goldBoostTimer: projectile.goldBoostTimer || 0,
      });
      game.projectiles.splice(i, 1);
      continue;
    }
    projectile.x += (dx / length) * step;
    projectile.y += (dy / length) * step;
  }
}

/**
 * hitEnemy — 弹丸命中敌人处理
 * 计算最终伤害（基础伤害 × 护甲 × 克制倍率 × 光环buff × 羁绊buff × 技能buff）
 * 处理特殊效果：溅射、反射扩散、减速、毒
 */
function hitEnemy(tower, target, damageBonus, synergyDamageMult, skillBoosts) {
  const type = towerTypes[tower.typeKey];
  const multiplier = getDamageMultiplier(type.damageType, target.armorType || "physical");
  const dmgBonus = 1 + (damageBonus || 0);
  const synDmg = synergyDamageMult || 1;
  const skillDmg = (skillBoosts && skillBoosts.skillDamageMult) || 1;
  let finalDamage = tower.damage * target.armor * multiplier * dmgBonus * synDmg * skillDmg;
  if (type.holyBonus && target.armorType === "holy") finalDamage *= type.holyBonus;
  if (type.executeChance && target.name !== "年终 KPI" && Math.random() < type.executeChance + tower.level * 0.02) {
    finalDamage = target.hp;
  }
  if (type.bossPercentDamage && target.name === "年终 KPI") {
    finalDamage += target.maxHp * type.bossPercentDamage;
  }
  // 反甩锅塔技能：甩锅反弹 → 下次攻击伤害×10
  if (skillBoosts && skillBoosts.reflectBoostHits > 0 && tower._reflectBoostHits > 0) {
    finalDamage *= 10;
    tower._reflectBoostHits -= 1;
  }
  // 划水塔技能：范围划水 → 下3次攻击范围翻倍
  let splashMult = 1;
  if (skillBoosts && skillBoosts.splashBoostHits > 0 && tower._splashBoostHits > 0) {
    splashMult = 2;
    tower._splashBoostHits -= 1;
  }
  // 金币boost：击杀金币×2
  const goldBoost = (skillBoosts && skillBoosts.goldBoostTimer > 0) ? 2 : 1;
  // PUA免疫：权威型压力伤害归零
  if (tower._puaImmuneTimer > 0 && target.armorType === "holy") {
    finalDamage = 0;
  }
  if (type.splash) {
    game.enemies.forEach((enemy) => {
      if (distance(target, enemy) <= (type.splash + tower.level * 5) * splashMult) {
        const m = getDamageMultiplier(type.damageType, enemy.armorType || "physical");
        let splashDamage = tower.damage * enemy.armor * m * dmgBonus * synDmg * skillDmg;
        if (type.holyBonus && enemy.armorType === "holy") splashDamage *= type.holyBonus;
        enemy.hp -= splashDamage;
        enemy.lastHitSlot = tower.ownerSlot;
      }
    });
    game.effects.push({ x: target.x, y: target.y, radius: Math.min((type.splash + tower.level * 6) * splashMult, 420), life: 0.2, color: "rgba(255,155,64,.35)" });
    return;
  }
  target.hp -= finalDamage;
  target.lastHitSlot = tower.ownerSlot;
  if (type.reflectSplash) {
    game.enemies.forEach((enemy) => {
      if (enemy.id === target.id || distance(target, enemy) > (type.reflectSplash + tower.level * 4) * splashMult) return;
      let reflectDmg = finalDamage * 0.45;
      // 甩锅反弹时，扩散伤害也×10
      if (skillBoosts && skillBoosts.reflectBoostHits >= 0 && tower._reflectBoostHits >= 0) {
        reflectDmg = finalDamage * 0.45;
      }
      enemy.hp -= reflectDmg;
      enemy.lastHitSlot = tower.ownerSlot;
    });
    game.effects.push({ x: target.x, y: target.y, radius: (type.reflectSplash + tower.level * 4) * splashMult, life: 0.2, color: "rgba(255,107,107,.35)" });
  }
  if (type.slow) {
    target.slowFactor = type.slow;
    target.slowTimer = type.slowTime + tower.level * 0.12;
  }
  if (type.poison) {
    target.poisonDamage = type.poison + tower.level * 4;
    target.poisonTimer = type.poisonTime;
  }
  game.effects.push({ x: target.x, y: target.y, radius: 14, life: 0.16, color: "rgba(210,255,169,.35)" });
}

/**
 * updateEffects — 更新临时特效生命周期
 * life 归零后移除
 */
function updateEffects(dt) {
  for (let i = game.effects.length - 1; i >= 0; i -= 1) {
    game.effects[i].life -= dt;
    if (game.effects[i].life <= 0) game.effects.splice(i, 1);
  }
}

/**
 * getWaveConfig — 计算指定波次的敌人配置
 * 综合考虑：难度、昼夜、天气、随机事件、Roguelike修改器
 * @param {number} waveNumber - 波次号
 * @returns {Object} 波次配置（名称、数量、HP、速度、奖励、护甲等）
 */
function getWaveConfig(waveNumber) {
  const boss = waveNumber % 5 === 0;
  const airship = waveNumber % 7 === 0 && !boss;
  const tank = waveNumber % 6 === 0 && !boss && !airship;
  const fast = waveNumber % 4 === 0 && !boss && !airship && !tank;
  const heavy = waveNumber % 3 === 0 && !boss && !airship && !tank;
  // 每波指定护甲类型，循环：物理→魔法→抗性→神圣
  const armorCycle = ["physical", "magic", "resistance", "holy"];
  const armorType = boss ? "holy" : armorCycle[(waveNumber - 1) % 4];
  const difficulty = difficultyOptions[game.difficulty];
  const baseHp = Math.round((boss ? 390 : tank ? 174 : heavy ? 95 : 58) * Math.pow(1.15, waveNumber - 1) * difficulty.hp);

  // ─── 特殊波次：每5波出现特殊怪 ───
  let special = null;
  if (waveNumber >= 5 && waveNumber % 5 === 0 && !boss) {
    special = specialWaveTypes[Math.floor(waveNumber / 5) % specialWaveTypes.length];
  }

  let config = {
    name: boss ? "年终 KPI" : special ? special.name : airship ? "空降任务" : tank ? "大型项目" : fast ? "临时插单" : heavy ? "历史包袱" : "日常待办",
    count: Math.ceil((boss ? 1 + Math.floor(waveNumber / 10) : 10 + waveNumber * 3) * difficulty.count),
    hp: airship ? Math.round(baseHp * 0.6) : baseHp,
    speed: boss ? 34 : airship ? 90 : tank ? 30 : fast ? 78 : heavy ? 38 : 52,
    reward: Math.round((boss ? 85 + waveNumber * 8 : airship ? 12 + Math.floor(waveNumber * 2) : tank ? 18 + Math.floor(waveNumber * 2.5) : 8 + Math.floor(waveNumber * 1.5)) * difficulty.reward),
    armor: tank ? 0.5 : heavy ? 0.82 : 1,
    armorType,
    armorTypeName: armorTypes[armorType],
    interval: boss ? 1.2 : airship ? 0.4 : tank ? 0.9 : 0.55,
    color: boss ? "#b14cff" : special ? special.color : airship ? "#73e6ff" : tank ? "#ff9b6a" : fast ? "#ffe266" : heavy ? "#c66f45" : "#ff5656",
    // 特殊波次属性
    special: special ? { ...special } : null,
    specialDesc: special ? special.desc : null,
  };

  // ─── 应用昼夜效果 ───
  const timeMod = getTimeModifiers(game.timeOfDay);
  config.hp = Math.round(config.hp * timeMod.hpMult);
  config.speed = Math.round(config.speed * timeMod.speedMult);
  config.reward = Math.round(config.reward * timeMod.rewardMult);

  // ─── 应用天气效果 ───
  const weatherEffects = game.weather?.effects || {};
  if (weatherEffects.enemySpeedMult) config.speed = Math.round(config.speed * weatherEffects.enemySpeedMult);
  if (weatherEffects.enemyHpMult) config.hp = Math.round(config.hp * weatherEffects.enemyHpMult);
  if (weatherEffects.enemyCountMult) config.count = Math.ceil(config.count * weatherEffects.enemyCountMult);

  // ─── 应用随机事件效果 ───
  for (const evt of game.activeEvents) {
    const eff = evt.effects || {};
    if (eff.enemySpeedMult) config.speed = Math.round(config.speed * eff.enemySpeedMult);
    if (eff.enemyHpMult) config.hp = Math.round(config.hp * eff.enemyHpMult);
    if (eff.enemyCountMult) config.count = Math.ceil(config.count * eff.enemyCountMult);
  }

  // 应用活跃的波次修改器
  for (const mod of game.activeModifiers) {
    if (mod.hpMult) config.hp = Math.round(config.hp * mod.hpMult);
    if (mod.countMult) config.count = Math.ceil(config.count * mod.countMult);
    if (mod.armorType) { config.armorType = mod.armorType; config.armorTypeName = armorTypes[mod.armorType]; }
    if (mod.speedMult) config.speed = Math.round(config.speed * mod.speedMult);
    if (mod.armorMult) config.armor = Math.round(config.armor * mod.armorMult * 100) / 100;
    if (mod.spawnBoss) { config.name = "年终 KPI"; config.hp = Math.round(390 * Math.pow(1.15, waveNumber - 1) * difficulty.hp); config.speed = 34; config.color = "#b14cff"; }
  }

  return config;
}

function getUpgradeCost(tower) {
  return Math.round(towerTypes[tower.typeKey].cost * (0.75 + tower.level * 0.58));
}

function activePlayers() {
  return Object.values(game.players).filter((player) => player.connected);
}

function getPlayerByClient(clientId) {
  return Object.values(game.players).find((player) => player.clientId === clientId && player.connected);
}

function addLog(message, kind = "system") {
  game.logs.unshift({ time: Date.now(), message, kind });
  game.logs = game.logs.filter((log) => Date.now() - log.time < 18000).slice(0, 12);
}

/**
 * applyInstantEventEffects — 处理立即生效的随机事件
 * 发工资(+100金)、预算削减(-80金)、新员工入职(免费塔)、
 * 技术突破(随机满级)、跳槽季(+50金)
 */
function applyInstantEventEffects(event) {
  const eff = event.effects || {};
  // 发工资：所有玩家获得金币
  if (eff.instantGold) {
    activePlayers().forEach(p => { p.gold = Math.max(0, p.gold + eff.instantGold); });
  }
  // 新员工入职：免费获得随机塔
  if (eff.freeTowers) {
    const buildable = Object.entries(towerTypes).filter(([, t]) => !t.synthOnly && !t.ultimate);
    activePlayers().forEach(p => {
      const areas = game.sharedBuild ? Object.values(buildAreas).flat() : buildAreas[p.slot];
      if (!areas) return;
      for (let c = 0; c < eff.freeTowers; c++) {
        const [typeKey] = buildable[Math.floor(Math.random() * buildable.length)];
        const area = areas[0];
        let placed = false;
        for (let gx = area.minX; gx <= area.maxX && !placed; gx++) {
          for (let gy = area.minY; gy <= area.maxY && !placed; gy++) {
            if (!mainPathSet.has(`${gx},${gy}`) && !game.towers.some(t => t.gridX === gx && t.gridY === gy)) {
              const type = towerTypes[typeKey];
              game.towers.push({
                id: game.nextTowerId++, ownerSlot: p.slot, gridX: gx, gridY: gy,
                x: gx * gridSize + gridSize / 2, y: gy * gridSize + gridSize / 2,
                typeKey, level: 1, damage: type.damage, range: type.range, rate: type.rate, cooldown: 0, spent: 0, skillCooldown: 0,
              });
              placed = true;
            }
          }
        }
      }
    });
  }
  // 技术突破：随机升级一座塔到满级
  if (eff.randomUpgrade5) {
    activePlayers().forEach(p => {
      const myTowers = game.towers.filter(t => t.ownerSlot === p.slot && t.level < 5);
      if (myTowers.length > 0) {
        const t = myTowers[Math.floor(Math.random() * myTowers.length)];
        while (t.level < 5) {
          t.level += 1;
          t.damage *= 1.42;
          t.range += 10;
          t.rate = Math.max(0.28, t.rate * 0.9);
        }
      }
    });
  }
  // 跳槽季：免费卖塔
  if (eff.freeSell) {
    // 标记本波卖塔不扣手续费（简化处理：直接给每个玩家50金）
    activePlayers().forEach(p => { p.gold += 50; });
  }
}

// ──────────────────────────────────────────────
// P1 特性实现：送怪 / 塔技能 / 抽签
// ──────────────────────────────────────────────

/**
 * handleSendPressure - 送怪/竞争机制
 * 玩家花金币给对手送额外敌人
 */
/**
 * handleSendPressure — 处理送怪/竞争请求
 * 校验金币、冷却、目标有效性
 * 送怪延迟1波到达，目标获得30%金币补偿
 */
function handleSendPressure(clientId, message) {
  const player = getPlayerByClient(clientId);
  if (!player || game.phase !== "playing") return;

  const pressureType = message.pressureType;
  const pConfig = pressureTypes[pressureType];
  if (!pConfig) return;

  // 校验金币
  if (player.gold < pConfig.cost) {
    send(clients.get(clientId).ws, "error", { message: "金币不足" });
    return;
  }

  // 校验冷却
  const cdKey = pressureType;
  const slotCds = game.pressureCooldowns[player.slot] || {};
  if (slotCds[cdKey] && slotCds[cdKey] > 0) {
    send(clients.get(clientId).ws, "error", { message: `冷却中，还需${slotCds[cdKey]}波` });
    return;
  }

  // 年终突击限制：每玩家仅限1次
  if (pressureType === "assault") {
    if (game.annualAssaultUsed[player.slot]) {
      send(clients.get(clientId).ws, "error", { message: "年终突击已使用" });
      return;
    }
  }

  // 确定目标
  let targetSlots = [];
  if (pressureType === "assault") {
    // 年终突击：给所有对手各送1个Boss
    targetSlots = activePlayers()
      .filter(p => p.slot !== player.slot)
      .map(p => p.slot);
    if (targetSlots.length === 0) return;
    const totalCost = pConfig.cost * targetSlots.length;
    if (player.gold < totalCost) {
      send(clients.get(clientId).ws, "error", { message: "金币不足以给所有人送怪" });
      return;
    }
    player.gold -= totalCost;
    game.annualAssaultUsed[player.slot] = true;
  } else {
    const targetSlot = Number(message.targetSlot);
    const target = game.players[targetSlot];
    if (!target || target.slot === player.slot || !target.connected) {
      send(clients.get(clientId).ws, "error", { message: "目标无效" });
      return;
    }
    // 检查目标护盾
    if (game.pressureShields[targetSlot] && game.pressureShields[targetSlot] > 0) {
      send(clients.get(clientId).ws, "error", { message: "目标有反甩锅护盾" });
      return;
    }
    targetSlots = [targetSlot];
    player.gold -= pConfig.cost;
  }

  // 部门支援：清除目标当前波次普通怪
  if (pConfig.clearNormal) {
    for (const tSlot of targetSlots) {
      const target = game.players[tSlot];
      if (!target) continue;
      // 补偿：30%
      const compensation = Math.floor(pConfig.cost * 0.3);
      target.gold += compensation;
      // 清除普通压力（非Boss）
      const route = pathRoutes[tSlot] || mainPathCells;
      let cleared = 0;
      for (let i = game.enemies.length - 1; i >= 0; i--) {
        const e = game.enemies[i];
        if (e.name !== "年终 KPI" && !e.isBoss && !e.isElite) {
          game.enemies.splice(i, 1);
          cleared++;
        }
      }
      addLog(`${player.name} 对${target.name}使用「部门支援」，清除了${cleared}个普通怪`);
    }
    // 设置冷却
    if (!game.pressureCooldowns[player.slot]) game.pressureCooldowns[player.slot] = {};
    if (pConfig.cooldown > 0) game.pressureCooldowns[player.slot][cdKey] = pConfig.cooldown;
    broadcastState();
    return;
  }

  // 送怪：延迟到达（10秒 → 1波后）
  for (const tSlot of targetSlots) {
    const target = game.players[tSlot];
    if (!target) continue;
    // 补偿：30%
    const compensation = Math.floor(pConfig.cost * 0.3);
    target.gold += compensation;

    game.pendingPressure.push({
      fromSlot: player.slot,
      toSlot: tSlot,
      type: pressureType,
      arriveIn: 1, // 1波后到达
      hpMult: pConfig.hpMult || 1,
      speedMult: pConfig.speedMult || 1,
      count: pConfig.count || 1,
      armor: pConfig.armor,
      isBoss: pConfig.isBoss || false,
    });

    const pName = pConfig.name;
    if (pressureType === "assault") {
      addLog(`${player.name} 对${target.name}发动「${pName}」！Boss即将到来！`);
    } else {
      addLog(`${player.name} 对${target.name}发动「${pName}」，${pConfig.count}个敌人即将到达！`);
    }
  }

  // 设置冷却
  if (!game.pressureCooldowns[player.slot]) game.pressureCooldowns[player.slot] = {};
  if (pConfig.cooldown > 0) game.pressureCooldowns[player.slot][cdKey] = pConfig.cooldown;

  broadcastState();
}

/**
 * spawnSentPressure — 在目标路径生成送来的敌人
 * 由 startWave 调用，当 arriveIn 归零时触发
 * 送来怪的奖励为普通怪的2倍
 */
function spawnSentPressure(pressure) {
  const route = pathRoutes[pressure.toSlot] || mainPathCells;
  const [sx, sy] = route[0];
  const waveConfig = getWaveConfig(game.wave);

  for (let i = 0; i < pressure.count; i++) {
    const baseHp = Math.round((waveConfig.hp || 100) * pressure.hpMult);
    const enemy = {
      id: game.nextEnemyId++,
      route,
      waveNumber: game.wave,
      name: pressure.isBoss ? "年终 KPI" : `送来的压力(${pressureTypes[pressure.type].name})`,
      x: sx * gridSize + gridSize / 2,
      y: sy * gridSize + gridSize / 2,
      pathIndex: 0,
      hp: baseHp,
      maxHp: baseHp,
      baseSpeed: Math.round((waveConfig.speed || 52) * pressure.speedMult),
      reward: Math.round((waveConfig.reward || 10) * 2), // 送来的怪双倍奖励
      armor: pressure.armor || 1,
      armorType: "holy",
      color: pressure.isBoss ? "#b14cff" : "#ff6b9d",
      slowTimer: 0,
      slowFactor: 1,
      poisonTimer: 0,
      poisonDamage: 0,
      lastHitSlot: pressure.toSlot,
      isSentPressure: true,
      isElite: pressure.type === "elite",
      isBoss: pressure.isBoss || false,
      splitCount: 0,
      invisible: false,
      semiInvisible: false,
      auraType: null,
      accelerate: false,
      regenRate: 0,
      flashInterval: 0,
      flashDistance: 0,
      flashTimer: 0,
      survivalTime: 0,
    };
    game.enemies.push(enemy);
  }
}

/**
 * handleBuyShield — 购买反甩锅护盾
 * 花费150金，3波内免疫所有送怪
 */
function handleBuyShield(clientId) {
  const player = getPlayerByClient(clientId);
  if (!player || game.phase !== "playing") return;
  if (player.gold < 150) {
    send(clients.get(clientId).ws, "error", { message: "金币不足（需要150）" });
    return;
  }
  if (game.pressureShields[player.slot] && game.pressureShields[player.slot] > 0) {
    send(clients.get(clientId).ws, "error", { message: "护盾仍在生效" });
    return;
  }
  player.gold -= 150;
  game.pressureShields[player.slot] = 3;
  addLog(`${player.name} 购买了「反甩锅护盾」，3波内免疫送怪！`);
  broadcastState();
}

/**
 * handleUseSkill - 塔主动技能
 * 玩家手动释放塔的主动技能
 */
/**
 * handleUseSkill — 处理塔主动技能释放
 * 校验塔归属、技能存在、冷却状态
 */
function handleUseSkill(clientId, message) {
  const player = getPlayerByClient(clientId);
  if (!player || game.phase !== "playing") return;

  const towerId = Number(message.towerId);
  const tower = game.towers.find(t => t.id === towerId && t.ownerSlot === player.slot);
  if (!tower) {
    send(clients.get(clientId).ws, "error", { message: "塔不存在或不属于你" });
    return;
  }

  const type = towerTypes[tower.typeKey];
  if (!type || !type.skill) {
    send(clients.get(clientId).ws, "error", { message: "该塔没有主动技能" });
    return;
  }

  if (tower.skillCooldown > 0) {
    send(clients.get(clientId).ws, "error", { message: `技能冷却中(${Math.ceil(tower.skillCooldown)}秒)` });
    return;
  }

  // 设置冷却
  tower.skillCooldown = type.skill.cooldown;

  // 执行技能
  executeSkill(tower, type.skill);
  addLog(`${player.name} 的${type.name}释放了「${type.skill.name}」！`);
  broadcastState();
}

/**
 * executeSkill — 执行技能效果
 * 根据技能fn分发到不同处理逻辑（13种技能）
 */
function executeSkill(tower, skill) {
  const type = towerTypes[tower.typeKey];

  switch (skill.fn) {
    case "skill_arrow_ultimate": {
      // 终极甩锅：对目标造成攻击力×5伤害
      const target = findTarget(tower);
      if (target) {
        const dmg = tower.damage * 5;
        target.hp -= dmg;
        target.lastHitSlot = tower.ownerSlot;
        game.effects.push({ x: target.x, y: target.y, radius: 30, life: 0.4, color: "rgba(216,246,255,.7)" });
      }
      break;
    }
    case "skill_cannon_splash": {
      // 范围划水：下3次攻击范围翻倍 → 标记塔
      tower._splashBoostHits = 3;
      game.effects.push({ x: tower.x, y: tower.y, radius: 40, life: 0.5, color: "rgba(255,179,71,.6)" });
      break;
    }
    case "skill_poison_spread": {
      // 摸鱼传染：周围所有敌人获得毒debuff 5秒
      const range2 = tower.range * 1.5;
      game.enemies.forEach(e => {
        if (distance(tower, e) <= range2) {
          e.poisonDamage = Math.max(e.poisonDamage, tower.damage * 0.8);
          e.poisonTimer = Math.max(e.poisonTimer, 5);
          e.lastHitSlot = tower.ownerSlot;
          game.effects.push({ x: e.x, y: e.y, radius: 12, life: 0.3, color: "rgba(166,255,77,.5)" });
        }
      });
      break;
    }
    case "skill_frost_freeze": {
      // 长假连休：冻结范围内所有敌人3秒
      game.enemies.forEach(e => {
        if (distance(tower, e) <= tower.range) {
          e.slowTimer = Math.max(e.slowTimer, 3);
          e.slowFactor = 0; // 完全冻结
          game.effects.push({ x: e.x, y: e.y, radius: 16, life: 0.4, color: "rgba(133,215,255,.6)" });
        }
      });
      break;
    }
    case "skill_caffeine_boost": {
      // 紧急加班：范围内塔攻速翻倍5秒
      game.towers.forEach(t => {
        if (t.id !== tower.id && distance(tower, t) <= tower.range) {
          t._caffeineBoostTimer = 5;
          game.effects.push({ x: t.x, y: t.y, radius: 20, life: 0.3, color: "rgba(255,230,128,.5)" });
        }
      });
      break;
    }
    case "skill_slacker_boost": {
      // 集体摸鱼：范围内塔攻击力+50%持续8秒
      game.towers.forEach(t => {
        if (t.id !== tower.id && distance(tower, t) <= tower.range) {
          t._slackerBoostTimer = 8;
          game.effects.push({ x: t.x, y: t.y, radius: 20, life: 0.3, color: "rgba(255,176,224,.5)" });
        }
      });
      break;
    }
    case "skill_gold_boost": {
      // 周报风暴：本波击杀金币×2持续10秒
      tower._goldBoostTimer = 10;
      game.effects.push({ x: tower.x, y: tower.y, radius: 35, life: 0.5, color: "rgba(255,215,0,.6)" });
      break;
    }
    case "skill_reflect_boost": {
      // 甩锅反弹：下次攻击伤害×10并扩散
      tower._reflectBoostHits = 1;
      game.effects.push({ x: tower.x, y: tower.y, radius: 30, life: 0.4, color: "rgba(255,107,107,.6)" });
      break;
    }
    case "skill_pua_immune": {
      // 反PUA宣言：5秒内权威型压力伤害归零
      tower._puaImmuneTimer = 5;
      game.effects.push({ x: tower.x, y: tower.y, radius: 50, life: 0.6, color: "rgba(184,255,59,.5)" });
      break;
    }
    case "skill_bootlicker_execute": {
      // 拍马屁：目标精英怪30%概率直接死亡
      const elites = game.enemies.filter(e =>
        (e.isElite || e.armor < 0.8) && e.name !== "年终 KPI" && distance(tower, e) <= tower.range
      );
      elites.forEach(e => {
        if (Math.random() < 0.3) {
          e.hp = 0;
          e.lastHitSlot = tower.ownerSlot;
          game.effects.push({ x: e.x, y: e.y, radius: 25, life: 0.4, color: "rgba(255,139,209,.7)" });
        }
      });
      break;
    }
    case "skill_old_hand_storm": {
      // 甩锅风暴：全图所有敌人受到攻击力×3伤害
      const dmg2 = tower.damage * 3;
      game.enemies.forEach(e => {
        e.hp -= dmg2;
        e.lastHitSlot = tower.ownerSlot;
        game.effects.push({ x: e.x, y: e.y, radius: 18, life: 0.25, color: "rgba(242,255,205,.5)" });
      });
      break;
    }
    case "skill_immortal_boost": {
      // 全员摸鱼：全体塔攻击力×3持续10秒
      game.towers.forEach(t => {
        t._immortalBoostTimer = 10;
        game.effects.push({ x: t.x, y: t.y, radius: 25, life: 0.4, color: "rgba(125,255,113,.6)" });
      });
      break;
    }
    case "skill_layflat_clear": {
      // 躺平宣言：清除场上所有普通压力
      let cleared = 0;
      for (let i = game.enemies.length - 1; i >= 0; i--) {
        const e = game.enemies[i];
        if (e.name !== "年终 KPI" && !e.isBoss) {
          game.effects.push({ x: e.x, y: e.y, radius: 20, life: 0.3, color: "rgba(185,140,255,.6)" });
          game.enemies.splice(i, 1);
          cleared++;
        }
      }
      addLog(`躺平宣言！清除了${cleared}个普通压力！`);
      break;
    }
    default:
      break;
  }
}

// ─── 抽签系统（面试模式）---
/**
 * rollGacha — 抽签核心算法
 * 保底机制：10次必出史诗，30次必出传说
 * @param {number} pityEpic - 史诗保底计数
 * @param {number} pityLegendary - 传说保底计数
 * @returns {{result: Object, pityEpic: number, pityLegendary: number}}
 */
function rollGacha(pityEpic, pityLegendary) {
  pityEpic = (pityEpic || 0) + 1;
  pityLegendary = (pityLegendary || 0) + 1;

  let result;

  // 保底：30次必出传说
  if (pityLegendary >= 30) {
    result = gachaPool.find(t => t.rarity === "legendary");
    pityLegendary = 0;
    pityEpic = 0;
  }
  // 保底：10次必出史诗或更高
  else if (pityEpic >= 10) {
    const epicOrHigher = gachaPool.filter(t => t.rarity === "epic" || t.rarity === "legendary");
    result = epicOrHigher[Math.floor(Math.random() * epicOrHigher.length)];
    pityEpic = 0;
  }
  // 正常抽取
  else {
    const totalWeight = gachaPool.reduce((s, t) => s + t.weight, 0);
    let roll = Math.random() * totalWeight;
    for (const t of gachaPool) {
      roll -= t.weight;
      if (roll <= 0) { result = t; break; }
    }
    if (!result) result = gachaPool[0];
  }

  return { result, pityEpic, pityLegendary };
}

/**
 * handleGacha — 处理抽签请求
 * 校验金币(50)和人口上限，抽到塔后自动放置在建造区域空位
 * 连续5次同类型强制更换，无空位则退款
 */
function handleGacha(clientId, message) {
  const player = getPlayerByClient(clientId);
  if (!player || game.phase !== "playing") return;

  const cost = 50;
  if (player.gold < cost) {
    send(clients.get(clientId).ws, "error", { message: "金币不足（需要50）" });
    return;
  }

  // 检查人口上限
  const towerCount = game.towers.filter(t => t.ownerSlot === player.slot).length;
  if (towerCount >= player.populationLimit) {
    send(clients.get(clientId).ws, "error", { message: "人口已满，无法抽签" });
    return;
  }

  player.gold -= cost;

  const pityE = game.gachaPityEpic[player.slot] || 0;
  const pityL = game.gachaPityLegendary[player.slot] || 0;
  const { result, pityEpic, pityLegendary } = rollGacha(pityE, pityL);

  game.gachaPityEpic[player.slot] = pityEpic;
  game.gachaPityLegendary[player.slot] = pityLegendary;

  // 连续抽到同类型检测
  const cons = game.gachaConsecutive[player.slot] || {};
  let typeKey = result.type;
  if (cons[typeKey] && cons[typeKey] >= 5) {
    // 连续5次同类型 → 强制换一个不同的
    const alternatives = gachaPool.filter(t => t.type !== typeKey);
    const alt = alternatives[Math.floor(Math.random() * alternatives.length)];
    typeKey = alt.type;
    game.gachaConsecutive[player.slot] = {};
  } else {
    game.gachaConsecutive[player.slot] = { [typeKey]: (cons[typeKey] || 0) + 1 };
  }

  // 在玩家建造区域内找一个空位放置塔
  const areas = game.sharedBuild ? Object.values(buildAreas).flat() : buildAreas[player.slot];
  let placed = false;
  if (areas) {
    for (const area of areas) {
      if (placed) break;
      for (let gx = area.minX; gx <= area.maxX && !placed; gx++) {
        for (let gy = area.minY; gy <= area.maxY && !placed; gy++) {
          const key = `${gx},${gy}`;
          if (!mainPathSet.has(key) && !game.towers.some(t => t.gridX === gx && t.gridY === gy)) {
            const tType = towerTypes[typeKey];
            game.towers.push({
              id: game.nextTowerId++,
              ownerSlot: player.slot,
              gridX: gx,
              gridY: gy,
              x: gx * gridSize + gridSize / 2,
              y: gy * gridSize + gridSize / 2,
              typeKey,
              level: 1,
              damage: tType.damage,
              range: tType.range,
              rate: tType.rate,
              cooldown: 0,
              spent: cost,
              skillCooldown: 0,
            });
            placed = true;
          }
        }
      }
    }
  }

  if (!placed) {
    // 没有空位，退款
    player.gold += cost;
    send(clients.get(clientId).ws, "error", { message: "没有空位放置塔" });
    return;
  }

  const rarityNames = { common: "普通", rare: "稀有", epic: "史诗", legendary: "传说" };
  addLog(`${player.name} 面试抽签获得「${towerTypes[typeKey].name}」（${rarityNames[result.rarity]}）！`);

  // 通知客户端抽签结果
  send(clients.get(clientId).ws, "gachaResult", {
    towerType: typeKey,
    rarity: result.rarity,
    pityEpic: pityEpic,
    pityLegendary: pityLegendary,
  });

  broadcastState();
}

/**
 * snapshotFor — 为指定客户端生成状态快照
 * 这是服务端/客户端协议的边界，新增字段在这里添加
 * @param {number} clientId - 客户端ID
 * @returns {Object} 完整的游戏状态快照
 */
function snapshotFor(clientId) {
  // 统计每个玩家的塔数量
  const towerCounts = {};
  game.towers.forEach(t => { towerCounts[t.ownerSlot] = (towerCounts[t.ownerSlot] || 0) + 1; });
  return {
    protocolVersion,
    clientId,
    phase: game.phase,
    hostSlot: game.hostSlot,
    wave: game.wave,
    totalWaves,
    spawning: game.spawning,
    spawnCount: game.spawnCount,
    waveConfig: game.wave > 0 ? getWaveConfig(game.wave) : null,
    nextWaveConfig: getWaveConfig(game.wave + 1),
    difficulty: game.difficulty,
    difficultyName: difficultyOptions[game.difficulty].name,
    sharedBuild: game.sharedBuild,
    autoWaveTimer: Math.max(0, game.autoWaveTimer),
    speed: game.speed,
    timeOfDay: game.timeOfDay,
    weather: game.weather,
    activeEvents: game.activeEvents,
    players: game.players,
    towers: game.towers,
    towerCounts,
    enemies: game.enemies,
    projectiles: game.projectiles,
    effects: game.effects,
    logs: game.logs,
    // ─── 阵营/羁绊数据 v1.0 ───
    activeSynergies: game._activeSynergies || [],
    factionCounts: game._factionCounts || {},
    investmentProducts,
    // ─── 波次选择 Roguelike v1.0 ───
    waveChoiceActive: game.waveChoiceActive,
    waveChoiceOptions: game.waveChoiceOptions,
    waveChoiceDeadline: game.waveChoiceDeadline,
    activeModifiers: game.activeModifiers,
    towerBuffs: game.towerBuffs || [],
    noSellWaves: game._noSellWaves || 0,
    // ─── 特殊波次预告 ───
    specialWaveDesc: game.wave > 0 ? getWaveConfig(game.wave).specialDesc : null,
    nextSpecialWaveDesc: getWaveConfig(game.wave + 1).specialDesc,
    // ─── 送怪系统 v1.0 ───
    pendingPressure: game.pendingPressure,
    pressureCooldowns: game.pressureCooldowns,
    pressureShields: game.pressureShields,
    annualAssaultUsed: game.annualAssaultUsed,
    // ─── 抽签系统 v1.0 ───
    gachaMode: game.gachaMode,
    gachaPool,
    gachaPityEpic: game.gachaPityEpic,
    gachaPityLegendary: game.gachaPityLegendary,
    pressureTypes,
  };
}

/**
 * broadcastState — 向所有客户端广播当前状态
 * 按 tickRate 频率调用，而非每次状态变更都广播
 */
function broadcastState() {
  clients.forEach((client, clientId) => send(client.ws, "state", snapshotFor(clientId)));
}

/**
 * send — 向指定 WebSocket 连接发送消息
 * @param {WebSocket} ws - WebSocket 实例
 * @param {string} type - 消息类型
 * @param {Object} payload - 消息数据
 */
function send(ws, type, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type, ...payload }));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * contentType — 根据文件扩展名返回 HTTP Content-Type
 */
function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  return "application/octet-stream";
}

/**
 * getLanAddresses — 获取本机局域网 IP 地址列表
 * 用于启动时显示局域网访问地址
 */
function getLanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((item) => item && item.family === "IPv4" && !item.internal)
    .map((item) => `http://${item.address}:${port}`);
}

/**
 * 主循环：按 tickRate 频率更新游戏状态并广播给所有客户端
 * 使用 setInterval 而非 requestAnimationFrame（服务端无浏览器环境）
 */
setInterval(() => {
  update((1 / tickRate) * game.speed);
  broadcastState();
}, 1000 / tickRate);

server.listen(port, "0.0.0.0", () => {
  console.log(`本机访问：http://localhost:${port}`);
  getLanAddresses().forEach((address) => console.log(`局域网访问：${address}`));
});
