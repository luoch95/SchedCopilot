# Schedule Copilot 后端

FastAPI、规则排程、影响分析、三 Agent 和 SQLite 存储均位于此目录。React 前端独立位于 `../frontend/`。

## 本地开发

在 `backend/` 内执行：

```powershell
uv sync --locked --python 3.12
uv run uvicorn sched_copilot.api:create_app --factory --host 127.0.0.1 --port 8000 --reload
```

API 文档：http://127.0.0.1:8000/docs。完整前端启动与业务说明见[项目 README](../README.md)。

默认数据库固定在仓库根目录的 `.data/decisions.sqlite3`，不会因启动目录不同而另建空库。`SCHED_DB_PATH` 可覆盖该路径。构建前端后，API 可从仓库根目录 `frontend/dist/` 提供页面；`SCHED_FRONTEND_DIR` 可覆盖前端产物路径。单独安装 wheel 时请显式配置这两个路径。

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
