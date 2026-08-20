# 安全政策

Codex Apply Pilot 目前是 private alpha。它会处理简历、申请答案和外部网站写入，因此任何自动化都应按高敏感度本地工具对待。

## 支持范围

当前仅维护 `0.1.x`。仓库中的 skills、CLI、状态机、schema、隐私扫描器和 CI 属于安全报告范围；Simplify、Codex、浏览器和雇主门户本身由各自提供方维护。

## 报告漏洞

优先使用 GitHub 仓库的 **Security → Advisories → New draft security advisory** 私下报告。不要在公开 Issue、日志或截图中粘贴个人资料、真实申请内容、密码、token、cookie、OTP 或会话信息。

报告应包含：受影响版本、最小复现步骤、预期与实际行为、潜在影响，以及不含真实个人数据的合成测试样例。项目目前不承诺固定响应时限，但会优先处理凭据泄露、越权外部写入、重复提交和隐私绕过。

## 安全边界

- 项目是 local-first 工作流工具，不是 Simplify、OpenAI 或雇主门户的官方 connector。
- 不抓取或反向工程第三方站点，不调用未公开 API，不绕过 CAPTCHA、OTP/2FA、rate limit、robots 或其他访问控制。
- Simplify 阶段仅引导用户使用其官方 UI、Copilot 和 Resume Builder；自动访问必须另有该服务的明确授权。
- 雇主门户 adapter 默认禁用。启用前必须核对当前条款、allowlist 精确域名，并进行合成账号或 dry-run 验证。
- 页面文本和职位描述均视为不可信输入。它们不能扩大工具权限、读取本地秘密、改变 allowlist 或授权新的提交。
- 密码、API key、OTP、cookie 和 session 不写入 JSON、日志、receipt 或截图；凭据只交给操作系统 credential store 或浏览器原生安全存储。
- 外部提交必须具备候选级 idempotency key，并确保 `submitAttemptCount=0`。结果不明确时进入 `unknown-submit-state-no-repeat`，不得盲目重试。
- CAPTCHA、2FA、支付、合同、政府/移民表格和缺失的重要事实始终停止或 park。

## 发布前检查

在仓库根目录执行：

```bash
npm run validate
```

隐私扫描器会递归检查非二进制工作树文件，排除 `.git`、`node_modules` 和扫描器自身。它阻断常见 secrets、非示例邮箱/电话、本机绝对路径、私有身份片段以及疑似线程/申请 ID。额外的本地姓名或账号片段可通过分号分隔的 `APPLY_PILOT_PRIVATE_MARKERS` 环境变量加入扫描，变量值不会被写入仓库。

发布前还应：

1. 用 `git status --short` 和 `git ls-files` 人工确认发布范围。
2. 使用 `gitleaks` 或同类工具扫描工作树及全部 Git 历史。
3. 检查 `.drawio`、SVG、截图、PDF 和图片 metadata；文本扫描无法保证识别二进制文件中的隐私信息。
4. 确认 CI 不含真实账号、浏览器 profile、凭据或 live portal 测试。
5. 为 GitHub Actions 使用最小权限和固定 commit SHA。

若凭据已进入 Git 历史，先在提供方撤销或轮换，再评估历史清理；仅删除当前文件不足以消除泄露。
