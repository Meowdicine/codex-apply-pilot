# 隐私说明

Codex Apply Pilot 是 local-first、默认无 telemetry 的开源工作流。仓库本身不运营远程账户、数据库或分析服务；真实求职数据应保留在使用者控制的本地环境中。

## 可能处理的数据

根据用户启用的功能，本地运行可能处理：

- 姓名、联系方式、教育和工作经历；
- 简历、求职信、作品链接和职位描述；
- 工作授权、sponsorship、可入职时间等申请答案；
- 可选的人口统计或 accommodation 回答；
- 公司、岗位、官方 URL、申请阶段和去重/提交 receipt；
- 用户授予的模式、域名、时限和提交上限。

仓库只允许虚构示例。真实 profile、answers、resumes、applications、receipts、downloads 和 screenshots 不得提交到 Git。

## 使用目的

数据仅用于用户请求的本地流程：准备 Simplify Profile 内容、选择或精修真实简历、预填已验证答案、维护申请状态、阻止重复提交，以及在用户授权范围内操作允许的雇主门户。

项目不会为广告出售数据，也不会默认发送 telemetry。若未来增加托管服务、analytics 或远程同步，必须在启用前更新本说明并取得明确同意。

## 存储和保留

- 普通状态保存在 `.apply-pilot/` 或用户明确选择的 Git 外目录；更推荐使用仓库外的用户数据目录。
- 密码、token、cookie、OTP 和 session 不属于状态文件；只使用操作系统 credential store 或浏览器原生安全存储。
- 敏感或 protected answers 应最小化保存，并根据用户选择加密或改为逐次询问。
- 本地数据由用户自行决定保留期。删除相应本地目录只删除本项目副本，不会删除 Simplify、OpenAI、浏览器、GitHub 或雇主门户持有的数据。

## 对外披露

没有项目自有服务器接收这些数据。只有在用户授权的流程中，必要字段才会通过用户浏览器发送给明确的第三方站点。每个第三方的条款、隐私政策、数据保留和跨境处理规则独立适用。

Simplify 会处理 profile、简历、申请答案以及可选的敏感信息；使用前应阅读其当前 Privacy Policy 和 Terms。项目与 Simplify、OpenAI 或任何雇主平台均无隶属或授权关系。

## 用户控制

用户可以随时检查、备份、导出或删除本地状态，撤销 full-auto consent，清空域名 allowlist，并停止任何正在进行的流程。账号删除、第三方数据访问或更正请求必须直接通过相应服务办理。

隐私问题可通过 GitHub 仓库 Issue 提出，但请勿在 Issue 中附带真实个人资料、简历、申请答案、凭据或截图。安全漏洞请遵循 [SECURITY.md](SECURITY.md) 的私密报告渠道。
