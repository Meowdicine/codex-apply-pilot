# 预设问卷与答案存储

问卷的目标不是替用户“猜答案”，而是把用户明确确认过的事实、偏好和复用政策变成可复核、可过期、可限制自动化范围的本地数据。catalog v2 保持 answers schema v1 向后兼容，并通过 `questionnaire.extended.zh-CN.json` 扩展地址、学籍、资格、排班、逐国授权、材料与复用政策。

## 收集强度

- required：进入指定模式前必须存在且仍有效。
- recommended：常见门户会反复询问；默认 questionnaire 会收集，但不会阻止模式启动。
- conditional：只有 `showWhen` 条件成立时显示，例如仅在 work authorization 有期限时询问 expiry。
- full catalog：`questionnaire --all` 才询问不属于当前模式 required/recommended 的长尾项目。

`questionnaire --required-only` 仍用于最短初始化。默认运行只收集当前模式的 required 与 recommended 项，避免一次询问整个扩展目录。

## 数据模型

每条答案包含：

| 字段 | 含义 |
|---|---|
| `questionId` | 稳定问题 ID |
| `questionRevision` | 问题语义 revision；不匹配时按过期处理 |
| `answerScope` | `profile`、`search`、`candidate-default` 或 `consent` |
| `value` | 用户确认的值；不得包含秘密 |
| `source` | `user-explicit`、`verified-document`、`approved-resume`、`deterministic-normalization` 或 `prefer-not-to-answer` |
| `sensitivity` | `ordinary`、`personal`、`protected` 或 `legal-material` |
| `automationPolicy` | `auto-fill`、`ask-each-time`、`ask-until-verified` 或 `never-store` |
| `verifiedAt` | 最近核验时间 |
| `expiresAt` | 可选失效时间 |

旧答案没有 `questionRevision` 或 `answerScope` 时仍可读取；下一次重答会补齐。`deterministic-normalization` 只允许格式转换，例如用户已确认日期的标准化；不能用它创造新事实。

## 问卷分组

- 身份与联系方式：legal/preferred name、求职邮箱、电话、公开链接。
- 教育与可工作时间：学校、program、毕业年月、开始日期、时长。
- 工作资格与法律事实：work authorization、sponsorship、background check、security clearance。
- 求职偏好：地点、工作模式、岗位族、薪酬、relocation、travel。
- 自愿披露：demographics 默认行为与 accommodation。
- 自动化授权：文档上传、普通事实填写、是否允许成熟度通过后启用有限全自动。
- 扩展目录：地址、学籍/co-op、经验年数、skills/language/certifications、工时排班、逐国授权、employment type、材料策略与 exact-prompt reuse。

## 类型与条件

catalog 支持 string、email、URL、number、integer、日期、enum、list 与 `key-value-list`。后者用于类似 `country=status`、`language=level` 的小型结构化映射，不用于秘密或完整文档内容。

日期必须是真实存在的日历日期；URL 可要求 HTTPS；数字和集合可配置上下界；string 可限制长度或 pattern。加载时还会检查重复 ID、未知 override/条件引用、scope、sensitivity、automation policy 与 value type。

## 记录规则

1. `protected` 与 `legal-material` 必须来自用户明确回答，不能从简历、姓名、学校、地址或浏览器资料推断。
2. `ask-each-time` 每个候选都重新确认，不能因为过去填过就改为 `auto-fill`。
3. `prefer-not-to-answer` 是一个明确答案，不等于缺失或允许推断。
4. 过期、revision 不匹配或 scope 冲突的答案按缺失处理；不得沿用到新的候选。
5. 密码、OTP、cookie、token、API key、recovery code 和 security answer 永不进入 `answers.json`。
6. exact-prompt reuse 只能产生候选草稿或预填建议，仍受候选级 review、truthfulness 和 final-submit gate 约束。
7. 若网站要求一个当前 schema 没有覆盖的重要事实，停止或安全停放，不添加临时猜测。

## 虚构示例

```json
{
  "questionId": "preferences.role-families",
  "questionRevision": 1,
  "answerScope": "search",
  "value": ["software", "data"],
  "source": "user-explicit",
  "sensitivity": "ordinary",
  "automationPolicy": "auto-fill",
  "verifiedAt": "2026-01-01T00:00:00.000Z",
  "expiresAt": "2026-04-01T00:00:00.000Z"
}
```

示例只说明结构，不应成为所有用户的默认偏好。公共仓库不得包含维护者或贡献者的真实预设。
