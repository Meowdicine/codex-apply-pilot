# 预设问卷与答案存储

问卷的目标不是替用户“猜答案”，而是把用户明确确认过的事实变成可复核、可过期、可限制自动化范围的本地数据。

## 数据模型

每条答案包含：

| 字段 | 含义 |
|---|---|
| `questionId` | 稳定问题 ID |
| `value` | 用户确认的值；不得包含秘密 |
| `source` | `user-explicit`、`verified-document`、`approved-resume`、`deterministic-normalization` 或 `prefer-not-to-answer` |
| `sensitivity` | `ordinary`、`personal`、`protected` 或 `legal-material` |
| `automationPolicy` | `auto-fill`、`ask-each-time`、`ask-until-verified` 或 `never-store` |
| `verifiedAt` | 最近核验时间 |
| `expiresAt` | 可选失效时间 |

`deterministic-normalization` 只允许格式转换，例如用户已确认日期的标准化；不能用它创造新事实。

## 问卷分组

- 身份与联系方式：legal/preferred name、求职邮箱、电话、公开链接。
- 教育与可工作时间：学校、program、毕业年月、开始日期、时长。
- 工作资格与法律事实：work authorization、sponsorship、background check、security clearance。
- 求职偏好：地点、工作模式、岗位族、薪酬、relocation、travel。
- 自愿披露：demographics 默认行为与 accommodation。
- 自动化授权：文档上传、普通事实填写、是否允许成熟度通过后启用有限全自动。

## 记录规则

1. `protected` 与 `legal-material` 必须来自用户明确回答，不能从简历、姓名、学校、地址或浏览器资料推断。
2. `ask-each-time` 每个候选都重新确认，不能因为过去填过就改为 `auto-fill`。
3. `prefer-not-to-answer` 是一个明确答案，不等于缺失或允许推断。
4. 过期答案按缺失处理；不得沿用到新的候选。
5. 密码、OTP、cookie、token、API key、recovery code 和 security answer 永不进入 `answers.json`。
6. 若网站要求一个当前 schema 没有覆盖的重要事实，停止或安全停放，不添加临时猜测。

## 虚构示例

```json
{
  "questionId": "preferences.role-families",
  "value": ["software", "data"],
  "source": "user-explicit",
  "sensitivity": "ordinary",
  "automationPolicy": "auto-fill",
  "verifiedAt": "2026-01-01T00:00:00.000Z",
  "expiresAt": null
}
```

示例只说明结构，不应成为所有用户的默认偏好。公共仓库不得包含维护者或贡献者的真实预设。
