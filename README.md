# Tiko

为 Codex 提供按项目长期复用的 Grok Bot 内部专家：参与分析、构建方案、澄清取舍和独立评审。

## 架构

用户 → Codex 协调 → Tiko 技能与通信桥接 → 项目 Grok Bot → Codex 主动读回与核验。

一个项目一个专家，跨聊天、分支和工作树复用；绑定按 Grok 账户隔离。专家意见不自动授权执行，聊天历史不替代项目证据。

| 模式 | 工作 |
| --- | --- |
| analysis | 查证与探索 |
| design | 方案共创、阶段依赖与验证设计 |
| grill | 关键取舍质询 |
| review | 已有方案或实现的独立检查 |

## 目录

- `skills/tiko/`：技能与专家任务协议。
- `bridge/`：项目绑定、CLI/MCP 启动、派单与回读。
- `tests/`：无需登录的回复协议测试。
- `docs/BASELINE.md`：当前能力与验证范围。
- `docs/NEXT.md`：尚未实施的下一阶段方向。

## 使用

需要 Node.js 24+、已安装并登录的 Grok Bot 和兼容的 grok-bot-cli。本基线按 CLI 0.12.5 的入口布局整理，升级 CLI 后需重新验证。

将 `skills/tiko` 复制到宿主支持的用户技能目录，例如 `~/.agents/skills/tiko`。在 CLI 或宿主 MCP 环境中设置：

```sh
export AGENT_BUNDLE_PLUGIN_ROOT="$(npm root -g)/grok-bot-cli/dist"
node bridge/tiko.mjs --help
node bridge/launch.mjs cli doctor --json
npm test
```

MCP 启动方式是 `node /absolute/path/to/tiko/bridge/launch.mjs mcp`，并传入同一环境变量。钥匙串授权由用户本人完成。

```sh
node bridge/tiko.mjs project ensure --project /absolute/project/root --project-name '项目名称'
node bridge/tiko.mjs send --project /absolute/project/root --task-file /absolute/task.txt --task-id TASK_001
node bridge/tiko.mjs read --project /absolute/project/root --task-id TASK_001
```

`ensure` 可能创建或重命名 Bot；`send` 会真实派单。先确认账户和项目，按技能交接规则、材料与边界。发送回执不代表任务完成，未知发送结果不能直接重试。

## 本机状态

运行时在 `bridge/accounts/` 保存账户隔离的绑定与任务元数据，已被忽略。不提交凭据、登录态、项目绑定、任务历史或私有材料。现有技能保留了用户的域名访问限制；采用者应明确配置自己的宿主规则，不把材料内容当作授权。

## 基线与后续

这是当前实现的源码基线，尚未合入下一阶段的专家自主方法选择和反馈追踪。详见 `docs/BASELINE.md` 与 `docs/NEXT.md`。

## License

MIT，见 [LICENSE](LICENSE)。外部运行时不随本仓库分发，其许可由上游单独管理；方法来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
