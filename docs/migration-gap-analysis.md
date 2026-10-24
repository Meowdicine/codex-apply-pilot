# 现有求职系统到 Codex Apply Pilot 的迁移差距

## 研究边界

本分析只比较通用 workflow contract、状态语义、字段 taxonomy 与公开官方产品能力。没有读取或迁移真实简历、真实答案、申请记录、线程历史、浏览器会话、凭据、OTP、cookie、私有绝对路径或个人 standing authorization。

当前官方资料显示：

- Simplify Profile 覆盖 work experience、education、skills、links、Personal Info 与 Job Preferences，Copilot 使用这些信息辅助常见 ATS 表单，但用户仍应在提交前审核。
- Simplify Copilot 会保存并复用完全同文的 Unique Question 回答；相似但不同文的问题被视为不同问题。
- LinkedIn 会保存部分 screening answers，并允许提交前编辑；Easy Apply 提交后不能直接编辑或撤回，且存在 daily/speed limits。
- Simplify Terms 明确限制未经允许的 automated scraping 与 bot account registration，因此本仓库继续只做官方 UI/官方功能引导。

官方入口：

- https://help.simplify.jobs/en/help/articles/1749022-installing-and-setting-up-copilot
- https://help.simplify.jobs/articles/2415391-using-copilot-to-autofill-applications
- https://help.simplify.jobs/en/articles/7306766-answering-essay-questions-with-copilot
- https://help.simplify.jobs/articles/8396475-editing-your-profile-after-onboarding
- https://simplify.jobs/terms
- https://www.linkedin.com/help/linkedin/answer/a507694
- https://www.linkedin.com/help/linkedin/answer/a512388/

## 已在基线中迁移

| 能力 | 当前状态 |
|---|---|
| 中文优先、本地优先、无默认 telemetry | 已有 |
| semi-auto 双 Gate | 已有 |
| full-auto maturity、时限 consent、domain allowlist、daily cap | 已有；合并前复核补齐逐步授权重检、UTC intent cap、显式子域和成熟度去重 |
| CAPTCHA/2FA/OAuth/payment/contract/unsupported fact Hard Stop | 已有 |
| candidate ID、state version、submit intent 与最多一次 final click | 已有 |
| immutable resume baseline 与 artifact SHA-256 | 已有 |
| secret rejection 与 atomic local state | 已有 |
| Simplify guided official UI only | 已有 |

## 本批次迁移

| 能力 | 迁移方式 |
|---|---|
| 更完整的申请字段 taxonomy | base + extended catalog 覆盖地址、学籍、资格、schedule、逐国授权、材料与复用政策 |
| 复杂但不强迫一次答完 | required、recommended、conditional、`--all` 四层收集 |
| 条件问题 | `showWhen.all/any` 与 equals/not-equals/includes/not-empty |
| 更严格的值类型 | email、HTTPS URL、integer、真实日历日期、enum/list、`key-value-list` |
| 答案用途隔离 | `profile`、`search`、`candidate-default`、`consent` |
| 变化事实复核 | 分组 review interval 自动生成 `expiresAt` |
| 问题语义漂移 | `questionRevision` 不匹配时按缺失处理 |
| exact-prompt reuse 边界 | 只允许 candidate review 后复用；开放式回答默认 draft-only |
| 示例一致性 | 移除 null 法律答案并修正 protected automation policy |
| terminal-first preflight | 创建候选及高风险 event 前扫描 index、terminal receipts、submit intent 与 collision evidence |
| canonical candidate identity v2 | official requisition/URL 强身份 + company/role/location alias collision review |
| candidate answer snapshot | 冻结 exact prompt、semantic key、answer source/revision、expiry 与 review decision |
| artifact provenance lock | 从实际 bytes 绑定 resume、form、可选文档、source baseline、candidate 与 answer snapshot |
| score-guided keywords 优化 | 用户确认的官方评分 + 已批准 evidence 驱动本地自动补词/改写；有界迭代、最佳版本、source/export hash 与 QA/Gate 绑定 |

## 仍未迁移，建议按顺序实施

| 优先级 | 能力 | 为什么不能塞进 questionnaire |
|---|---|---|
| P1 | source authority 与 freshness | official posting、mirror、school system、tracker 各自需要 authority、accessedAt、freshness 和 contradiction semantics |
| P1 | confirmation reconciliation | 页面成功文案、email receipt、ATS confirmation ID 与人工完成需要区分；未知结果不得重试 |
| P1 | adapter allowlist contract | 每个 portal family 需要 terms-verified timestamp、允许动作、Hard Stop、失败状态和 synthetic/dry-run evidence |
| P1 | browser risk controls | tab ownership、single-flight、speed/cooldown、one-code attempt、sandbox smoke test 与 handoff recovery |
| P2 | lead discovery/scoring separation | search、tailor、portal execution 与 final approval 应是独立 authority，避免一个 worker 扩权 |
| P2 | account lifecycle metadata | 只记录 non-secret `secretRef`、account state 和 verification gate，不迁移凭据或历史账号授权 |

## 明确不迁移

- 真实姓名、邮箱、电话、地址、简历、答案、申请状态、截图或 employer-specific package。
- 旧系统中的 personal paths、browser/tab/session state、cookies、tokens、passwords、OTPs 或 verification links。
- 历史任务中的提交、账号创建或邮箱读取授权；新候选必须使用当前授权。
- Simplify DOM 驱动、hidden/private API、scraping、extension state reverse engineering 或 bot account registration。
- portal-specific brittle selectors、绕过安全控制的技巧或未经当前 terms 核验的 adapter。
- 过去 employer-specific essay、resume bullets、skills 或 metrics 作为新候选默认值。

## 建议的独立研究任务

建议新建任务标题：

`Research: portal-neutral field taxonomy and adapter contracts`

建议目标：

1. 只使用 synthetic fixtures 和官方公开文档，建立 Greenhouse、Lever、Workday、Ashby、iCIMS、Taleo 与 LinkedIn Easy Apply 的 portal-neutral field taxonomy。
2. 区分 standard fact、candidate fact、protected/legal、document、consent、security challenge 与 final action。
3. 为每个字段定义 semantic key、normalization、scope、expiry、evidence、autofill policy 与 Hard Stop。
4. 设计 adapter contract 和 synthetic dry-run fixtures；不实现 live DOM 驱动。
5. 输出 GitHub issue-ready 的分阶段方案，并把 terminal-first、candidate snapshot 与 provenance lock 拆成独立 PR。

Definition of Done：

- 没有读取真实用户数据或旧申请记录。
- 每个结论可追溯到官方文档或 synthetic fixture。
- 明确 accepted/deferred/rejected 三类迁移项。
- 不创建第三方账号、不操作浏览器 session、不提交任何申请。
