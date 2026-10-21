# SchedCopilot

面向生产计划员的排产辅助决策个人项目，用于学习、GitHub 开源和面试展示。

项目关注现场变化后的影响分析、方案比较、证据追溯和人工决策。当前提供本地设备故障仿真演示，尚未接入真实生产设备。

当前架构为 **React + TypeScript 前端 / FastAPI 后端**。开发时独立运行，演示时可用一个本地服务提供前端产物与 API。排程与发布校验始终在后端执行。

## 业务场景

以虚构的多品种、小批量注塑车间为背景。订单包含连续的注塑批次，工序绑定模具族，只有具备对应锁模力和模具适配能力的注塑机才能承接；故障时比较原机等待恢复与合格注塑机转移方案。

第一条演示流程：

> 查看当前计划 → 注入设备故障 → 识别受影响订单 → 比较等待修复与转机方案 → 人工确认 → 发布计划版本。

紧急插单支持业务员提交、领导审批和排产员复核发布。后续扩展工作日历、物料约束和实时事件接入。所有示例数据明确标注为仿真数据，实验结果不代表真实工厂收益。

默认进入游客只读模式：顶部显示黄色提示条，写操作置灰并提示“演示模式：无操作权限”。演示锁仅由前端控制，不依赖后端鉴权接口。进入排产工作台即可查看已保存故障 R2、四 Agent 已完成但未发布的方案，以及 **255 分钟 vs 45 分钟**红绿对比；另有一条待领导审批的插单，可查看流转步骤。

点击黄色提示条旁的“解锁”，输入固定演示密码 `admin123`，即可发布预置方案、重新录入故障或审批插单。点击“锁定操作”恢复只读；刷新页面或返回角色选择页后也恢复只读。解锁后显示“✓ 已解锁操作权限”，只读时显示“当前为只读模式”。密码校验及状态切换完全在前端完成，不调用登录、退出或会话接口。启动及重置都会重新生成固定数据，初始化不调用模型。

## 设计原则

- 业务约束和排程结果由确定性的规则与校验器处理；多 Agent 负责读取证据、解释方案和协调人机决策。
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
- [代码结构与扩展规则](docs/code-structure.md)
- [模块边界决策](docs/decisions/0004-module-boundaries.md)
- [固定案例与指标口径](docs/demo-case.md)
- [任务记录](docs/tasks.md)
- [第一阶段验收清单](docs/first-stage-acceptance.md)
- [四阶段路线](docs/roadmap.md)
- [四类 Agent 定义](docs/agent-definitions.md)
- [故障录入与影响分析验收](docs/failure-impact.md)

## 本地运行

