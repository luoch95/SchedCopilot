# Schedule Copilot 四 Agent 实现需求

> **文档版本：V1.2**
>
> **文档状态：开发基线**
>
> **生效日期：2026-10-18**
>
> **适用范围：四 Agent 第一版实现**
>
> **唯一依据：后续代码、接口和测试以本版本及其后续明确版本为准**

版本记录：

| 版本 | 日期 | 变更 | 是否为当前基线 |
| --- | --- | --- | --- |
| V1.0 | 2026-10-17 | 四 Agent 功能、Prompt 草案和 Loader | 否，仅保留设计背景 |
| V1.1 | 2026-10-17 | 冻结角色输入输出契约、引用及校验；Prompt 升至 1.1.0 | 否，角色契约继续兼容 |
| V1.2 | 2026-10-18 | 四 Agent 主流程接入真实模型工具调用、受证据约束的重点选择、回退及执行元数据 | 是 |

V1.2 沿用 V1.1 角色输入输出契约及 Prompt 1.1.0 元数据；模型层不改写这些角色报告，新增的工作流执行信息见第 22 节。正文早期伪代码用于说明设计意图；字段以第 16 节代码模型及后续明确扩展为准。

版本变更规则：

- 修改功能范围、Agent 职责、共享状态或接口时，版本号必须递增；
- 仅修正错别字或排版时，版本号可不变；
- 开始开发前，必须确认当前使用的文档版本；
- 代码提交说明中应标明对应的需求文档版本；
- 旧版本不得作为当前开发依据。

## 1. 文档目的

本文档记录第一版四 Agent 的功能边界、调用规则、结构化数据要求和验收范围，作为后续代码设计、开发和测试的依据。Agent 的职责定义见 `docs/agent-definitions.md`，本文档补充可落地的实现要求。

项目场景为注塑车间注塑机故障与模具换型的辅助排产。系统提供候选方案和解释，最终决定权交给计划员或车间主管。

## 2. 第一版目标

完成一个可演示的人工在环闭环：

1. 用户创建或修改注塑机故障事件。
2. 数据校验 Agent 输出校验结果。
3. 校验通过后，排产执行 Agent 生成至少两个候选方案。
4. 评估 Agent 比较候选方案与当前计划的差异。
5. 解释 Agent 输出事实、假设、风险、取舍和证据引用。
6. 用户选择候选方案，系统记录人工选择。
7. 系统不自动发布正式生产计划。

## 3. 四个 Agent 的实现范围

### 3.1 数据校验 Agent

触发条件：创建或修改故障、订单、工序、设备、模具、报工状态，或用户请求生成方案。

输入：当前案例、生产计划快照、故障事件、订单工序、设备状态、模具兼容关系和报工记录。

校验内容：

- 故障时间和预计恢复时间的合法性；
- 设备是否可用、是否与模具和工艺要求兼容；
- 订单工序顺序和前置工序状态；
- 报工快照与事件时间是否冲突；
- 重复事件、过期状态和缺失数据；
- 预计恢复时间未知时的风险提示。

输出：阻断项、警告项、可继续项、修复建议、证据引用和校验版本。

约束：不生成候选方案，不修改业务数据，不发布计划。

### 3.2 排产执行 Agent

触发条件：数据校验通过，或用户在修改约束后请求重新生成候选方案。

第一版处理内容：

- 找出故障影响的工序和订单；
- 推迟受影响工序；
- 在满足兼容条件时尝试转移到其他注塑机；
- 调整模具换型顺序；
- 根据在制品处置规则处理加工中的工序；
- 生成多个候选方案；
- 记录每个方案的变更原因和约束依据。

输出：候选方案批次、候选方案、变更明细、约束命中结果、假设和证据引用。

约束：不覆盖当前正式计划，不自动发布，不使用模型自由生成的文本作为排产事实。排产结果必须来自确定性规则和结构化数据。

### 3.3 评估 Agent

触发条件：候选方案生成完成，或用户要求重新比较已有候选方案。

评估内容：

- 订单和工序延期；
- 工序移动和设备转移；
- 新增换型次数和换型时间；
- 设备负载变化；
- 故障恢复不确定性带来的风险；
- 与当前计划相比的主要差异。

输出：候选方案逐项指标、风险、取舍、差异高亮信息和评估版本。

约束：不重新计算排产，不修改候选方案，不发布计划。

### 3.4 解释 Agent

触发条件：用户请求解释、评估完成后需要生成说明，或校验失败需要解释修复原因。

输出内容：

- 事实：系统数据直接支持的内容；
- 假设：生成方案时采用的前提；
- 风险：可能导致方案失效的因素；
- 取舍：候选方案之间的代价和收益；
- 证据：事件、工序、设备、模具、报工记录和评估结果的引用。

约束：不创造不存在的事实，不修改任何排产结果，不发布计划。

## 4. 动态编排规则

Agent 不采用固定串行流程，由编排器根据用户意图和共享状态决定调用哪些 Agent。

典型路径：

