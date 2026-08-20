---
name: apply-pilot-resume
description: 从用户批准的不可变基准创建并审计真实的候选专用简历。适用于官方 JD 匹配、关键词精修、简历审核包、artifact QA 或基准选择；不得虚构资历或修改 reference baseline。
---

# Apply Pilot Resume

生成由当前申请模式审核或放行的候选绑定 artifact。

## 核心流程

1. 在简历工作前解析 terminal/no-repeat 证据；不得为已终态或提交状态不明的候选精修。
2. 要求准确、当前、官方的雇主 HTTPS posting。Simplify discovery、搜索结果或缓存文本不能作为唯一来源。
3. 在创建 artifact 前应用用户当前 eligibility policy。
4. 按主要工作族选择最接近且真实的不可变基准，复制为候选专用版本；不得在 reference page 上重命名、生成或原地编辑。
5. 建立 requirement-to-evidence map。只有批准的简历、已核验材料或用户明确事实支持同一含义时才加入关键词。
6. 精修候选副本。Match score 只是诊断信息，不允许添加不支持的技术、年限、日期、指标、凭据、protected facts 或 work authorization。
7. 完成内容和 artifact QA，计算最终 SHA-256，然后冻结候选版本。
8. `semi-auto` 在 Gate 1 停止并展示非秘密 review packet；`full-auto` 只在当前 readiness/policy 检查通过后放行。

## 按需读取

- 做真实映射和候选副本时读取 [references/refinement.md](references/refinement.md)。
- 做 artifact 检查或 review packet 时读取 [references/artifact-qa.md](references/artifact-qa.md)。

## 不变量

- 公共项目没有普适 ATS score、单页、section name、字体或技能数量规则；使用当前用户政策和真实证据。
- 用户实际经历不支持的关键词必须缺席，即使会降低分数。
- 保留 artifact lineage：baseline ID/hash、候选版本 ID/hash、官方来源 hash 与 QA 结果。
- 除非所属申请流程另行授权，不得 upload、Save and Use、修改表单或提交。
