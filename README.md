# Codex Apply Pilot

一个**中文优先、本地优先**的 Codex 求职申请工作流。它帮助用户先整理可验证的个人预设与简历基准，再从有两道人工审核 Gate 的半自动模式，逐步升级到有范围、有期限、可撤销的全自动模式。

当前发布形态是 **private alpha**；未来若转为公开仓库，必须先重新完成隐私、条款与历史扫描。

> [!IMPORTANT]
> 本项目处于实验阶段，不隶属于或代表 OpenAI、Simplify 或任何招聘平台。使用者必须遵守目标网站条款、当地法律及雇主要求。私有部署不会放宽安全边界：本项目不抓取 Simplify、不调用隐藏 API、不绕过 CAPTCHA/2FA，也不猜测法律、身份、资历或凭据事实。

## 它解决什么问题

- 用结构化问卷一次性整理常见申请答案，并记录来源、敏感度和可自动填写范围。
- 引导用户在 Simplify 官方 UI 中完成 Profile、Documents 与 Resume Builder 准备。
- 从不可变简历基准创建候选岗位专用版本，进行真实、可追溯的关键词精修和 QA。
- 半自动模式保留两道候选绑定 Gate：简历审核与最终提交审核。
- 全自动模式只在半自动经验、简历基准、浏览器测试和有限授权全部通过后开放。
- 用候选 ID、状态版本、artifact hash 和一次性提交意图避免重复提交。

## 两种模式

| 能力 | 半自动 `semi-auto` | 全自动 `full-auto` |
|---|---|---|
| 推荐对象 | 首次使用者与新网站 | 已稳定跑通多次半自动的用户 |
| 新账号注册/登录 | 用户完成并确认 | 仅在已验证、已授权且无安全挑战的网站自动继续；否则回退 |
| 简历精修后 | Gate 1：用户审核候选绑定版本 | readiness 与政策验证通过后自动放行 |
| 提交前 | Gate 2：用户审核候选、简历、表单快照 | 在域名 allowlist、期限和每日上限内自动放行 |
| CAPTCHA、OTP/2FA、OAuth、合同、付款、政府表单、缺失重要事实 | 停止或安全停放 | 同样停止或安全停放 |
| 最终点击 | 每个未漂移候选最多一次 | 每个未漂移候选最多一次 |

全自动不是“无限授权”。默认配置要求至少 3 次已核验的半自动成功、3 份不可变简历基准、3 个简历族、2 个 portal family、2 次 dry run、OS credential store、浏览器 smoke test、exactly-once recovery test，以及仍在有效期内的域名 allowlist 授权。

## 快速开始

要求：Node.js 20+、Git，以及能够使用 Codex skills 的 Codex 环境。

```powershell
git clone https://github.com/Meowdicine/codex-apply-pilot.git
cd codex-apply-pilot
npm install
npm run validate
node scripts/apply-pilot.mjs init --state-dir .apply-pilot
node scripts/apply-pilot.mjs questionnaire --state-dir .apply-pilot --mode semi-auto --required-only
node scripts/apply-pilot.mjs doctor --state-dir .apply-pilot --json
```

初始化本地状态后，使用初始化 skill 完成问卷和 Simplify Profile：

```text
请使用 $apply-pilot-onboarding 初始化我的本地预设，并引导我完成 Simplify Profile。
```

随后从半自动模式开始：

```text
请使用 $apply-pilot-semi-auto 通过两道审核 Gate 暂存这个准确的职位申请。
```

本地运行数据写入 `.apply-pilot/` 或用户指定目录；该目录不得提交到 Git。凭据只能保存在操作系统 credential store，JSON 中只允许非秘密 `secretRef`。

## 推荐学习路径

1. 阅读[开始使用](docs/getting-started.md)与[安全和隐私](docs/security-and-privacy.md)。
2. 用[预设问卷](docs/preset-questionnaire.md)整理真实答案。
3. 按[Simplify Profile 引导](docs/simplify-profile-onboarding.md)完成官方 UI 配置。
4. 完成至少数次[半自动申请](docs/semi-auto-mode.md)，建立多份不可变简历基准。
5. 阅读[全自动模式](docs/full-auto-mode.md)，通过 maturity/readiness 检查后再显式启用。

## 架构

项目把策略、运行时、候选状态、审计回执和秘密分开管理。浏览器执行者不能把“页面看起来成功”当作官方成功；调度器不能替浏览器执行者点击、填表或处理凭据。

- [系统架构与权威分层](docs/architecture.md)
- [双模式状态机](docs/diagrams/semi-vs-full-state-machine.svg)
- [安全边界](docs/diagrams/security-boundaries.svg)
- 可编辑图源位于 `docs/diagrams/*.drawio`

## 仓库结构

```text
.codex-plugin/       Codex plugin manifest
skills/              可独立触发的 Codex skills
config/              默认政策与中文问卷目录
schemas/             本地数据 JSON Schema
scripts/             CLI、状态机、验证与图表生成
examples/            仅含虚构数据的示例
docs/                中文用户文档与 draw.io 图
```

## 明确不做

- 不发布任何真实简历、申请答案、截图、邮箱、任务 ID、浏览器资料或申请记录。
- 不把个人地点、薪酬、学校、雇主规模或岗位偏好写成公共默认规则。
- 不通过 DOM 注入、private API、逆向工程或抓取控制 Simplify。
- 不绕过网站安全控制，不盲目重试不明确的账号或提交状态。
- 不保证录用、ATS 分数、网站兼容性或申请成功率。

## 参与贡献

请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)、[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) 与[安全和隐私](docs/security-and-privacy.md)。提交前运行：

```powershell
npm run validate
```

English documentation is planned, but this release intentionally provides only the Chinese entry point.

## License

[MIT](LICENSE)