```text
生成方案：数据校验 → 排产执行 → 评估 → 解释（需要时）
校验失败：数据校验 → 解释
查看已有方案：读取已有结果 → 评估 → 解释（需要时）
只要求解释：读取已有结果 → 解释
修改评价标准：评估 → 解释（需要时）
```

编排器必须在调用前检查前置条件，在调用后记录状态、版本和失败原因。单个 Agent 失败时，应返回可识别的失败状态，不得用空结果继续生成正式候选。

## 5. Agent 通信和代码契约

Agent 通过编排器读写 typed shared state，不直接互相调用，也不通过自然语言传递事实。共享状态至少包含：

```text
case_id
snapshot_id
event_version
current_plan_version
validation_result
candidate_batch_id
candidate_id
evaluation_result
evidence_refs
assumptions
human_decision
workflow_status
```

每个 Agent 的代码接口应包含：

- 明确的输入模型；
- 明确的输出模型；
- 结果状态：`success`、`warning`、`blocked`、`failed`；
- `agent_name`、`agent_version`、`snapshot_id`；
- 证据引用和错误码；
- 可重复执行所需的输入指纹。

当前工作流使用 LangGraph `StateGraph` 管理状态。模型只负责识别意图、组织解释或补充说明；关键校验、候选生成、指标计算和状态变更使用确定性代码完成。

## 6. 第一版验收标准

- 能创建注塑机故障事件并保存版本；
- 能显示校验阻断项、警告项和修复建议；
- 校验通过后能生成两个及以上候选方案；
- 候选方案包含工序、设备、时间、换型和变更原因；
- 评估页面能平铺展示候选差异并高亮主要变化；
- 解释结果能区分事实、假设、风险、取舍和证据；
- 用户可以选择方案并记录人工决策；
- 任意 Agent 失败时页面能显示明确原因；
- 系统不会自动发布正式生产计划；
- 同一快照和同一事件版本重复执行时，结果可追溯且不会覆盖历史结果。

## 7. 生产适用性和限制

该设计符合实际生产中的辅助排产场景：设备数据可能延迟，故障恢复时间通常需要人工估计，设备转移需要确认模具和工艺条件，最终计划需要计划员或车间主管确认。

主要风险包括数据质量不足、恢复时间不确定、设备兼容规则不完整、Agent 状态管理复杂，以及缺少 MES/ERP 实时接口。第一版应优先保证数据版本、证据追溯、失败处理和人工确认闭环，不以 Agent 数量或自动化程度作为验收标准。

## 8. 后续开发顺序

1. 定义共享状态和四个 Agent 的输入输出模型；
2. 实现数据校验 Agent 及独立测试；
3. 实现排产执行 Agent 的候选方案规则；
4. 实现评估 Agent 的差异指标；
5. 实现解释 Agent 的结构化输出和证据引用；
6. 实现动态编排器和失败恢复；
7. 接入前端页面和人工选择；
8. 用故障、换型、设备转移和未知恢复时间案例进行验收。

## 9. 代码分层方案

建议将 Agent、编排器、领域模型和确定性业务服务分开：

```text
backend/src/sched_copilot/
├── agents/
│   ├── validation_agent.py
│   ├── scheduling_agent.py
│   ├── evaluation_agent.py
│   └── explanation_agent.py
├── orchestration/
│   ├── orchestrator.py
│   ├── routing.py
│   └── state.py
├── domain/
│   ├── models.py
│   ├── enums.py
│   └── rules.py
├── services/
│   ├── validation_service.py
│   ├── scheduling_service.py
│   └── evaluation_service.py
└── api/
    └── routes.py
```

Agent 负责识别意图、选择能力和组织结果；领域服务负责执行确定性规则。业务规则不得全部写在 Agent 文件中。

## 10. 共享状态设计

使用 Pydantic 定义工作流状态，所有 Agent 通过该状态通信：

```python
class WorkflowState(BaseModel):
    case_id: str
    snapshot_id: str
    event_version: int
    current_plan_version: str | None = None

    validation_result: ValidationResult | None = None
    candidate_batch: CandidateBatch | None = None
    evaluation_result: EvaluationResult | None = None
    explanation_result: ExplanationResult | None = None

    human_decision: HumanDecision | None = None
    workflow_status: WorkflowStatus
```

Agent 必须返回结构化 `AgentResult`，包含状态、数据、证据引用和警告。禁止使用自然语言作为下游 Agent 的事实来源。

```python
AgentResult(
    status="success",
    data=...,
    evidence_refs=[...],
    warnings=[],
)
```

## 11. 编排器逻辑

编排器根据用户意图和当前状态选择下一步，不将四个 Agent 固定写成串行流程：

```python
def route(state: WorkflowState, intent: UserIntent) -> NextAction:
    if intent == UserIntent.GENERATE_PLAN:
        if state.validation_result is None:
            return NextAction.VALIDATE
        if state.validation_result.has_blocking_errors:
            return NextAction.EXPLAIN
        if state.candidate_batch is None:
            return NextAction.SCHEDULE
        if state.evaluation_result is None:
            return NextAction.EVALUATE
        return NextAction.EXPLAIN

    if intent == UserIntent.RE_EVALUATE:
        return NextAction.EVALUATE
    if intent == UserIntent.EXPLAIN:
        return NextAction.EXPLAIN
    return NextAction.END
```

