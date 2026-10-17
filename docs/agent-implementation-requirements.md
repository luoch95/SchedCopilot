# Schedule Copilot 四 Agent 实现需求

> **文档版本：V1.0**
>
> **文档状态：开发基线**
>
> **生效日期：2026-10-17**
>
> **适用范围：四 Agent 第一版实现**
>
> **唯一依据：后续代码、接口和测试以本版本及其后续明确版本为准**

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

prompt = PromptLoader(requirements_version="V1.0").load("validation")
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

本轮不替换旧三角色工作流，不实现结果 Schema 或调用真实模型；上面的 `parse_structured_result` 仍是后续实现示意。

### 文档引用规则

后续开发必须同时遵守以下文件：

- `docs/agent-definitions.md`：四个 Agent 的职责、边界和通信方式；
- `docs/development-guide.md`：Agent 开发流程和通用约束；
- 本文档：第一版功能范围、代码逻辑、共享状态、Prompt 管理和验收标准。

任何新增 Agent 能力或职责变化，都应先更新上述文档，再修改代码、接口和测试。
