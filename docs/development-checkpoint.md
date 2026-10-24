# Candidate integrity foundation 开发记录

记录日期：2026-10-24。

## 范围与结果

- 扩展问卷 catalog，支持条件问题、答案 revision/scope、review expiry 与更严格的值类型。
- 实现 terminal-first preflight、canonical candidate identity v2、candidate answer snapshot 和 artifact provenance lock。
- 新 CLI 命令为 `preflight`、`snapshot-answers` 与 `lock-artifacts`。
- 半自动和全自动共享 candidate、answer、resume/form/document provenance 校验；Gate 2 与 submit intent 绑定同一快照。
- Simplify 按 score 自动循环补充 keywords 尚未实现；现有 resume skill 只规定有证据支持的关键词精修。

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
- 本次本地验证结果：59 项 Node tests 全部通过，76 个工作树文本文件通过隐私扫描，plugin manifest 与 4 个 skills 校验通过；提交前历史扫描覆盖 65 个可达 blob。
- 所有测试使用临时合成数据；未执行 live portal、Simplify、账号或真实申请操作。
- 既有 v1 runtime records 不自动改写；新建候选使用 identity/application v2，运行数据升级需要单独处理。