调用前检查前置条件，调用后记录状态、版本和失败原因。Agent 失败时返回可识别的失败状态，不得用空结果继续生成候选或发布计划。

## 12. 四个 Agent 的代码逻辑

### 12.1 数据校验 Agent

数据校验 Agent 不依赖大模型，调用可单独测试的规则集合：

```python
def validate(case: SchedulingCase) -> ValidationResult:
    issues = []
    issues.extend(check_event_time(case))
    issues.extend(check_recovery_time(case))
    issues.extend(check_machine_status(case))
    issues.extend(check_machine_mold_compatibility(case))
    issues.extend(check_operation_sequence(case))
    issues.extend(check_report_snapshot(case))
    return build_validation_result(issues)
```

每条问题包含错误码、级别、说明、证据和修复建议：

```python
ValidationIssue(
    code="MACHINE_UNAVAILABLE",
    severity="blocking",
    message="设备 IMM-01 在故障期间不可用",
    evidence_refs=["machine-event:FE-001"],
    repair_hint="修改设备或调整预计恢复时间",
)
```

### 12.2 排产执行 Agent

排产执行 Agent 调用规则服务生成候选，不让模型直接生成时间表：

```python
def generate_candidates(case, validation_result):
    base_plan = load_current_plan(case.snapshot_id)
    impacted = find_impacted_operations(base_plan, case.events)
    candidates = [
        delay_impacted_operations(base_plan, impacted),
        transfer_to_qualified_machine(base_plan, impacted),
        reorder_changeover_sequence(base_plan, impacted),
    ]
    return remove_invalid_candidates(candidates)
```

每个候选必须记录受影响工序、设备变化、时间变化、新增换型、延期时间、命中的规则和证据引用。

### 12.3 评估 Agent

评估 Agent 只比较已有候选与当前计划，不重新排产：

```python
def evaluate(candidate, current_plan):
    return EvaluationResult(
        delay_minutes=calculate_delay(candidate, current_plan),
        moved_operations=compare_operations(candidate, current_plan),
        extra_changeovers=count_extra_changeovers(candidate, current_plan),
        machine_load_changes=compare_machine_load(candidate, current_plan),
        risks=detect_risks(candidate),
    )
```

评价结果必须可以由相同输入重新计算，避免模型说明与实际数据不一致。

### 12.4 解释 Agent

解释 Agent 读取校验、候选、评估和证据，不直接读取未结构化的业务文本：

```python
ExplanationInput(
    validation=state.validation_result,
    candidate_batch=state.candidate_batch,
    evaluation=state.evaluation_result,
    evidence=load_evidence(state),
)
```

输出必须区分事实、假设、风险、取舍和证据引用。模型返回空结果、缺少证据或无法解析时，工作流状态应为 `failed` 或 `warning`，不能当作解释成功。

## 13. 首批需要冻结的接口

正式实现前先确定以下内容：

1. `SchedulingCase` 的完整字段；
2. 四个 Agent 的 Pydantic 输入输出模型；
3. 故障影响工序的判定规则；
4. 设备转移的最低兼容条件；
5. 候选方案的最小差异指标。

这五项是后续代码的接口基础。接口确定后，再实现 Agent、编排器、API 和前端映射，避免反复修改数据结构。

## 14. Prompt 管理方案

四个 Agent 的 Prompt 独立管理，不直接硬编码在 Python 业务逻辑中。Prompt 文件放在：

```text
backend/src/sched_copilot/prompts/
├── __init__.py
├── prompt_loader.py
├── common.md
├── validation_agent.md
├── scheduling_agent.md
├── evaluation_agent.md
└── explanation_agent.md
```

每个 Prompt 至少包含：

- Agent 身份；
- 任务目标；
- 输入字段；
- 输出格式；
- 允许行为；
- 禁止行为；
- 事实来源；
- 异常处理；
- 输出示例。

Agent 代码通过 Prompt Loader 加载模板，业务数据作为独立 user 消息传入：

```python
from sched_copilot.prompts import PromptLoader

prompt = PromptLoader(requirements_version="V1.1").load("validation")
response = llm.invoke(prompt.build_messages(input_data))
result = parse_structured_result(response)
```

Prompt 必须进行版本管理，例如记录 `prompt_version`，并将其写入 Agent 执行结果，保证同一案例可以追溯当时使用的 Prompt。

Prompt 只负责意图识别、解释和输出格式约束，不承载核心业务规则。设备兼容、故障影响工序、时间冲突、候选生成、延期计算和换型计算必须由确定性 Python 代码完成。

## 15. 后续实现依据

### V1.0 Prompt 实现记录

已编写 `backend/src/sched_copilot/prompts/` 下的 `common.md`、`validation_agent.md`、`scheduling_agent.md`、`evaluation_agent.md` 和 `explanation_agent.md`，目录与 `agents/` 平级。

