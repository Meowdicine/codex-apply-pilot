# 半自动模式：两道候选绑定 Gate

半自动是默认和推荐入口。用户掌握简历审核、新账号注册及最终提交决定，Codex 负责可逆准备、版本绑定和一致性检查。

## 状态路径

```text
discovered
  -> source-verified
  -> eligible
  -> resume-preparing
  -> resume-review-required       Gate 1
  -> account-registration-required
  -> form-staging
  -> submit-review-required       Gate 2
  -> submit-authorized
  -> submitting
  -> submitted-verified
```

任一步都可能进入 `parked`、`skipped` 或 Hard Stop。`unknown-submit-state-no-repeat` 是不可盲目重试的终态，只能在后来获得官方成功回执时做只读 reconcile。

## Gate 1：精修简历审核

进入 Gate 1 前必须：

- 官方 HTTPS 职位源已核验；
- 用户自定义筛选规则已通过；
- 候选专用简历来自不可变基准的副本；
- 所有关键词和技能均有真实材料支持；
- PDF/可选格式、可读性和内容 QA 已完成；
- `resumeVersionSha` 已计算并展示。

用户批准的是这个确切 hash。批准后若简历被修改，旧批准失效，必须生成新的 Gate 1。

## 用户完成账号注册

首次雇主账号注册、密码输入、邮箱验证、OTP/2FA、OAuth/account linking 和密码重置由用户完成。Codex 不读取、转发、记录或猜测任何秘密。用户只确认“账号已可正常登录”；系统随后重新核验当前候选绑定。

## 表单暂存

只使用已验证问卷答案与已锁定简历。普通事实可以按其 `automationPolicy` 填写；法律、protected 或每次询问项不得被自动推断。完成后生成 `formSnapshotSha`，但不点击最终提交。

## Gate 2：最终提交审核

Gate 2 manifest 至少绑定：

- `candidateId`；
- 官方 URL 的 hash；
- Gate 1 的 `resumeVersionSha`；
- 当前 `formSnapshotSha`；
- 当前 `stateVersion`；
- 最终按钮标签；
- 短期 `expiresAt`。

任何候选、简历、表单、状态版本或有效期漂移都会使授权失效。普通“继续”不等于提交授权。

## 最终点击

1. 先在本地持久化 `SUBMIT_INTENT`。
2. 核验 `submitAttemptCount=0`、没有 terminal/no-repeat 证据、没有安全挑战。
3. 最多点击一次准确的最终按钮。
4. 只以官方网站成功页/回执记录 `submitted-verified`。
5. 若点击后状态不明确，记录 `unknown-submit-state-no-repeat`，绝不自动再点。

## 何时不要继续

- 当前网站条款未验证或域名不在用户允许范围。
- CAPTCHA、Cloudflare、OTP/2FA、OAuth/account linking。
- 密码重置、付款、合同、政府/移民表单。
- 缺失工作资格、资历、经历、薪酬、protected 或其他重要事实。
- 页面或文档无法证明仍绑定同一候选。
