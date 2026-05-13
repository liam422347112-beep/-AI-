# 职场守护圈 - AI 游戏

网页端塔防游戏，复刻魔兽争霸地图核心玩法，支持 AI 智能体自动游玩。

## 🎮 项目简介

职场守护圈是一个创新的塔防游戏，完整复刻经典魔兽争霸塔防地图的核心玩法。支持 AI 智能体通过 WebSocket 协议自动游玩、测试并汇报结果。

## ✨ 核心特性

- ✅ 网页端运行，无需安装客户端
- ✅ 完整复刻塔防核心玩法
- ✅ AI 智能体 WebSocket 自动化接口
- ✅ 多玩家角色支持（1-8号位）
- ✅ 羁绊系统 + 终极塔合成
- ✅ 支持局域网联机（通过 lucky 反向代理）

## 🚀 快速开始

```bash
# 安装依赖
npm install

# 启动服务
npm start

# 访问游戏
open http://localhost:5252
```

## 🤖 智能体协议

智能体通过 WebSocket 连接：
- **本机**: `ws://localhost:5252`
- **局域网**: `ws://<host>:5252`

详细协议规范见：
- `AGENT_PLAYBOOK.md` - 智能体完整玩法规范
- `public/agent-protocol.json` - 协议定义

## 📦 版本历史

完整版本更新记录请查看：
- `CHANGELOG.md` - 完整更新日志
- `CHANGELOG-v2.0.md` - v2.0 版本重构记录

## 📄 License

MIT