模板版本统一为 `1.0.0`，对应需求基线 `V1.0`，状态为 `pending_integration`。模板包含角色任务、输入字段、事实来源、允许和禁止行为、执行步骤、输出契约、异常处理及虚构输出示例。示例中的 data 必须与 common.md 的顶层契约组合使用。

公共模板与角色模板后续由加载器组合；业务数据以独立消息传入。Python 仍须强制校验版本、权限、结构化输出和证据引用，不得仅依赖 Prompt。

模板编写完成不代表四 Agent 功能完成。Pydantic 契约、工具绑定、Agent 业务逻辑与真实模型验收仍待后续实现。

### V1.0 Prompt Loader 实现记录

加载器位于 `backend/src/sched_copilot/prompts/prompt_loader.py`，由 `prompts/__init__.py` 统一导出，和模板归属于同一模块。原根目录的 `prompt_loader.py` 不再保留，避免出现两套实现。

- `PromptLoader().load(role)` 仅接受 `validation`、`scheduling`、`evaluation`、`explanation`，不接受文件路径。
- 使用 `importlib.resources.files("sched_copilot.prompts")` 读取包内 UTF-8 模板，不依赖启动目录。
- 校验元数据头、角色 ID、版本格式、模板状态与非空正文。元数据头仅支持当前简单键值格式，不作为通用 YAML 解析器。
- 公共模板与角色模板必须同时匹配加载器指定的需求基线，默认 `V1.0`。
- 返回不可变的 `LoadedPrompt`，提供公共与角色的各自版本、合并后的系统指令和完整模板内容的 `content_sha256`。审计信息使用加载结果，不信任模型回传的版本。
- `build_messages(input_data)` 将公共与角色指令合并为 system 消息，业务数据独立序列化为 user 消息，不参与模板替换。拒绝非 JSON 数据、NaN 和 Infinity。
- 不缓存旧模板；每次加载重新读取。缺失资源、无效头、版本冲突或空正文抛出 `PromptLoadError`，不静默降级。
- `pending_integration` 模板可供开发加载，但不表示已启用 Agent 或通过模型验收。
- 架构约束允许 `agents` 依赖 `prompts`；`prompts` 不依赖业务层或模型框架。

测试位于 `backend/tests/unit/test_prompt_loader.py`，覆盖四角色、不同启动目录、消息隔离、非法输入、资源缺失、版本冲突、无效模板以及修改后重载。

上述记录对应 V1.0。当时不替换旧三角色工作流，不实现结果 Schema 或调用真实模型；V1.1 已实现具体校验入口，见第 16 节。

### 文档引用规则

后续开发必须同时遵守以下文件：

- `docs/agent-definitions.md`：四个 Agent 的职责、边界和通信方式；
- `docs/development-guide.md`：Agent 开发流程和通用约束；
- 本文档：第一版功能范围、代码逻辑、共享状态、Prompt 管理和验收标准。

任何新增 Agent 能力或职责变化，都应先更新上述文档，再修改代码、接口和测试。

## 16. V1.1 输入输出契约与运行时校验（当前开发依据）

### 16.1 文件职责

```text
backend/src/sched_copilot/agents/
├── contracts/
│   ├── __init__.py    # 四角色输入输出的公开导出
│   ├── common.py      # 公共上下文、证据、状态、通知和事实陈述
│   ├── inputs.py      # SchedulingCase 和四角色输入
│   └── results.py     # 四角色输出与工具结果数据
└── result_validation.py  # JSON、Schema、版本、引用和一致性校验入口
```

Pydantic 显式列入后端直接依赖，模型不放入 domain，避免领域规则依赖框架。模型采用严格类型，禁止额外字段；文本不可为空白，版本号和时间等字段有结构约束。输入输出模型可生成 JSON Schema，后续可提供给模型结构化输出功能。

### 16.2 公共上下文与证据

`AgentContext` 的五个字段均必填：`case_id`、`snapshot_id`、`event_version`、`current_plan_version`、`input_fingerprint`。其中事件版本为非负整数，其他字段为非空字符串。正常工作流不接受不完整上下文，不依赖模型补齐。

证据目录为 `dict[reference_id, Evidence]`。Evidence 包含同一上下文、kind 和 JSON 内容 content。所有证据必须属于本次版本。完整校验、候选和评价结果可作为证据 content 保存；下游通过引用读取。输入中的 `*_ref`、`candidate_refs` 的值和所有 `evidence_refs` 均须存在于目录。

### 16.3 角色输入

| 输入模型 | 业务字段（另含 agent_name、context、evidence_catalog） |
| --- | --- |
| ValidationInput | intent、case_data、validation_tool_result |
| SchedulingInput | validation_result_ref、current_plan_ref、user_constraints、allowed_strategies、wip_policy、scheduling_tool_result |
| EvaluationInput | current_plan_ref、candidate_batch_id、candidate_refs、evaluation_criteria_ref、evaluation_tool_result |
| ExplanationInput | question、validation_result_ref、candidate_batch_ref、evaluation_result_ref、assumptions |

