# 安全、隐私与第三方边界

本项目处理求职材料和浏览器会话，因此默认采用 local-first、最小数据和 fail-closed。**私有部署不是规避条款、安全控制或真实性要求的理由。**

## 信任边界

1. **公共仓库**：代码、schema、中文文档和纯虚构示例。
2. **本地运行目录**：真实 Profile、问卷、候选状态与非秘密回执；必须排除 Git。
3. **OS credential store**：密码或其他支持的秘密；项目文件只保存 `secretRef`。
4. **用户浏览器**：当前登录会话和官方 UI；不向日志复制 cookie/token/页面秘密。
5. **Simplify 与雇主网站**：第三方系统，各自条款和官方确认优先。

## 不得提交到 Git

- 真实姓名、邮箱、电话、地址、学校 ID 或 protected 答案。
- 真实简历、申请问答、截图、页面导出、候选/申请记录。
- 密码、OTP、recovery code、cookie、token、API key、signed URL。
- 浏览器 profile、扩展 ID、任务/线程 ID、数据库 ID、私有本地绝对路径。
- 真实 Simplify builder ID/URL 或正在申请的职位标识。

只提交虚构 `.example.json`。隐私扫描通过不代表人工检查可省略。

## Simplify 边界

允许：

- 引导用户使用官方 Profile、Copilot 和 Resume Builder。
- 根据用户提供的真实材料准备文本与检查清单。
- 核对用户可见的字段、版本和导出 artifact。

禁止：

- DOM 注入、private/hidden API、逆向工程、抓取或模拟未公开接口。
- 读取扩展内部状态、token、cookie 或其他隐藏数据。
- 绕过限制、CAPTCHA、2FA 或访问控制。

## 雇主网站边界

- 默认禁用未知 portal adapter。
- 用户必须确认网站条款，并将域名加入适用模式的 allowlist。
- 只操作当前官方 HTTPS 职位页面。
- 网站要求人工确认时，以网站要求为准。
- 不从搜索摘要、聚合卡片或旧缓存推断职位仍开放或已提交。

## 真实性

不得虚构技术、日期、指标、资历、学历、证书、clearance、work authorization、sponsorship、protected/demographic 或法律事实。关键词匹配和自动化效率不能覆盖这一规则。

## Exactly-once 与 no-repeat

- 候选由规范化官方 URL 与雇主 job ID 形成稳定 ID。
- 每次状态转换要求当前 `stateVersion` 和唯一 idempotency key。
- 最终点击前持久化 intent，并把 `submitAttemptCount` 从 0 消费为 1。
- 只有官方成功回执可记录 `submitted-verified`。
- 点击结果不明确时进入 `unknown-submit-state-no-repeat`；不允许盲目重试。

## 事件响应

若怀疑秘密进入仓库：

1. 立即停止发布和自动化。
2. 在提供商处撤销或轮换秘密；删除文件不足以使秘密失效。
3. 检查 Git 历史、CI artifacts、issue、release 和 fork 暴露范围。
4. 使用 GitHub Private Vulnerability Reporting 或维护者指定的私密渠道报告；不要公开贴出秘密。
5. 修复扫描规则与文档后再恢复。

若提交状态不明确，优先核验官方历史/回执，不重复最终点击。
