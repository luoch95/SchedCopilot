# SchedCopilot

面向生产计划员的排产辅助决策个人项目，用于学习、GitHub 开源和面试展示。

项目关注现场变化后的影响分析、方案比较、证据追溯和人工决策。当前提供本地设备故障仿真演示，尚未接入真实生产设备。

当前架构为 **React + TypeScript 前端 / FastAPI 后端**。开发时独立运行，演示时可用一个本地服务提供前端产物与 API。排程与发布校验始终在后端执行。

## 业务场景

以虚构的多品种、小批量机加工车间为背景。订单包含有先后关系的工序，工序只能在具备相应能力的设备上加工。

第一条演示流程：

> 查看当前计划 → 注入设备故障 → 识别受影响订单 → 比较等待修复与转机方案 → 人工确认 → 发布计划版本。

后续扩展紧急插单、工作日历、物料约束和实时事件接入。所有示例数据明确标注为仿真数据，实验结果不代表真实工厂收益。

## 设计原则

- 业务约束和排程结果由确定性的规则、校验器或求解器处理。
- AI 用于理解问题、调用工具和组织解释；数字与事实必须引用结构化结果和来源。
- 候选方案与已发布计划分开管理，发布必须由人确认。
- 显示数据时间、假设和未知信息；不将模拟数据描述为现场实测。
- 每次迭代交付可运行、可验证、可解释的小闭环。

## 文档

- [范围与验收标准](docs/product-scope.md)
- [开发流程与学习方式](docs/development-guide.md)
- [架构决策记录](docs/decisions/0001-initial-direction.md)
- [本地首版架构](docs/decisions/0002-local-first-mvp.md)
- [前后端分离架构](docs/decisions/0003-react-fastapi.md)
- [固定案例与指标口径](docs/demo-case.md)
- [任务记录](docs/tasks.md)
- [故障录入与影响分析验收](docs/failure-impact.md)

## 本地运行

需要 Python 3.12、[uv](https://docs.astral.sh/uv/getting-started/installation/) 和 Node.js 24 LTS（最低22.12）。以下命令均从 `D:\Study\SchedCopilot` 开始。

首次安装：

```powershell
uv sync --locked --python 3.12
npm --prefix frontend ci
```

开发时打开两个终端。终端一运行后端：

```powershell
uv run uvicorn sched_copilot.api:create_app --factory --host 127.0.0.1 --port 8000 --reload
```

终端二运行前端：

```powershell
npm --prefix frontend run dev
```

前端：http://127.0.0.1:5173；后端 API 文档：http://127.0.0.1:8000/docs。Vite 将 `/api` 请求代理到8000，不需要手动配置跨域。

在侧栏保存故障事件，点击“生成候选方案”。两套方案、工序差异、交付影响和证据同时展开；紫色描边表示设备转移，橙色表示时间调整。证据逐行对齐。所有甘特图共用缩放与查看起点。最终在人工确认区选择方案、填写理由并决定是否发布。

**建议故障开始时间使用10月19日13:00**，这是固定报工快照的时间；任意更改时间不会推进或回退工序状态。误操作可用“恢复上次可试算事件”恢复，不会清空正式计划或历史。

无需模型密钥即可排程；离线角色分析是脚本流程，不是大模型推理。API 沿用 `.data/decisions.sqlite3`，不自动重置旧数据；可在启动后端前用 `SCHED_DB_PATH` 指定其他本地数据库。

只演示、不改代码时，构建后可只开一个服务：

```powershell
npm --prefix frontend run build
uv run uvicorn sched_copilot.api:create_app --factory --host 127.0.0.1 --port 8000
```

此时访问 http://127.0.0.1:8000。构建产物在 `frontend/dist/`，需在后端启动前生成；Python wheel 不包含前端产物，独立部署时须同时携带它或使用反向代理。

旧的 `streamlit_app.py` 和 `src/sched_copilot/app.py` 仅保留作迁移参考，不是当前主界面。

## API 多 Agent

生产计划 Agent 与设备资源 Agent 并行读取各自证据，决策协调 Agent 汇总并解释已经计算和校验的方案。三个角色均没有发布权限。

在启动应用的同一 PowerShell 会话配置兼容 OpenAI 工具调用协议的模型服务：

```powershell
$env:LLM_API_KEY = "你的密钥"
$env:LLM_MODEL = "供应商提供的模型名称"
$env:LLM_BASE_URL = "供应商提供的兼容 API 地址"
uv run uvicorn sched_copilot.api:create_app --factory --host 127.0.0.1 --port 8000
```

然后在“AI 辅助分析”区域启用 API 多 Agent 并点击“运行分析”。密钥只配置在后端，不传给浏览器。配置以 `.env.example` 为参考，应用不会自动读取 `.env`。未提供真实凭据进行联调；供应商必须支持工具调用，API 费用由调用方承担。不要提交密钥、生产数据或本地数据库。

## 验证与打包

```powershell
uv run ruff check .
uv run ruff format --check .
uv run pytest
uv build
npm --prefix frontend run format:check
npm --prefix frontend test
npm --prefix frontend run build
```

`uv.lock` 和 `frontend/package-lock.json` 均纳入版本控制。CI 分别在 Python 3.12 和 Node.js 24 上执行后端、前端检查。

## 代码结构与 API

```text
frontend/src/             React 页面、甘特图、比较区和 HTTP 客户端
src/sched_copilot/api.py  FastAPI 路由、输入校验与业务适配
src/sched_copilot/        领域模型、排程、影响分析、三 Agent 与持久化
tests/test_api.py        API 决策闭环与版本、幂等测试
docs/decisions/          架构决策记录
```

| API | 用途 |
| --- | --- |
| `GET /api/workbench` | 正式计划、事件版本、影响范围和人工历史 |
| `PUT /api/event` | 显式保存故障，检查编辑版本 |
| `POST /api/event/recover` | 恢复最近可试算事件 |
| `POST /api/simulations` | 生成并持久化候选批次、变化与影响证据 |
| `POST /api/analysis` | 离线脚本或 API 三 Agent 分析 |
| `POST /api/decisions` | 按后端候选 ID 人工发布或暂不发布 |

候选批次保存在后端，页面重新载入后需重新点击生成；服务重启不删除已有批次和审计记录。发布接口不接收客户端排程，始终重新校验正式计划指纹、事件递增版本和硬约束；重复请求通过请求 ID 去重。

## 首版边界

采用规则排程，还没有 CP-SAT。甘特图支持悬停、缩放和目标设备故障窗口，暂不支持拖拽。支持编辑一条故障事件及未知恢复时间，底层车间与报工仍是固定仿真快照。尚无多故障叠加、实时事件流、插单、用户认证和云端部署。SQLite 仅用于本地演示持久化。

README 会随实际实现更新。计划中的功能不会标记为已完成。