`SchedulingCase` 是通信快照 DTO，包含带时区的报工快照时间、订单、工序、设备、模具、故障列表和在制品规则。工序包含设备、模具、能力、开始时间、时长与报工状态。恢复时间明确命名为 `estimated_recovery_at`。结构可解析不表示业务正确：兼容、时间冲突、缺失设备等由后续确定性校验工具判断，不能在 DTO 中偷偷修正。

策略使用 `Strategy` 模型：strategy_id、description、parameters。首版不虚构新的规则能力，Agent 只能使用调用方列出的策略。

### 16.4 角色输出

四个角色均使用公共顶层：agent_name、prompt_version、requirements_version、context、status、data、evidence_refs、warnings、errors。data 按角色使用 ValidationData、SchedulingData、EvaluationData 或 ExplanationData；所有字段以 `contracts/results.py` 为准。

- 校验：允许生成标记、已检查项、未检查项与问题清单。
- 排产：批次 ID、候选引用、假设和限制。
- 评估：批次 ID、评价口径引用、逐候选指标与差异引用、风险和取舍。
- 解释：摘要、事实、假设、风险、取舍、下一步与信息限制。

事实、风险、假设和操作建议等条目必须具有证据引用。运行时只验证引用存在及版本匹配，不能据此保证自由文本在语义上一定被证据支持；语义忠实度仍需后续模型验收。

### 16.5 校验入口与状态规则

```python
from sched_copilot.agents.result_validation import validate_request, validate_result
from sched_copilot.prompts import PromptLoader

prompt = PromptLoader(requirements_version="V1.1").load("explanation")
request = validate_request(request_json, prompt)
messages = prompt.build_messages(request.model_dump(mode="json"))
# 后续 Agent 执行层调用模型获取 raw_response_text。
result = validate_result(raw_response_text, request, prompt)
```

入口拒绝非单个 JSON 对象、代码围栏、重复键和非标准数值；不尝试从错误文本中静默提取 JSON。失败抛出带 code 的 `AgentContractError`，错误说明不包含原始业务数据或模型响应；后续执行层负责捕获并记录失败状态。

- success/warning 必须有非空角色结果、顶层证据，且不能包含 errors。
- warning 必须有明确 warnings；success 不能携带 warnings。
- blocked/failed 必须有 errors；除校验可保留问题清单外，data 必须为 null，避免下游误用部分方案。
- 输出上下文必须与输入完全一致，模型回传版本必须匹配实际模板。模板审计信息仍取自 LoadedPrompt。
- 校验阻断不能允许生成候选；有校验警告不能返回无警告成功。
- 校验、排产和评价的完成结果 data 必须与本次传入的确定性工具结果一致，模型不能改写工具字段。工具未执行时，只允许报告阻断或失败；未来执行层调用工具后需构造包含真实结果的新请求。
- 排产需要当前版本的已完成校验结果，不接受阻断校验。候选 ID 不重复，策略必须在允许列表中；只有一个候选时必须 warning 并披露限制。
- 评估必须覆盖请求的全部候选，批次和评价口径匹配，缺失指标必须 warning。
- 解释上游阻断原因可以独立成功；解释候选取舍需提供已完成的完整评价结果，候选 ID 必须在其范围内。

引用与上下文检查只对调用时提供的快照负责；如真实数据发生变化，编排器必须重新构造当前请求并使旧结果失效，不能仅凭先前通过的校验继续执行。

### 16.6 版本与本轮边界

当前需求基线为 V1.1，所有公共和角色 Prompt 均为 1.1.0，Loader 默认基线同步为 V1.1。V1.0 不再作为新接口实现依据。

本轮完成数据契约和可独立调用的校验入口，没有接入现有 API 或旧三角色工作流，没有实现四 Agent、工具绑定、动态编排、人工决策变更或真实模型验收。

验证文件：`backend/tests/unit/test_agent_contracts.py`；验证内容包括四角色有效输出、阻断结果、严格 JSON、非法字段与类型、空报告、完整上下文匹配、过期证据、无效引用、工具结果改写、上游校验、候选完整性及解释取舍条件。

## 17. V1.1 数据校验 Agent 实现记录

### 17.1 实现结构

```text
agents/validation_agent.py  # 调用工具、整理状态和通知、校验报告
tools/validation.py        # 契约转换、结构化证据和规则结果适配
domain/validation.py       # 数据完整性、资源/报工、事件规则
```

`tools/` 与 `agents/`、`prompts/` 平级。工具层只引用 Agent 的 contracts，不引用 Agent 执行逻辑。领域规则保持纯 Python 标准库依赖；沿用 `domain/scheduling.py` 的基线约束检查，不解析旧中文错误文本来推断业务状态。

数据校验 Agent 独立运行，不调用大模型，也不直接调用其他 Agent。Prompt Loader 用于载入角色定义及记录模板版本和哈希；业务放行由确定性工具判断，不能让模型改变校验级别。

### 17.2 调用接口

```python
from sched_copilot.agents.validation_agent import ValidationAgent

# request 为已构造的 ValidationInput。
# current_context 必须由调用方从当前可信快照中读取。
run = ValidationAgent().run(request, expected_context=current_context)
report = run.result
evidence_catalog = run.request.evidence_catalog
```

返回 `ValidationRun`：

