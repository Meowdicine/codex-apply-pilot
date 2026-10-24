# 根据 Simplify 反馈优化 keywords

功能自动完成本地候选副本的关键词选择、证据核验、文本修改、版本冻结、停止判定与最佳版本保留。评分通过用户在 Simplify 官方 UI 中确认后导入；本工具不访问 Simplify 页面、内部 API 或账户。

## 先准备当前候选

先通过 terminal-first preflight、官方职位源和 eligibility，再进入 `resume-preparing`。选择已登记的 immutable reference baseline，其 hash 必须匹配 `resume-catalog.json`。不能用历史雇主专用 package 冒充 reference。

当前自动编辑器接受 UTF-8 Markdown/plain text source。PDF/DOCX 应由用户通过官方功能获取可编辑内容，并登记对应 reference。每轮的 editable source 与官方导出的 scored artifact 分别记录 hash；`sourceTextVerified=true` 表示用户已核验两者的内容对应。排版 QA 仍检查最终 PDF/DOCX。

## 证据和自动改动

Plan 绑定 candidate ID、official URL hash、JD hash 与 baseline ID。每条 evidence 记录源文件、实际 hash、原文 excerpt、已批准关键词、已批准措辞和真实的用户 review 时间。只有确实获得用户批准的材料才能写 `reviewedBy=user`。

- `direct`：关键词原样出现在核验 excerpt 中。
- `equivalent`：用户明确确认语义等价，且采用批准措辞。
- `soft-skill-supported`：只在有事实支持的 experience/project 中表达。
- `unsupported`/`unknown`：保留 gap，不添加。

`autoAppendSkills` 可自动从 evidence 中选择缺失 technical keywords，无需逐词手写 edit。前提是源 evidence 已明确允许 `canListAsSkill=true`、`keywordCategory=technical`，关键词在原文和当前 JD 中都确实存在。系统仅修改用户指定的现有 Skills 行；不会创建通用默认技能表。

更复杂的 bullet、headline 或 experience 改写使用 `edits` 中批准的 exact before/after anchor。支持 `append-skill`、`replace-text` 与 `append-bullet`。Anchor 必须是唯一的完整行或段落，并位于指定 section；数字和日期默认保留，新增数字还需 source evidence 和显式批准。其他内容、reference 和 Profile 不会被重写。

## CLI 流程

由 Codex 根据当前批准材料和 schemas 构建 runtime plan；示例见 `examples/resume-optimization-plan.example.json`。示例的 hash、score 和名字都是虚构占位值，不能直接当作真实事实使用。

```powershell
node scripts/apply-pilot.mjs resume-optimize-start --state-dir .apply-pilot `
  --application APPLICATION_ID --baseline-file ./baseline.md `
  --jd-file ./official-jd.txt --plan-file ./optimization-plan.json

node scripts/apply-pilot.mjs resume-optimize-step --state-dir .apply-pilot `
  --application APPLICATION_ID --feedback-file ./score-feedback.json `
  --scored-artifact-file ./official-export.pdf

node scripts/apply-pilot.mjs resume-optimize-status --state-dir .apply-pilot `
  --application APPLICATION_ID
```

每轮用户在官方 UI 中选中同一 source/target job，按需要使用官方 tailoring 功能或手动应用本地改动，等待保存与重新计算，核验内容并导出。Feedback 包含 exact source hash、JD hash、exported artifact hash、metric、score、missing keywords、观察时间与用户确认。CLI 从实际文件 bytes 核验 export hash。

Keyword Match 与更广泛的 Resume Score 不能混用。`targetScore` 和 `minimumScore` 必须由用户配置；仓库没有通用 ATS 及格线。默认只给出有界轮数、单轮改动数、停滞次数与反馈时效。

## 停止和审核

达到 target 时停止修改。分数回退、停滞、最大轮数或没有安全改动时，保留已观察到的最高分版本；同分保留更早、改动更少的版本。未达 minimum 时按当前用户 policy park 或 skip，绝不通过虚构事实补分。

反馈过期、candidate/JD/版本漂移、尚未保存/重新计算、来源 hash 不匹配、未核验事实或 terminal/no-repeat 证据都会阻止继续。重复反馈不会再次改写；重新 start 也不能清空既有预算和历史。

已停止且达到 minimum 的推荐版本，可以用 `resume-optimize-step --recheck` 导入该版本的新 score/export。它只刷新分数与导出文件，不新增 edits、不重置轮数，也不沿用过期的高分；适用于 QA 前重新确认反馈，或对回退后的最佳版本重新导出。Evidence 过期仍需先处理事实核验。

优化结束后仍须内容与 artifact QA。`RESUME_READY` 必须携带 `optimizationSessionSha256`、`optimizedDraftSha256`、`qaPassed=true`，且 `resumeVersionSha` 必须等于最佳已评分 export 的真实 hash。Gate 1 随后审核该文件。Artifact provenance manifest 的 resume parent hash 必须指向该 optimized draft，最终 Gate 2 继续绑定整个 manifest。

Runtime checkpoint 保存在 `.apply-pilot/resume-optimization/`，source/export bytes 保存在 `.apply-pilot/artifacts/`。普通 receipts 只写 summary hash，不复制简历、excerpt 或 missing keyword 正文。

## 研究依据与检索覆盖

本次检索覆盖仓库的 scripts、schemas、config、skills、docs、examples 和 tests，查询 Simplify、score、keyword、refinement 及对应中文术语；同时核对通用精修 skill 的流程要求和本开发任务的全部 8 个 native 可用历史 turn，返回 `hasMore=false`。Native 最近 50 个任务与 pinned metadata 中，与本仓库匹配的开发任务为 1 个。没有把“最近任务检索”表述成对所有私人聊天归档的穷尽扫描。

原 Job-Search 系统的真实简历、答案、申请记录、私人会话和秘密不进入本研究或仓库；个人阈值、Skills 例外、雇主定制内容与旧授权也不作为公共默认。

官方依据（核对日期 2026-10-24）：

- [Build and tailor your resume](https://help.simplify.jobs/en/articles/8040103-build-and-tailor-your-resume-on-simplify)：独立候选版本、不同评分维度、保存/导出与内容审核。
- [Tailor your resume with Copilot](https://help.simplify.jobs/help/articles/0515607-tailor-your-resume-with-copilot)：仅补充准确描述真实经历的术语，评分不是雇主通过线。
- [Terms of Use](https://simplify.jobs/terms)：自动访问限于服务明确提供或授权的范围；本实现仅使用用户确认的 runtime 输入和虚构测试数据。

| 迁移要求 | 代码/验证证据 |
|---|---|
| 真实经历映射与自动补词 | `resume-optimization.mjs`；direct/equivalent、自动 Skills 与 unsupported tests |
| 评分、候选、JD 和 artifact 不混用 | feedback/schema 与 version/save/metric/hash tests |
| 有界迭代与最佳版本 | target、regression、stagnation、max-iterations、below-minimum tests |
| 原始基准和已提交文件不变 | immutable baseline checks、CLI frozen-copy 与 terminal preflight |
| QA/Gate/provenance | CLI 至 Gate 1 的集成测试、scored export hash 与 provenance parent binding |
| 本地隐私与发布 | 工作树/历史隐私扫描、plugin/skill validator、CI |