需要 Python 3.12、[uv](https://docs.astral.sh/uv/getting-started/installation/) 和 Node.js 24 LTS（最低22.12）。以下命令均从 `D:\Study\SchedCopilot` 开始。

首次安装：

```powershell
uv --directory backend sync --locked --python 3.12
npm --prefix frontend ci
```

开发时打开两个终端。终端一运行后端：

```powershell
uv --directory backend run uvicorn sched_copilot.api:create_app --factory --host 127.0.0.1 --port 8000 --reload
```

终端二运行前端：

```powershell
npm --prefix frontend run dev
```

前端：http://127.0.0.1:5173；后端 API 文档：http://127.0.0.1:8000/docs。Vite 将 `/api` 请求代理到8000，不需要手动配置跨域。

在侧栏保存故障事件，点击“生成候选方案”。两套方案、工序差异、交付影响和证据同时展开；紫色描边表示设备转移，橙色表示时间调整。证据逐行对齐。所有甘特图共用缩放与查看起点。最终在人工确认区选择方案、填写理由并决定是否发布。

**建议故障开始时间使用10月19日13:00**，这是固定报工快照的时间；任意更改时间不会推进或回退工序状态。误操作可用“恢复上次可试算事件”恢复，不会清空正式计划或历史。

无需模型密钥即可排程；离线角色分析是脚本流程，不是大模型推理。演示模式默认使用独立的 `.data/readonly_demo.sqlite3`，每次启动重置，不覆盖原业务库。设置 `SCHED_DEMO_MODE=0` 可关闭后端演示数据自动重置，使用原默认库 `.data/injection_molding.sqlite3`；前端仍默认只读，可通过“解锁”操作。可用 `SCHED_DB_PATH` 指定数据库（演示模式下该库会被重置）。

只演示、不改代码时，构建后可只开一个服务：

```powershell
npm --prefix frontend run build
uv --directory backend run uvicorn sched_copilot.api:create_app --factory --host 127.0.0.1 --port 8000
```

此时访问 http://127.0.0.1:8000。构建产物在 `frontend/dist/`，需在后端启动前生成；Python wheel 不包含前端产物，独立部署时须配置 `SCHED_DB_PATH` 和 `SCHED_FRONTEND_DIR`，或使用反向代理。

旧 Streamlit 实现及专用依赖已移除，历史版本保留在 Git 中。当前只有 React + FastAPI 这一套主实现。

## 四 Agent 与真实模型

“生成候选方案”调用 `/api/workflow`：数据校验 → 排产执行 → 方案评估 → 结果解释。也支持仅校验、重新评估和针对已有结果提问。四个角色均可接入真实模型，旧 `/api/analysis` 三角色接口仅保留兼容，前端不再使用。

将 `backend/.env.example` 复制为项目根目录 `.env`，配置后重启后端：

```dotenv
LLM_API_KEY=你的密钥
LLM_MODEL=供应商提供的模型名称
LLM_BASE_URL=供应商提供的兼容API地址
SCHED_WORKFLOW_MODEL_MODE=auto
LLM_API_TYPE=chat_completions
LLM_TIMEOUT_SECONDS=30
```

根目录 `.env` 自动加载，终端环境变量优先。密钥只在后台使用。OpenAI 官方服务的 `LLM_BASE_URL` 可留空；需要 Responses 工具调用的模型将 `LLM_API_TYPE` 改为 `responses`。兼容服务必须支持工具调用，模型名称按供应商实际配置。

`auto` 在密钥和模型齐全时启用模型，否则使用规则；`rules` 完全不调用模型；`live` 显式尝试模型，缺配置也披露回退。前端保持一个生成入口。

模型每个角色先调用本角色工具，再依据问题选择最多六条已有证据作为分析重点。事实原文与引用由服务器提供，模型不能编写排程、改指标、解除阻断或发布计划。当前使用受约束的事实选择与组织，尚不开放任意自由改写，也不由模型决定工作流路由。

页面标记“模型辅助”或“规则回退”；辅助分析显示模型选取的重点，并保留完整事实、风险和假设。执行详情记录请求数、耗时、已返回的 Token 用量及安全错误码。未知用量显示“未提供”，不估算费用。每个角色最多两次请求、不自动重试；模型异常回退，业务工具自身失败仍停止流程。

详见[真实模型接入说明](docs/live-model-integration.md)。自动测试隔离真实供应商，不会因个人配置自动产生模型调用费用。

## 验证与打包

```powershell
uv --directory backend run ruff check .
uv --directory backend run ruff format --check .
uv --directory backend run pytest
uv --directory backend build
npm --prefix frontend run format:check
npm --prefix frontend run lint:architecture
npm --prefix frontend test
npm --prefix frontend run build
```

`backend/uv.lock` 和 `frontend/package-lock.json` 均纳入版本控制。CI 分别进入 `backend/` 与 `frontend/`，在 Python 3.12 和 Node.js 24 上执行检查。

## 代码结构与 API

```text
frontend/
  src/app/                  页面组装与分类样式
  src/features/             事件、计划、方案比较、AI、人工决定和历史
  src/shared/               公共接口契约、HTTP、时间工具和甘特图
  package.json              前端依赖与命令
  package-lock.json         前端锁文件
backend/
  src/sched_copilot/api/             HTTP 接口、输入校验与输出映射
  src/sched_copilot/application/     业务用例、命令结果和依赖契约
  src/sched_copilot/domain/          领域模型、排程与影响规则
  src/sched_copilot/infrastructure/  SQLite 与序列化
  src/sched_copilot/agents/          四角色规则与真实模型适配、旧接口兼容
  src/sched_copilot/scenarios/       仿真案例
  tests/                    单元、集成与架构边界测试
  pyproject.toml            后端依赖、测试及构建配置
  uv.lock                   后端锁文件
docs/                       业务说明、开发流程和架构决策
.data/                      本地数据库与日志（不提交）
```

依赖边界由测试与 CI 自动检查；详细职责、依赖方向和新增功能位置见[代码结构说明](docs/code-structure.md)。

| API | 用途 |
| --- | --- |
| `GET /api/workbench` | 正式计划、事件版本、影响范围和人工历史 |
| `PUT /api/event` | 显式保存故障，检查编辑版本 |
| `POST /api/event/recover` | 恢复最近可试算事件 |
| `POST /api/simulations` | 生成并持久化候选批次、变化与影响证据 |
| `POST /api/workflow` | 当前前端主入口：四 Agent 校验、排产、评估和解释，支持真实模型及回退 |
| `POST /api/analysis` | 离线脚本或 API 三 Agent 分析 |
| `POST /api/decisions` | 按后端候选 ID 人工发布或暂不发布 |

候选批次保存在后端，页面重新载入后需重新点击生成；服务重启不删除已有批次和审计记录。发布接口不接收客户端排程，始终重新校验正式计划指纹、事件递增版本和硬约束；重复请求通过请求 ID 去重。

## 首版边界

采用确定性规则排程和校验，不以优化算法作为项目主线。甘特图支持悬停、缩放和目标设备故障窗口，暂不支持拖拽。支持编辑一条故障事件及未知恢复时间，底层车间与报工仍是固定仿真快照。尚无多故障叠加、实时事件流、正式用户认证和云端部署。SQLite 仅用于本地演示持久化。

README 会随实际实现更新。计划中的功能不会标记为已完成。
