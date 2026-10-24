# Simplify Profile 官方 UI 流程

仅在用户正在准备或审计 Simplify Profile、Documents 或 Resume Builder 时读取本文件。

## 允许的交互

用户打开并控制 Simplify 官方可见 UI。Codex 可以：

- 根据已核验本地事实准备真实文本；
- 告诉用户应打开哪个可见 section；
- 将可见值与本地问卷对比；
- 提供逐字段 checklist；
- 核验用户提供的导出 artifact。

Codex 不得抓取、注入 JavaScript/DOM 变更、使用 hidden/private API、逆向 extension state、提取 cookie/token 或绕过网站控制。即使环境提供明确授权的可见浏览器能力，也必须遵守这些产品边界和用户当前范围。

## 顺序

1. 确认官方 Simplify origin 和用户选择的可见登录账号。
2. 用当前答案审计 personal/contact facts，不把值打印进普通 receipts。
3. 审计 education、enrolment/co-op status、availability、work authorization 与 sponsorship；未解决的重要事实保持空白。
4. 审计 links、skills、language/certification 与普通求职偏好；只使用当前 scope 与页面字段语义匹配的答案。
5. 确认 voluntary demographic 默认值来自明确选择，通常为 `prefer-not-to-answer` 或 `ask-each-time`。
6. 审计 Documents：只使用用户批准的当前 artifact，不选择含糊的“latest”文件。
7. 创建或审计小型 baseline catalog；每份基准都应由用户批准、不可变、带 family label 且可 hash。
8. 对 Common/Unique Questions 只把完全同文历史答案当作候选草稿；开放式答案必须重新核对 company、role、JD 与 truthfulness。

## 完成回执

只记录：

- official UI checked：yes/no；
- questionnaire complete for semi-auto：yes/no 与 missing IDs；
- documents reviewed：数量；
- immutable baselines registered：数量与 families；
- unsupported/conflicting facts：数量；
- secret exposure detected：yes/no；
- next safe action。

公共 artifact 不得记录 builder URL/ID、resume text、profile value、截图、凭据或 active application identifier。