- request：包含本次真实工具结果和新增证据的输入副本；
- result：通过 V1.1 运行时校验的 ValidationResult；
- prompt_sha256：实际加载模板的内容哈希。

Agent 不修改调用方的输入，不写数据库，不保存或发布计划。不得丢弃新证据后仅把报告字符串传给下游。后续编排器可将完整 report 注册为新证据，并用该引用构造 SchedulingInput。

`expected_context` 在独立离线试验时可省略；接入应用后应提供当前可信上下文。Agent 自身不读取数据库，也不能发现传入上下文本身已经过期。写入结果或调用下游前，应用层仍须确认当前版本未变化。

### 17.3 当前规则覆盖

| 分类 | 检查内容 |
| --- | --- |
| 输入完整性 | 订单、设备、工序、故障缺失及各类记录 ID 重复 |
| 基线计划 | 设备能力、设备工序重叠、工序先后、重复工序序号 |
| 记录引用 | 工序订单、实体模具、模具兼容设备是否存在 |
| 资源资格 | 设备不可用且无故障窗口、模具与当前设备不兼容 |
| 报工状态 | 快照前应开工却仍未开工、已完成/加工中状态与计划时间冲突、加工超时但无剩余时间 |
| 故障时间 | 故障设备存在、接收时间不早于发生时间、预计恢复时间已知且晚于发生时间 |
| 事件质量 | 重复故障窗口、事件之前应开工却仍未开工 |
| 支持范围 | 多故障联合输入、加工中故障是否超出执行工具能力 |

待开工工序与故障窗口重叠是生成新方案的原因，不作为基线校验错误。工序恰好在故障时刻开始，允许继续；已完成工序恰好在故障时刻结束，不误报加工中故障。

实体模具未提供时，返回 `MOLD_ASSIGNMENT_MISSING` 警告，只能按已有设备能力进行受限试算，并在 unchecked_items 标记实体模具兼容未检查。提供实体模具但记录缺失或明确不兼容时阻断。不能把模具族能力当作已验证实体模具库存和占用。

未知恢复时间返回 `RECOVERY_TIME_UNKNOWN` 阻断；不补造时间。恢复时间始终是人工估计，不代表已经恢复。

### 17.4 支持边界与异常

- 当前候选工具仅支持单故障。多个故障返回 `MULTIPLE_FAILURES_UNSUPPORTED`，重复窗口另报 `DUPLICATE_EVENT`，不假装完成联合校验后即可生成候选。
- 加工中故障缺规则返回 `WIP_POLICY_REQUIRED`；即使填写处置文本，现有执行工具仍不能处理，返回 `WIP_POLICY_UNSUPPORTED`。这项业务能力尚未完成。
- 班次、物料、人员、模具保养、实体模具占用及换型时长均标记为未检查，不能将 can_generate_candidates 理解为真实车间全面放行。
- 成功、警告和阻断由问题清单确定。阻断报告保留问题、业务影响、修复建议和证据，工具异常或无效结果返回 failed，data 为 null。
- 输入契约、旧版本或旧证据不合法，在调用工具前拒绝；提供 expected_context 时，版本冲突也在工具前拒绝。
- 传入的旧 validation_tool_result 不作为本次判定来源，每次重新运行规则。
- 工具报告必须对应本次 case_data，证据上下文必须匹配；发生引用冲突、未知引用或无效结果时不放行。
- 证据 ID 由案例内容、完整上下文和规则版本共同确定，重复运行可追溯，不同版本不会共用同一证据 ID。报告同时引用输入和规则版本记录。
- 工具异常不回传原始异常或敏感输入；日志仅记录异常类型。

### 17.5 验证与后续

场景测试：`backend/tests/unit/test_validation_agent.py`。覆盖正常试算、缺失数据、重复记录、未知恢复、模具兼容、设备状态、报工冲突、在制品边界、多故障阻断、工具异常、证据错误、重复运行和输入不变性。现有注塑案例在未提供实体模具时返回可解释警告，可以继续受限试算。

本轮完成独立的数据校验 Agent、规则工具和测试；未接入 API、页面或旧三角色工作流。后续实现排产执行 Agent，再通过动态编排器将校验与候选生成串接到实际需要的路径中。

## 18. V1.1 排产执行 Agent 实现记录

### 18.1 实现结构

```text
agents/scheduling_agent.py       # 前置条件、工具调用、结果状态和契约校验
tools/scheduling_context.py      # 校验结果、案例快照、策略和设备资格准备
tools/scheduling.py              # 候选生成、候选证据登记和独立复核
domain/scheduling.py             # 既有确定性排产规则，新增策略筛选和设备资格参数
agents/contracts/artifacts.py    # 候选计划、变更清单、约束检查证据模型
```

排产执行 Agent 不调用大模型、不调用其他 Agent、不修改数据库、不发布正式计划。它只接收当前案例的 `SchedulingInput`，读取已登记的完整 ValidationResult，调用确定性工具并返回候选引用。

### 18.2 支持的策略

V1.1 只实现并允许以下两个策略：

