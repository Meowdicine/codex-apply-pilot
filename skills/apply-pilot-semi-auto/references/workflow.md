# Semi-auto 状态流程

推进或恢复 semi-auto 候选时读取本文件。

## 正常路径

```text
discovered
  SOURCE_VERIFIED -> source-verified
  ELIGIBILITY_PASSED -> eligible
  RESUME_STARTED -> resume-preparing
  RESUME_READY -> resume-review-required
  RESUME_APPROVED -> account-registration-required
  ACCOUNT_READY -> form-staging
  ANSWER_SNAPSHOT_LOCKED -> form-staging
  ARTIFACT_PROVENANCE_LOCKED -> form-staging
  FORM_STAGED -> submit-review-required
  SUBMIT_APPROVED -> submit-authorized
  SUBMIT_INTENT -> submitting
  OFFICIAL_SUCCESS -> submitted-verified
```

每个 event 都要求当前 `expectedStateVersion` 与唯一 idempotency key。每次写入后重新读取 state。

在 `RESUME_STARTED`、upload、form/browser staging、Gate 或 submit event 前先运行 terminal-first preflight。任何 submit intent、terminal receipt、unknown no-repeat 或 exact duplicate 立即停止；只有纯 collision finding 可以通过绑定当前 report hash 的用户 review 解除。

## 账号注册

用户负责首次 registration/login，以及任何 email verification、OTP/2FA、OAuth、password creation/reset 或 security question。只要求用户完成可见网站动作并确认就绪；不得要求在 chat 中粘贴秘密、回读秘密或将其保存到 state。

确认后重新检查：

- official host 与准确候选页面；
- 不存在 terminal/no-repeat evidence；
- 当前 state 为 `account-registration-required`；
- 用户确认适用于这个 portal/account；
- 没有 active security challenge。

进入 `FORM_STAGED` 前先锁定 candidate answer snapshot，再从实际文件 bytes 锁定 artifact provenance manifest。两者必须绑定同一 candidate identity、official URL、resume hash 与 form snapshot hash。

## 其他结果

- policy/eligibility failure：`SKIP`；
- reversible pause：`PARK`，只写 non-secret reason；
- security boundary：`SECURITY_HARD_STOP`；
- unsupported material fact：`UNSUPPORTED_FACT_HARD_STOP`；
- uncertain account outcome：`ACCOUNT_UNKNOWN`；
- uncertain post-click outcome：`SUBMIT_UNKNOWN`。

不得重新打开 terminal state。`OFFICIAL_SUCCESS_RECONCILE` 只允许将后来取得的官方回执附到 `unknown-submit-state-no-repeat`；它绝不触发第二次点击。
