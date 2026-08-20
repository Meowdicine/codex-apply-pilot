# 真实简历精修

进行 baseline selection、keyword mapping、refinement 或 score interpretation 时读取本文件。

## 输入

- 准确官方 HTTPS job posting，以及可用时的 employer job ID；
- 当前用户 eligibility policy；
- immutable resume catalog；
- 用户批准的 experience/material inventory；
- 候选 terminal/no-repeat status。

官方来源不可用、候选已终态、policy 不通过，或无法在不加入 unsupported facts 的情况下选择基准时停止。

## 基准选择

1. 按 duties 而不是仅按 title 判断 posting 的 dominant work family。
2. 排除含有未获当前用户/候选批准事实的 baseline。
3. 选择最接近的真实 family，并按 baseline ID 确定性打破平局。
4. 创建独立候选专用版本，命名必须避免与基准混淆。
5. 记录 baseline ID、family、baseline hash 与 candidate version ID；receipt 不复制 resume text。

## Requirement-to-evidence map

对每项重要 JD requirement 分类：

- `direct`：批准证据使用相同真实概念；
- `equivalent`：批准证据支持实质等价概念，且没有夸大；
- `soft-skill-supported`：由真实示例支持，而非堆形容词；
- `unsupported`：省略并显示为 gap；
- `unknown`：使用前要求用户核验。

不得把“接触过”写成 production experience、把 coursework 写成 employment、把团队参与写成 leadership，或把兴趣写成 skill。

## 精修

- 优先使用有证据且能改善 semantic alignment 的术语。
- 除非已核验来源更正，否则保留 dates、employers、degrees、metrics 与 technologies。
- 遵循用户当前 layout policy；不得把私有维护者格式偏好变成公共默认。
- 工具报告 match score 时，记录准确候选版本和时间戳。target/minimum 是用户 policy，不是普适保证。
- 真实、有界精修仍达不到配置最低值时，按 policy 停止或跳过；绝不用虚构内容挽救分数。
