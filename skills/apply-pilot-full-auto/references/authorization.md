# Full-auto 授权与降级

验证 consent、处理新 portal、遇到 blocker 或决定是否降级时读取本文件。

## Consent 合约

要求：

- 明确 `active: true` 且没有 `revokedAt`；
- 当前时间位于 `validFrom` 与 `expiresAt` 之间；
- 一个或多个明确 `allowedDomains`；
- 正数 `dailySubmitCap` 且尚有额度；
- 当前 readiness checks 通过。

匹配准确 host 或有意加入 allowlist 的 subdomain。不得把品牌名、redirect、URL shortener 或搜索结果解释为允许域名。

Consent 只授权限制范围内受支持的申请动作。它不授权抓取、hidden API、绕过访问控制、推断 legal fact、猜测凭据、password reset、payment、contract、government form 或重复 final click。

## 降级 semi-auto

以下情况在 mutation 前降级：

- portal family 新出现或条款未核验；
- domain 不在 allowlist；
- consent inactive、已撤销、已过期或尚未生效；
- daily cap 用尽；
- questionnaire 或 artifact evidence 缺失/过期；
- browser smoke/recovery capability 不再可靠；
- 网站要求 host-required human confirmation。

降级保留 candidate state 与 no-repeat history。不得静默重置或创建第二候选。

## Hard Stop

遇到 CAPTCHA/Cloudflare、OTP/2FA、OAuth/account linking、password reset/rejected credentials、payment、contract、government/immigration form、unsupported material fact、unknown account state 或 unknown submit state 时停止或安全停放。切换模式不能消除 Hard Stop。

## Exactly once

最终动作前立即核验同一 candidate、official host、resume hash、form hash、state version、active consent 与 remaining cap。持久化 intent、只增加一次 attempt count，然后最多点击一次。只有官方证据记录成功；歧义为 no-repeat。
