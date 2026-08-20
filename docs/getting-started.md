# 开始使用

本指南建立一个不含真实秘密、可审计、可回退的本地工作区。首次使用请从半自动模式开始。

## 1. 环境检查

- Node.js 20 或更高版本。
- 能够加载本仓库 skills 的 Codex 环境。
- 用户自己控制的浏览器 profile；不要使用共享、公司受管或来源不明的登录环境。
- 操作系统 credential store 可用；密码、OTP、cookie 和 token 不写入项目文件。

克隆后运行：

```powershell
npm install
npm run validate
```

`npm run validate` 会执行语法、状态机测试、隐私扫描等项目校验。若失败，先修复失败项，不要带着未知状态开始申请。

## 2. 初始化本地状态

运行项目 CLI 的 `init` 命令，或让 `$apply-pilot-onboarding` 完成同等初始化。默认运行目录为 `.apply-pilot/`；也可以指定一个已排除 Git 同步的本地目录。

```powershell
node scripts/apply-pilot.mjs init --state-dir .apply-pilot
node scripts/apply-pilot.mjs questionnaire --state-dir .apply-pilot --mode semi-auto --required-only
node scripts/apply-pilot.mjs doctor --state-dir .apply-pilot --json
```

初始化后应存在以下逻辑数据：

- `policy.json`：当前用户选择的模式与限制。
- `profile.json`：已验证的普通 Profile 事实。
- `answers.json`：结构化问卷答案，不含秘密。
- `consent-policy.json`：全自动有限授权和能力检查。
- `resume-catalog.json`：不可变简历基准的 ID、族与 hash。
- `applications/`：候选绑定状态与索引。
- `receipts/events.jsonl`：非秘密状态转移回执。

不要把真实运行目录复制进仓库，也不要把完整页面、表单或简历正文写入普通回执。

## 3. 完成预设问卷

阅读[预设问卷](preset-questionnaire.md)，优先完成半自动必填项。法律、工作资格、sponsorship、protected/demographic 等内容只能来自用户明确回答，不能从姓名、学校、地址或简历推断。

## 4. 完成 Simplify Profile

按[Simplify Profile 引导](simplify-profile-onboarding.md)操作。用户在 Simplify 官方 UI 中登录和操作；Codex 可以准备内容、核对字段和给出逐项清单，但不得抓取页面、调用隐藏接口或绕过网站交互。

## 5. 建立简历基准

至少准备一份经过用户审核的不可变基准。推荐按真实经历族划分，例如 Software、Data/ML、Infrastructure。基准只记录 ID、族、批准时间与 artifact SHA-256；每个岗位从最接近的基准创建新副本，绝不原地改写基准。

## 6. 跑通半自动模式

按[半自动模式](semi-auto-mode.md)完成。创建候选前先记录准确的官方 HTTPS URL：

```powershell
node scripts/apply-pilot.mjs new-application --state-dir .apply-pilot `
  --company "示例公司" --role "示例岗位" `
  --official-url "https://careers.example.test/jobs/DEMO-JOB-001" `
  --job-id "DEMO-JOB-001" --portal-family "example" --mode semi-auto
```

以上名称和 URL 仅为虚构结构示例。实际运行必须使用当前官方雇主页面。

然后完成：

1. 核验官方 HTTPS 职位源和用户自定义筛选条件。
2. 创建候选专用简历，完成真实精修与 QA。
3. Gate 1 审核锁定的简历版本。
4. 用户完成新账号注册与登录。
5. 暂存表单并生成快照 hash。
6. Gate 2 审核候选、简历、表单版本和最终按钮。
7. 持久化一次性提交意图后最多点击一次，并核验官方成功页。

## 7. 何时考虑全自动

仅当[全自动模式](full-auto-mode.md)中的 readiness 全部通过时启用：

```powershell
node scripts/apply-pilot.mjs readiness --state-dir .apply-pilot --json
node scripts/apply-pilot.mjs mode --state-dir .apply-pilot --set full-auto
```

若新 portal、条款未验证、授权过期、出现 Hard Stop 或任何候选绑定漂移，应回退到半自动或安全停放，而不是放宽规则。

## 完成标准

工作区准备完成时，应能回答：

- 哪些事实可以自动填、哪些每次询问、哪些永不存储？
- 当前简历基准是哪一份，hash 是否可复核？
- 当前候选的官方 URL、状态版本和 submit attempt count 是什么？
- 半自动的两道 Gate 是否绑定同一候选和未漂移 artifact？
- 全自动授权覆盖哪些域名、到何时到期、每日上限多少？
- 遇到未知提交状态时，系统是否会停止重复点击？
