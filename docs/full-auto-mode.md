# 全自动模式：成熟度、有限授权与自动降级

全自动是高级、实验性的 private/self-hosted 模式。它只移除两道常规人工 Gate，不移除真实性、网站条款、安全挑战、候选绑定、一次性提交或官方成功验证。

## 默认 readiness

默认政策要求全部通过：

- 至少 3 次 `submitted-verified` 的半自动申请；
- 至少 3 份 `immutable: true` 且 hash 有效的简历基准；
- 至少 3 个不同简历族；
- 至少 2 个成功使用过的 portal family；
- 全自动必填问卷完整且未过期；
- OS credential store 已准备；
- 浏览器 smoke test 已通过；
- exactly-once recovery test 已通过；
- 至少 2 次 dry run；
- 没有未解决的安全、unsupported-fact 或 unknown-submit Hard Stop；
- 用户已开启、未撤销且未过期的时间限制授权；
- 授权含至少一个明确域名 allowlist。

阈值是可配置的最低成熟度，不是成功保证。任一检查失败都必须回到半自动，不得由 agent 自行降低阈值。

## 有限授权

全自动授权必须包含：

- `allowedDomains`：仅精确或明确子域范围；
- `validFrom` 与 `expiresAt`；
- `dailySubmitCap`；
- 明确的启用与撤销状态；
- 本地能力证明，例如 credential store、browser smoke test 和 recovery test。

授权不跨候选传播事实，不允许跨域名，也不允许绕过网站自身确认。新 portal 默认降级半自动；若网站条款不允许自动化，则不执行。

## 状态路径

共同的官方源、eligibility、简历和 QA 阶段完成后：

```text
resume-preparing
  -> resume-approved-by-policy
  -> form-staging
  -> submit-authorized-by-policy
  -> submitting
  -> submitted-verified
```

每次转移仍要求当前 `stateVersion`，并绑定 `candidateId`、`resumeVersionSha` 与 `formSnapshotSha`。在最终点击前先持久化一次性 intent；`submitAttemptCount` 最大为 1。

## 始终不可自动处理

- CAPTCHA、Cloudflare、OTP/非邮箱 2FA。
- OAuth/account linking、密码重置或被拒绝的凭据。
- 付款、合同、政府/移民表单。
- 缺失或不确定的工作资格、sponsorship、日期、经历年限、技术、证书、clearance、protected/demographic 或其他结果性事实。
- 目标网站要求的额外人工确认。
- 不明确的账号或提交结果。

这些情况应安全停放，或按策略回到半自动；不能用“private mode”作为豁免。

## 自动降级条件

- 发现新 portal family 或未验证条款。
- consent 过期、撤销、域名不匹配或每日上限耗尽。
- questionnaire 答案缺失/过期。
- 简历或表单 hash 漂移。
- 浏览器恢复、portal 结构或最终按钮语义不确定。
- 任意 Hard Stop 或 unknown state。

降级只改变后续授权，不清除既有 no-repeat/click 历史。
