# Schedule Copilot 后端

FastAPI、规则排程、影响分析、四 Agent 和 SQLite 存储均位于此目录。React 前端独立位于 `../frontend/`。

| Agent | 职责 |
| --- | --- |
| 校验 `validation` | 校验输入、约束和证据，列出阻断项及未检查项。 |
| 排产 `scheduling` | 调用确定性规则生成候选，不修改正式计划。 |
| 评估 `evaluation` | 核验候选指标、差异和风险，无候选时输出评估结论。 |
| 解释 `explanation` | 基于证据组织结论、限制及建议，不编造数据。 |

主入口为 `/api/workflow`，四 Agent 均无审批或发布权限；`/api/analysis` 仅为旧版兼容入口。

## 生产环境后端启动命令

以下命令关闭热重载，本地联调也可使用。在 `backend/` 内执行；生产部署前必须按[部署清单](../skill/deploy_skill.md) 备份并核实配置，显式设置 `SCHED_DEMO_MODE=0` 和绝对路径 `SCHED_DB_PATH`，由 systemd 等服务管理器保持进程运行：

```powershell
uv sync --locked --python 3.12
uv run uvicorn sched_copilot.api:create_app --factory --host 127.0.0.1 --port 8000
```

**Swagger 文档路径为 `/docs`：http://127.0.0.1:8000/docs。** 未配置有效前端产物时，后端根路径 `/` 返回 `404 Not Found` 属于预期行为；请访问 `/docs` 查看接口。`127.0.0.1` 仅供本机或反向代理访问，公网访问使用实际对外开放的后端文档地址。完整前端启动与业务说明见[项目 README](../README.md)。

默认演示模式使用仓库根目录的 `.data/readonly_demo.sqlite3`，启动时会重置该库；关闭演示模式后默认使用 `.data/injection_molding.sqlite3`。`SCHED_DB_PATH` 可覆盖路径，演示模式开启时指定库同样会被重置。构建前端后，API 可从仓库根目录 `frontend/dist/` 提供页面；`SCHED_FRONTEND_DIR` 可覆盖前端产物路径。单独安装 wheel 时请显式配置数据库与前端产物路径。

环境变量示例见 `.env.example`；应用不会自动载入该文件。模型密钥只配置在后端。

## 检查与打包

```powershell
uv run ruff check .
uv run ruff format --check .
uv run pytest
uv build
```

依赖、锁文件、虚拟环境和构建产物分别为本目录的 `pyproject.toml`、`uv.lock`、`.venv/` 和 `dist/`。`src/sched_copilot/api/__init__.py` 是 HTTP 应用工厂；内部按 API、application、domain、infrastructure、agents 和 scenarios 分层。测试分为 `unit/`、`integration/` 与 `architecture/`；架构依赖检查随 pytest 一起运行。

配置由 `config.py` 解析、具体实现由 `bootstrap.py` 组装。统一业务异常在 API 层映射为 HTTP 状态和错误码。日志通过 `observability.py` 配置，`SCHED_LOG_LEVEL` 控制级别；日志不记录模型密钥、人工理由、提示词或供应商错误内容。

旧 Streamlit 已移除，历史代码可从 Git 查看。完整模块职责与扩展规则见[代码结构说明](../docs/code-structure.md)。
# 真实模型 API 联调

项目根目录 `.env` 会被后端自动加载，模型密钥只配置在后端。配置模型服务并重启后端后，从仓库根目录运行：

```powershell
uv --directory backend run python scripts/live_api_smoke.py
```

脚本只输出报告数量和长度，不输出密钥、提示词或模型原始响应。
