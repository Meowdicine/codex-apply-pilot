---
name: apply-pilot-full-auto
description: 只在半自动成熟度已核验、存在明确限时授权、域名白名单、测试和每日上限时运行有限全自动申请。适用于已准入的 private/self-hosted 工作流；否则降级半自动。
---

# Apply Pilot Full-auto

只有当前证据证明用户有意启用了有限且成熟的工作流时，才移除常规简历与最终审核 Gate。

## 入口判定

1. 从当前 policy、questionnaire、consent、resume catalog 与 application index 评估 readiness。
2. 要求所有检查通过；不得降低阈值、虚构证据，或把旧 chat permission 当作当前 consent。
3. 核验准确官方 host 在 active allowlist 中、当前时间位于 `validFrom`/`expiresAt` 内，且 daily cap 尚有额度。
4. 核验网站条款和 host-required confirmation。新 portal family 或未核验条款回退到 `$apply-pilot-semi-auto`。

## 执行

1. 解析 terminal/no-repeat 证据并核验当前官方候选。
2. 使用 `$apply-pilot-resume` 创建并 QA 真实候选 artifact。只有 readiness 仍有效时，当前 policy 才可免 Gate 1 放行未变化 hash。
3. 只使用当前已核验答案。任何缺失、过期、`ask-each-time`、legal、protected 或 unsupported value 都必须停止或降级；不得猜测。
4. 暂存表单，计算 `formSnapshotSha`，重新核验 consent、allowlist、cap、hash 与 security state。
5. 在一次 final-click attempt 前持久化一个候选绑定 submit intent。
6. 要求官方成功。歧义进入 `unknown-submit-state-no-repeat`，绝不再次点击。

## 按需读取

- 做准确 readiness 检查时读取 [references/readiness.md](references/readiness.md)。
- 处理 consent、降级或 Hard Stop 时读取 [references/authorization.md](references/authorization.md)。
- 面向用户的说明见 [../../docs/full-auto-mode.md](../../docs/full-auto-mode.md)。

## 不可协商边界

Private/self-hosted 不是豁免。不得抓取或使用 hidden API、绕过 CAPTCHA/2FA 或访问控制、猜测凭据或结果性事实、覆盖网站条款、超出 allowlist/cap、跨候选，或重试不可逆动作。

## 完成回执

只报告非秘密证据：readiness 结果、official host、consent expiry、剩余 daily cap、candidate ID、artifact/form hash、final-click attempt count 与官方结果。不得回显答案、凭据、页面内容或简历文本。
