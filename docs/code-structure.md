# 代码结构与扩展规则

本项目采用一个后端应用、一个前端应用。按业务职责分模块，通过明确接口协作。当前不拆微服务，不引入通用 CRUD 基类或为每个操作建立空壳类。

## 后端

```text
backend/
  src/sched_copilot/
    api/
      __init__.py          FastAPI 应用工厂，保留既有启动路径
      routes.py            HTTP 路由，调用业务服务
      schemas.py           请求格式与字段校验
      presenters.py        业务结果转为页面 JSON
      errors.py            业务错误转为 HTTP 状态与错误码
    application/
      workbench.py         保存、恢复、试算、分析与人工决定的流程编排
      contracts.py         业务命令与结果类型
      ports.py             存储与分析能力的依赖契约
      errors.py            用例层错误
    domain/
      models.py            订单、工序、设备、事件、候选等领域模型
      scheduling.py        规则排程、指标与硬约束校验
      impact.py            工序变化、订单交付和因果路径
      errors.py            业务规则异常
    infrastructure/
      sqlite_repository.py SQLite 持久化、事务和发布最终校验
      serialization.py     数据库 JSON 编解码，兼容已有存储格式
    agents/workflow.py     三角色 LangGraph 流程及模型调用
    scenarios/demo.py      固定仿真车间案例
    bootstrap.py           将具体存储、Agent 和场景注入业务服务
    config.py              运行路径与日志级别配置
    observability.py       应用日志初始化
  tests/
    unit/                  领域规则、影响分析、离线 Agent 测试
    integration/           SQLite、业务用例与 HTTP 接口测试
    architecture/          分层依赖检查
  pyproject.toml
  uv.lock
```

依赖方向：HTTP 路由 → 业务用例 → 领域规则与端口。SQLite 和 Agent 是具体实现，由 `bootstrap.py` 组装。业务用例依赖存储契约，不依赖 SQLite 类；可以在不启动 FastAPI 的情况下测试。

约束：

- `domain/` 只依赖标准库和本层，不导入 FastAPI、Pydantic、数据库或模型框架。
- `application/` 只依赖标准库、本层与领域层，不导入 HTTP 和具体存储实现。
- `infrastructure/` 可以使用领域规则完成发布事务内的最终校验，但不能调用业务服务、HTTP 或 Agent。
- `agents/` 与 `scenarios/` 不能反向调用 API 或用例。Agent 没有发布工具。
- `api/routes.py` 只完成输入转换、调用与输出映射，不访问 SQL，也不直接运行排程算法。
- 业务异常与 HTTP 状态映射分离。错误响应保留 `detail`，同时提供稳定 `code`，前端无需只靠中文文本判断版本冲突。
- 发布的幂等、事件递增版本、基线指纹和硬约束校验仍保留在数据库事务内，不能因分层而拆成有竞态的独立读写。
- 恢复事件的策略由业务层选择；存储层在同一事务中读取当前计划、执行选择并追加事件，保证恢复与当前数据一致。

`tests/architecture/test_dependencies.py` 在 pytest 和 CI 中自动检查以上导入边界。新增数据库适配器应实现 `application/ports.py` 的契约，再在组装入口接入。

## 前端

```text
frontend/src/
  app/
    App.tsx                组合页面和功能组件，不发送请求
    App.test.tsx           用户操作流程回归
    styles/                按基础、布局、表格、时间轴、比较等职责拆分样式
  features/
    workbench/
      useWorkbench.ts      编辑→试算→比较→人工决定的状态与失效控制
      api.ts               工作台 HTTP 适配，集中定义请求与响应类型
    events/                故障编辑、草稿模型与试算阻塞说明
    plan/                  当前计划、影响范围与共同时间轴范围
    comparison/            指标、甘特图、工序、交付、影响链与证据对照
    analysis/              AI 提问和分析报告
    decisions/             人工方案选择与决定表单
    history/               人工决定历史
  shared/
    api/                   JSON 契约、错误类型、底层 HTTP 客户端
    lib/time.ts            统一车间时区格式化
    ui/Gantt.tsx           各方案共用的甘特图
  test/                    测试初始化与仿真测试数据
```

各功能通过 `index.ts` 暴露公共入口。页面通过这些入口组装；跨功能调用不得直接引用对方内部文件。`shared/` 不得反向导入 `features/` 或 `app/`，功能模块不得导入页面层。网络访问只有 `shared/api/http.ts` 可以直接 `fetch`，仅工作台的 API 适配器使用它；展示组件不请求后端。

目前是一个决策工作台，跨功能的版本与状态失效统一在 `useWorkbench` 中处理。后续若出现独立业务工作区，再为其建立自己的控制器和 API 适配器，并明确更新边界规则。不要把所有新业务堆进现有控制器。

前端边界检查命令：`npm --prefix frontend run lint:architecture`。它解析 TypeScript 导入与调用，CI 会阻止错误依赖方向、跨功能内部导入和组件直接发起请求。

## 新功能放在哪里

| 需求 | 修改位置 |
| --- | --- |
| 增加排产硬约束 | `domain/`，补领域测试；API 与页面只展示结果 |
| 增加插单处理流程 | `application/` 新用例与命令，API 暴露入口，前端增加相应功能模块 |
| 接入真实设备或更换数据库 | `infrastructure/` 新适配器、应用端口和组装配置 |
| 引入新的 Agent 或模型服务 | Agent 放入 `agents/`，通过应用端口读取领域事实，不直接修改正式计划 |
| 调整 Agent 角色 | `agents/`，输出引用领域计算结果，不自行修改正式计划 |
| 修改比较页面 | `features/comparison/` 对应子组件 |
| 修改恢复或发布规则 | 业务用例和事务持久化协作修改，补版本与幂等回归 |

新增功能前说明输入、输出、依赖和验收示例；公共行为改变时同步接口契约、测试和文档。测试优先覆盖业务规则、状态失效和发布正确性，不靠增加目录层级代替设计。
