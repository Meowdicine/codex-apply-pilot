---
name: apply-pilot-semi-auto
description: 在用户负责新账号注册的前提下，用候选绑定的简历 Gate 和最终提交 Gate 暂存真实申请。适用于首次申请、新 portal family、全自动授权过期，或用户明确选择半自动的申请。
---

# Apply Pilot Semi-auto

对一个准确候选执行可逆准备，同时保留两次明确用户决定。

## 核心流程

1. 加载当前 policy、questionnaire、候选记录和 no-repeat 历史，并要求准确、当前、官方的 HTTPS posting。
2. 核验 eligibility，只创建或恢复一个候选绑定 application state。
3. 使用 `$apply-pilot-resume` 创建、QA 并 hash 候选专用 artifact。
4. 停在 `resume-review-required`，展示 Gate-1 packet；只有批准未变化的 `resumeVersionSha` 才能继续。
5. 进入 `account-registration-required`。用户完成新账号注册/登录和任何验证；只接受“账号已就绪”的直接确认，不收集秘密。
6. 重新核验候选、官方来源、state version 与 artifact。只暂存当前已核验答案支持的字段，然后 hash 表单快照。
7. 停在 `submit-review-required`，生成短期 Gate-2 manifest，绑定候选、官方 URL hash、resume hash、form hash 和 state version。
8. 只有对未过期、未变化 manifest 的准确批准才允许一次 final-click attempt；点击前先持久化 submit intent。
9. 只以官方网站记录成功。不明确结果进入 `unknown-submit-state-no-repeat`，绝不盲目重试。

## 按需读取

- 推进状态或处理账号注册边界时读取 [references/workflow.md](references/workflow.md)。
- 创建/核验 Gate manifest 时读取 [references/gates.md](references/gates.md)。
- 面向用户的说明见 [../../docs/semi-auto-mode.md](../../docs/semi-auto-mode.md)。

## Hard Stops

CAPTCHA/Cloudflare、OTP/2FA、OAuth/account linking、password reset、payment、contract、government/immigration forms、unsupported material facts、unknown account state 与未核验网站条款都必须停止或安全停放候选。Semi-auto 批准不豁免它们。

## 范围

只处理准确候选和当前官方网站。不得启动第二候选、切换 full-auto、修改 policy、发布数据，或把旧批准当作已变化 artifact/form 的权限。
