---
name: apply-pilot-onboarding
description: 初始化本地 Apply Pilot 工作区、收集已核验预设答案，并只通过 Simplify 官方可见 UI 引导用户配置 Profile。适用于首次设置、补问卷、Profile 审计或登记简历基准；不用于提交申请。
---

# Apply Pilot Onboarding

建立一个真实、local-first 且可进入半自动申请的工作区。

## 核心流程

1. 读取仓库 `AGENTS.md`、当前 `config/default-policy.json` 与 `config/questionnaire.zh-CN.json`。
2. 初始化或检查用户指定的状态目录。真实数据必须留在 Git 之外；只有 `.apply-pilot/` 已被忽略时才使用它。
3. 直接向用户收集问卷答案。不得推断 `legal-material` 或 `protected` 事实，也不得把必填答案保存为 `null`。
4. 拒绝密码、OTP、token、cookie、recovery code、security answer、private key 等秘密。运行时支持时只保存 OS vault 的非秘密 `secretRef`。
5. 只用 Simplify 官方可见 UI 引导用户配置 Profile、Documents 与 Resume Builder。可以准备和核对内容，但不得抓取、DOM 注入、调用 hidden/private API、逆向工程或绕过网站控制。
6. 只登记用户批准、具有稳定 `family` 与 SHA-256 的不可变简历基准；绝不原地编辑基准。
7. 报告哪些检查通过、哪些答案缺失/过期，以及下一项准确用户动作。Onboarding 完成不自动启动申请。

## 按需读取

- 收集或审计问卷时读取 [references/questionnaire.md](references/questionnaire.md)。
- 配置 Simplify Profile 时读取 [references/simplify-profile.md](references/simplify-profile.md)。
- 面向用户的设置说明见 [../../docs/getting-started.md](../../docs/getting-started.md)。

## 不变量

- 公共示例必须虚构；绝不把真实用户预设复制进仓库。
- Simplify 是引导式 UI，不是雇主官方成功权威。
- 缺失事实继续保持缺失；便利、match score 或 private deployment 都不构成猜测许可。
- 完成只表示本地前置条件可审计；不授权注册账号、提交表单或点击最终按钮。