- `wait-recovery`：故障设备等待人工预计恢复时间，再顺延受影响待开工工序；不转移设备。
- `allow-transfer`：在设备能力、实体模具兼容、设备可用状态和现有占用约束满足时，转移到合格设备。

候选生成沿用 `domain/scheduling.py` 的工序顺序、设备占用、故障窗口、固定已开工/已完成工序和原计划开工时间下界检查。每个候选再次独立校验，不接受工具只返回 `passed=true` 的声明。

自由文本用户约束、换型顺序调整、换型时长参数、班次日历和物料等尚无确定性工具，返回 `USER_CONSTRAINTS_UNSUPPORTED` 或 `STRATEGY_UNSUPPORTED`，不让模型猜测执行。加工中故障、未知恢复时间、多故障等由校验前置条件阻断。

### 18.3 候选证据

工具为每个批次注册：

- `candidate_plan`：完整候选工序快照；
- `candidate_changes`：设备、开始/结束时间、影响类型、原因和影响链；
- `candidate_constraints`：通过的检查项和未检查项；
- `candidate_batch`：与 SchedulingData 完全一致的批次清单；
- `scheduling_rules`：规则版本和仿真假设。

候选通过 `candidate_batch_id`、`candidate_id`、`plan_ref`、`changes_ref`、`constraint_check_ref` 和证据引用传递。完整计划、变更清单和约束检查在证据目录中保存，不复制为下游自然语言。

候选按完整工序安排指纹去重。两种策略生成相同计划时只保留一个候选，并返回 `DUPLICATE_PLAN_MERGED`；不得伪造两个方案满足比较数量。只有一个不同候选时返回 warning 和 `SINGLE_CANDIDATE`，没有候选时返回 blocked 和 `NO_FEASIBLE_CANDIDATE`。

### 18.4 前置与失败处理

- `prepare_scheduling` 先确认 ValidationResult 属于当前上下文、需求版本和规则版本，并重新运行确定性校验工具，防止旧报告授权新数据。
- 校验失败、快照变化、策略为空/重复/未支持、策略参数未实现、自由文本约束、在制品规则变化或无候选时，不调用候选工具。
- 候选工具输出必须与计划快照、变更清单、约束检查和批次清单互相一致；候选篡改工序定义、伪造资格、隐藏未检查项、变更引用或空结果会进入 failed。
- 工具异常不返回原始异常和业务数据，只返回 `SCHEDULING_TOOL_FAILED`；业务前置不满足使用明确的 blocked 错误码。
- 输入和输出保持不可变语义；工具接收深拷贝，重复执行同一上下文和策略产生相同候选和证据 ID。

### 18.5 当前边界

本轮完成排产执行 Agent、确定性候选适配、候选证据模型和测试；未接入 API、页面或动态编排器。现有页面仍调用旧三角色工作流。下一步实现评估 Agent，再统一编排四 Agent 的调用条件。

## 19. V1.1 评估 Agent 实现记录

### 19.1 实现结构

- `agents/evaluation_agent.py`：前置条件、工具调用、输出复核、状态和契约校验。
- `tools/evaluation.py`：解析已有候选批次，登记指标、差异和规则证据。
- `domain/evaluation.py`：订单交付、工序差异和加工负载的确定性计算。
- `tests/unit/test_evaluation_agent.py`：业务场景、证据一致性和异常测试。

评估独立读取已有候选，不调用其他 Agent、模型、候选生成器或发布接口。可评价批次中指定的候选子集；单候选仍可与原计划比较，但返回 `SINGLE_CANDIDATE` 警告。

### 19.2 默认指标口径

统计完整快照，包括已完成及加工中工序。订单完成时间为快照内该订单最后工序的结束时间；订单延期为完成时间超出交期的非负分钟数，同时提供原计划延期和变化值。未进入快照的订单单独列出，不按准时交付处理。

移动工序指开始时间或设备发生变化的工序；设备转移单独计数。工序延迟为结束时间相对原计划的正向变化，和订单延期分别统计；支持小数分钟，不截断秒级差异。差异证据包含原设备、新设备、起止时间及逐订单交付变化。

设备负载统计各设备加工分钟及其相对原计划的变化，不含换型，也不代表班次利用率。包含闲置设备的零负载。没有换型记录及班次规则时，新增换型次数、换型时长为 null，`missing_metrics` 列明缺项，整体返回 warning；不伪造零成本或利用率。

第一版只实现默认口径。传入非空 `evaluation_criteria_ref` 返回 `EVALUATION_CRITERIA_UNSUPPORTED`，不忽略自定义权重或评分要求。取舍仅并列比较已知指标，不生成综合分数、排名或替用户选择。

### 19.3 来源与失败处理

- 要求同上下文的完整案例、候选批次清单、计划、变更、约束检查和校验来源。
- 在指标计算前复核候选的工序集合、定义、时间、设备资格与约束；复核规则不重新排产。拒绝错误批次、过期校验、被修改的案例、伪造约束和不一致的变更结束时间。
- 候选不足或来源不完整返回 blocked；输入契约、未知引用及过期上下文在工具前拒绝。
- 每次重新运行评价工具，不以输入携带的旧 `evaluation_tool_result` 作为本次事实。
- 工具接收独立副本，输出与独立重算的指标、差异、风险和证据完全比对。异常或不一致返回 `EVALUATION_TOOL_FAILED`，data 为 null，日志仅记录异常类型。
- 评价规则版本、上下文与源证据共同确定证据 ID；相同输入重复评价可追溯，不修改原计划和候选。返回 `EvaluationRun.request` 包含新登记证据，供后续编排器保存。

