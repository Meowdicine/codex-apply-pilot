# 系统架构与权威分层

Apply Pilot 把“规则是什么”“现在运行到哪里”“某个候选发生了什么”“哪些事实已核验”“秘密在哪里”分开。这样可以减少旧 prompt、旧页面和并发任务互相覆盖。

## 权威层级

| 层 | 内容 | 写入者 | 不得包含 |
|---|---|---|---|
| Policy | 模式、Gate、readiness、allowlist、上限、Hard Stop | 单一配置/政策写入路径 | 候选运行状态、秘密 |
| Runtime | lane、调度、当前活动与能力状态 | 单一调度/状态写入路径 | 简历正文、页面秘密 |
| Candidate checkpoint | 候选 ID、状态版本、artifact hash、click/no-repeat | 当前候选执行者 | 密码、OTP、完整表单 |
| Receipt ledger | 状态事件、idempotency key、结果状态、payload hash | 原子追加 | 页面正文、protected 值 |
| Verified facts | 问卷答案、来源、敏感度、有效期 | 用户确认/受控更新 | 密码、cookie、token |
| Secret vault | 凭据 | OS credential store | 明文导出到项目 |

冲突时按当前用户指令与系统安全要求、当前政策、候选 checkpoint、非秘密回执的顺序解析；历史记录不能自动恢复旧授权。

## 组件

- **Codex skills**：按初始化、简历、半自动和全自动任务选择流程。
- **Local CLI/state store**：原子写 JSON、追加回执、校验 schema 和状态版本。
- **Questionnaire**：保存已核验、可过期、可限制自动填写的答案。
- **Resume catalog**：登记不可变基准及其 artifact hash。
- **Application state machine**：候选绑定、Gate、intent、提交和 no-repeat。
- **Readiness evaluator**：判断全自动是否成熟；不直接扩大权限。
- **Browser executor**：只在用户允许的官方可见界面操作；不等同于调度器。
- **OS credential store**：项目只引用，不读取后写入日志。

参见[系统架构图](diagrams/system-architecture.svg)与[安全边界图](diagrams/security-boundaries.svg)。

## 并发模型

公共默认 `defaultLaneCount=1`。用户可以在可验证的隔离浏览器上下文、独立候选 ID 和单写者约束下提高 lane 数，但不能让两个 lane 拥有同一候选，也不能用并发作为跨网站安全限制的豁免。

调度器只处理运行元数据、幂等 dispatch 和 stall 分类；它不打开浏览器、不搜索职位、不填表、不处理凭据，也不点击提交。

## 候选不变量

- 一个 lane 最多一个非终态候选。
- 官方 URL 必须是 HTTPS 并与候选 ID 绑定。
- 每次变更必须匹配 `expectedStateVersion`。
- 简历和表单通过 SHA-256 绑定 Gate/授权。
- `submitAttemptCount` 最大为 1。
- 终态不可继续业务操作；未知提交状态只能用后来获得的官方成功证据 reconcile。

## 状态机图

可编辑源为 [`semi-vs-full-state-machine.drawio`](diagrams/semi-vs-full-state-machine.drawio)，预览为 [`semi-vs-full-state-machine.svg`](diagrams/semi-vs-full-state-machine.svg)。图中半自动和全自动共享官方源、eligibility、简历与 QA 阶段，只在 Gate/授权路径上分叉。
