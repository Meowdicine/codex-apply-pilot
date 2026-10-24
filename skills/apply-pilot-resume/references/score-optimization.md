# Score-guided keyword optimization

只有用户请求根据评分做真实、有界精修时才启用。

1. 读取当前 candidate、policy、catalog，运行 terminal-first preflight，要求 `resume-preparing`。
2. 选择最接近工作族的已批准 immutable reference；核验 source bytes。不要复制历史雇主 package 的事实。
3. 从当前官方 JD 和批准材料构建 plan/evidence。只在确有用户批准时记录 user review；score 不能替代经历依据。
4. 用户配置 metric、target/minimum 与迭代限制。没有通用默认通过线；不能把某位用户的 thresholds 或 Skills 例外写成公共政策。
5. 调用 `resume-optimize-start`。Technical evidence 明确允许 Skills 展示时可配置 `autoAppendSkills`；其余改写必须有批准的 exact wording。
6. 引导用户在 Simplify 官方 UI 中选准版本与 Target Job，应用改动或使用官方 tailoring。用户核验输出后，等待保存/重新计算，导出 exact artifact；不由 agent 操作 Simplify DOM、AI Generate、内部 API 或抓取 score。
7. 用户确认 score feedback 后调用 `resume-optimize-step --feedback-file ... --scored-artifact-file ...`。它会自动选择、应用有依据的缺词改动；输出新 draft 后回到步骤 6，直到 engine 给出终止状态。
8. 达标或安全耗尽后选择 engine 推荐的已评分版本，完成 truthfulness、Profile preservation、layout 和 PDF/DOCX QA。未达 minimum 则按当前 policy park/skip。
9. `RESUME_READY` 绑定推荐 source、exact scored export、checkpoint hash 和 `qaPassed=true`；保留 Gate 1/Gate 2 与 final-click no-repeat。不得把 optimizer 的 score 当作最终提交授权。

完整输入、输出和停止语义见仓库 `docs/resume-score-optimization.md`。Schema 见 `resume-optimization-plan.schema.json` 与 `resume-score-feedback.schema.json`。Runtime plan 与 checkpoint 只能保存在 Git 外状态目录中。
