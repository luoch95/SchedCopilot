# SchedCopilot

面向生产计划员的排产辅助决策个人项目，用于学习、GitHub 开源和面试展示。

项目关注现场变化后的影响分析、方案比较、证据追溯和人工决策。当前提供本地设备故障仿真演示，尚未接入真实生产设备。

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
- [固定案例与指标口径](docs/demo-case.md)
- [任务记录](docs/tasks.md)

## 本地运行

安装 [uv](https://docs.astral.sh/uv/getting-started/installation/)，在项目根目录运行：

```powershell
uv sync --locked --python 3.12
uv run streamlit run streamlit_app.py
```

访问 http://127.0.0.1:8501。无需模型密钥即可体验甘特图、两种候选方案、离线角色模拟和人工确认。离线分析是脚本流程，不是大模型推理。

## API 多 Agent

生产计划 Agent 与设备资源 Agent 并行读取各自证据，决策协调 Agent 汇总并解释已经计算和校验的方案。三个角色均没有发布权限。

在启动应用的同一 PowerShell 会话配置兼容 OpenAI 工具调用协议的模型服务：

```powershell
$env:LLM_API_KEY = "你的密钥"
$env:LLM_MODEL = "供应商提供的模型名称"
$env:LLM_BASE_URL = "供应商提供的兼容 API 地址"
uv run streamlit run streamlit_app.py
```

然后在侧栏启用 API 模式并点击“运行分析”。配置以 `.env.example` 为参考，应用不会自动读取 `.env`。未提供真实凭据进行联调；供应商必须支持工具调用，API 费用由调用方承担。不要提交密钥、生产数据或本地数据库。

## 验证与打包

```powershell
uv run ruff check .
uv run ruff format --check .
uv run pytest
uv build
```

`uv.lock` 纳入版本控制；CI 在 Linux/Python 3.12 上执行同样的检查。构建产物位于 `dist/`，页面入口为仓库中的 `streamlit_app.py`。

## 首版边界

采用规则排程，还没有 CP-SAT。甘特图支持悬停、缩放，暂不支持拖拽。故障输入为固定案例，尚无实时事件流、插单、用户认证和云端部署。SQLite 仅用于本地演示持久化。

README 会随实际实现更新。计划中的功能不会标记为已完成。
