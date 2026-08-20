# 参与贡献

感谢你改进 Codex Apply Pilot。本项目中文优先；产品名、portal label、代码标识和必要技术术语可保留 English。

## 提交前

1. 先确认修改属于公开、通用的求职申请工作流。
2. 不要从自己的真实申请目录复制文件。
3. 示例必须完全虚构，不得包含真实姓名、联系方式、简历、公司申请状态、截图、凭据、任务 ID 或私有路径。
4. 新增自动化必须说明网站条款、用户授权、Hard Stop、no-repeat 和失败语义。
5. Simplify 相关改动只能引导官方 UI/官方功能，不能加入 DOM、hidden/private API、抓取或逆向工程。

## 开发流程

```powershell
npm install
npm run validate
```

- 状态转移、Gate、secret rejection、readiness 和 no-repeat 改动必须有行为测试。
- 关键架构或流程变化需同步更新 `.drawio` 源和 SVG 预览，并运行 `npm run diagrams`。
- Skill 保持简洁；条件性流程放到 `references/`，不要把所有模式塞进一个 `SKILL.md`。
- Node.js 实现优先使用 built-ins；新增依赖需说明必要性和供应链影响。
- 不要通过降低测试、扫描或安全规则让 CI 变绿。

## Pull Request 内容

- 说明用户问题与预期行为。
- 列出安全/隐私边界是否变化。
- 列出运行过的命令和结果。
- 若修改状态机，给出旧状态、事件、新状态和 no-repeat 影响。
- 不把日志中的本地路径、页面内容或环境变量复制到 PR。

## 报告安全问题

不要在公开 issue 中发布秘密、真实申请材料或可利用细节。优先使用 GitHub Private Vulnerability Reporting；若仓库尚未启用，请只提交不含敏感细节的联系请求。
