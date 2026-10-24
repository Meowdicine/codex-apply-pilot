# Candidate integrity foundation 开发记录

记录日期：2026-10-24。

## 范围与结果

- 扩展问卷 catalog，支持条件问题、答案 revision/scope、review expiry 与更严格的值类型。
- 实现 terminal-first preflight、canonical candidate identity v2、candidate answer snapshot 和 artifact provenance lock。
- 新 CLI 命令为 `preflight`、`snapshot-answers` 与 `lock-artifacts`。
- 半自动和全自动共享 candidate、answer、resume/form/document provenance 校验；Gate 2 与 submit intent 绑定同一快照。
- 已补充 score-guided local keyword optimizer：根据用户确认的官方 UI 反馈自动改写候选文本，新的 source/export 版本须重新评分；详情见 `resume-score-optimization.md`。

## 修复与决定

- 外部传入的 identity 必须完整重新推导，不能仅信任 URL 或调用者提供的 candidate hash。
- 加载 answer snapshot 时重新计算 content hash，并核对 application、identity、official URL 与有效期。
- Artifact 的 hash 和 byte length 从同一次读取的 bytes 计算；CLI 保存 content-addressed 冻结副本。
- CLI 使用单写者 lock；异常结束后保留阻断，不自动抢锁。Preflight 同时检查 index、application 文件及 receipts。
- Collision review 绑定 identity/findings fingerprint，使重新检查的时间戳变化可兼容，而新增证据使旧 review 失效。
- 修复 worktree `.git` 指针误报，提供 Git 历史隐私扫描。
- 使用仓库内 Node.js plugin/skill validator，无新增依赖。当前 validator 检查本仓库使用的单行 name/description frontmatter、manifest、本地资源和 references；它不替代任意 YAML 的完整解析器。

## 验证与边界

- `npm run validate`：语法、Node tests、工作树隐私扫描、plugin manifest 和全部 skills。
- 合成测试覆盖并发候选创建、writer lock、identity 伪造、snapshot 篡改、artifact 冻结、Gate 漂移和 no-repeat。
- `npm run diagrams`：同步生成 4 组 draw.io/SVG。
- `npm run privacy:history`：扫描全部本地 refs 可达的历史 blob。
- `git diff --check`：提交前空白检查。
- Candidate integrity 首批验证结果：59 项 Node tests 全部通过，76 个工作树文本文件通过隐私扫描，plugin manifest 与 4 个 skills 校验通过；提交前历史扫描覆盖 65 个可达 blob。
- 所有测试使用临时合成数据；未执行 live portal、Simplify、账号或真实申请操作。
- 既有 v1 runtime records 不自动改写；新建候选使用 identity/application v2，运行数据升级需要单独处理。

## Score-guided optimization 迁移批次

- 从核验 source/excerpt 和用户批准的语义映射选择关键词，不复制私人阈值、简历或历史雇主材料。
- 自动生成 technical Skills 改动；对复杂措辞只应用有证据且批准的 exact edit。每轮保存独立 draft 和 receipt hash。
- 采用用户确认的官方 UI score，区分 keyword-match 与 resume-score；editable source 和 exact scored export 分别绑定 hash。
- 达标、回退、停滞、轮数耗尽和 unsupported-only 均有确定停止路径。已停止最佳版本可只刷新评分，不清空预算。
- QA/Gate 1 只能释放已评分、已冻结的 exact export；provenance manifest 继续绑定优化 checkpoint 与 parent draft。
- 检索范围、官方资料、输入 schema 和验收矩阵见 `resume-score-optimization.md`。测试数据全为合成内容，未执行真实 Simplify 浏览器动作。
- 本批次本地结果：95 项测试全部通过，87 个文本文件通过工作树隐私扫描，plugin manifest 和 4 个 skills 校验通过；图源/预览生成与空白检查通过。

## 合并前安全复核

- 回归测试首先复现 9 项失败，再修复实现；不以旧 CI success 替代当前分支复核。
- 每个 full-auto 推进点重新核验 readiness、撤销/过期、精确域名和已验证 portal family；不信任调用者传入的 readiness boolean。
- 每日上限按 UTC 对 index、实际 records 和 durable intent receipts 去重，所有模式的已消费 intent 都计入；缺失历史阻断，新 portal 不静默继承权限。
- Consent 日期/boolean/cap、成熟度唯一性、baseline approval、unknown-account Hard Stop 均 fail closed。
- 答案在写入与 readiness 时使用同样的类型/时间/metadata 校验；snapshot 复用还检查当前 catalog，不复用空值、never-store 或推断的法律答案。
- DNS root dot 统一身份；多个已批准 Skills edit 可安全追加到同一行，不覆盖较早关键词，其他 exact-anchor edit 仍禁止自动重定位。
- 所有新增测试仍只使用临时合成数据；未访问旧系统私人资料、真实账号、portal 或 Simplify UI。
- 合并前本地验证：`npm run validate` 全部通过，107 项测试、88 个文本文件、plugin manifest 与 4 个 skills；图源同步和空白检查通过，历史扫描覆盖 129 个提交前可达 blob。旧测试夹具同步修正 enum-list 的值类型，未放宽生产校验。
