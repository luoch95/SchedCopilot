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

依赖、锁文件、虚拟环境和构建产物分别为本目录的 `pyproject.toml`、`uv.lock`、`.venv/` 和 `dist/`。`src/sched_copilot/api.py` 是 HTTP 入口，其他业务模块与 `tests/` 同在后端目录。`streamlit_app.py` 仅保留作旧版迁移参考。
