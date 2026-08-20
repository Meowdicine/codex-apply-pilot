# 问卷流程

收集、修改、导入或审计预设答案时读取本文件。

## 来源类型

- `user-explicit`：用户直接确认准确值。
- `verified-document`：允许使用的文档直接支持该值。
- `approved-resume`：该值存在于用户批准的不可变简历。
- `deterministic-normalization`：只做格式转换，不能创建新事实。
- `prefer-not-to-answer`：明确回答，不是缺失数据。

`protected` 与 `legal-material` 只接受 `user-explicit` 或 `prefer-not-to-answer`。不得从姓名、地址、学校、语言、国籍印象、浏览器数据或其他答案推断。

## 自动化策略

- `auto-fill`：语义准确匹配且答案仍有效时复用。
- `ask-each-time`：每个候选都询问；过去使用不构成权限。
- `ask-until-verified`：在用户核验前阻止自动化；到期后重新核验。
- `never-store`：不持久化该值。

## 收集步骤

1. 加载当前 questionnaire catalog；不要在 chat 中另造问题清单。
2. 按 catalog 顺序询问，或只询问所选模式缺失的必填项。
3. 准确展示允许的 enum 值。
4. 持久化前验证日期、列表和数字范围。
5. 记录 `verifiedAt`；可能变化的事实增加 `expiresAt`。
6. 通过项目 CLI 或 atomic state writer 保存，不手工编辑并发状态。
7. 宣布完成前重新读取并验证已保存文档。

## 秘密拒绝

以下内容绝不进入 `answers.json`、profile JSON、receipt、截图或 chat summary：

- password、passphrase、PIN；
- OTP、recovery code、verification link 或 security answer；
- cookie、token、API key、private key；
- OAuth grant 或浏览器 session material。

若受支持的流程需要凭据，使用 OS credential store，只持久化非秘密引用；否则停在凭据边界。

## 完成回执

只返回计数：总回答数、必填已答数、缺失 ID、过期 ID、各 sensitivity class 计数，以及 secret rejection 是否通过。不得回显 protected 或 personal 值。