故障恢复始终标注为人工估计；保留候选假设、未检查生产条件和批次局限。未知恢复或无效候选不能绕过来源校验进入评价。

### 19.4 当前边界

本轮完成独立评估 Agent、确定性指标工具和测试；未接入 API、页面或动态编排器。下一步实现解释 Agent，再统一四 Agent 编排。现有页面继续使用旧三角色工作流。

## 20. V1.1 解释 Agent 实现记录

### 20.1 实现结构与范围

- `agents/explanation_agent.py`：输入、版本、状态和证据引用校验，以及安全失败处理。
- `tools/explanation_context.py`：读取校验、候选和评价结果，复核批次、计划、变更、指标和差异证据。
- `tools/explanation.py`：按固定模板组织事实、假设、风险、取舍、下一步和限制。
- `tests/unit/test_explanation_agent.py`：候选比较、校验阻断、订单问题、伪造证据、过期上下文和工具异常测试。

首版不调用模型、不调用其他 Agent、不重新执行校验、排产或评价，也不接受发布计划权限。问题文本只用于识别解释或比较意图，以及筛选用户明确提到的订单/工序；不能成为事实来源。

### 20.2 解释规则

- 校验阻断可以单独解释；说明阻断项、业务影响和修复步骤，不机械复制为失败状态。
- 候选说明引用具体策略、工序、设备、时间、变更原因和影响链。
- 候选取舍必须有至少两个有效评价候选；没有评价或评价失败时返回 `EVALUATION_REQUIRED`。
- 评价指标、订单交付变化和设备负载只从评价证据读取。恢复时间明确标注为人工预计，不表述为实际恢复。
- 输入假设只有在证据目录存在同文本假设记录时才进入假设区；无来源假设进入限制，不升级为事实。
- 所有事实、风险、假设、取舍和下一步均带引用。下一步涉及选择或发布时强制 `requires_human_confirmation=true`。
- 完成结果有结构化内容及顶层证据；缺失证据、批次不一致、指标篡改、引用越界和版本冲突均拒绝或失败，不输出空解释。

### 20.3 当前边界

V1.1 独立实现阶段完成四个 Agent 与固定模板。后续动态编排、API、前端接入见第 21 节；真实模型接入见第 22 节。模板结果仍接受相同的结构化校验，模型分析重点作为独立执行信息展示。


## 21. V1.1 动态编排、API 与页面接入

已完成确定性动态编排器，支持 generate_candidates、re_evaluate、explain、validate 四种意图；Agent 不直接互调。每轮合并工具证据，集中同步引用，保留结构化结果、状态和执行 trace。终态节点不重复执行，异常、步数超限和过期上下文返回明确错误；校验阻断可以解释，但整体仍保持 blocked。

新增 POST /api/workflow，从后端当前快照构造 Agent 输入。完整链路成功才把候选登记到原有服务端候选存储，可经 /api/decisions 人工发布；重评估和解释复用服务端工作流会话，不重新排产。运行前后均校验事件和计划版本。

前端新增“四 Agent 动态编排”区域，支持四类操作、执行顺序、告警、解释分类与证据展开；事件编辑、重新载入或发布清除旧工作流。原 API 和旧三角色分析保留兼容。缺少换型、班次、实体模具数据时保留缺项和警告，不补造业务事实。

工作流会话当前为单进程内存，最多 32 条，重启或淘汰后需重新执行；候选和人工决定仍由 SQLite 保存。详细接口与运行边界见 [动态编排器](dynamic-orchestrator.md)。浏览器实页验证因连接工具缺少 sandboxPolicy 而未完成；自动测试与构建结果见任务记录。

## 22. V1.2 四 Agent 主流程真实模型接入

- 角色输入输出和 Prompt 元数据继续兼容 V1.1；工作流新增 `trace[].execution`，规则模式为 null。
- 模型包装现有四角色，先调用本角色零参数工具，再选择并排序最多六条服务器登记的事实编号。工具名、参数、数量、引用和选项均由后台校验，模型不能修改业务字段或发布计划。
- 原始事实、风险、假设和缺失指标完整保留，模型未选中不代表可以省略。模型只筛选解释重点，不改写事实，不接管确定性编排路由。
- 每个角色最多两次请求，不自动重试。模型异常回退并标记；工具已执行则复用其结果，工具自身失败不得伪装成功。
- 执行信息记录模型、请求数、已返回 Token、耗时、安全错误码、系统提示哈希及带引用的重点；不返回原始异常、密钥或未校验模型文本。
- 具体配置、接口兼容、验证及当前边界见[模型接入说明](live-model-integration.md)。尚未实现持久化模型调用审计和金额计费。
