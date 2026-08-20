# 使用 Codex 引导完成 Simplify Profile

Simplify 在本项目中是用户主动操作的官方 Profile、Copilot 与 Resume Builder 界面。本项目不是 Simplify connector，也不自动化其 DOM、隐藏 API、抓取或安全控制。

## 操作边界

- 用户负责在 Simplify 官方网站登录并保持可见控制。
- Codex 可以根据问卷和真实材料整理待填内容、逐项核对、解释字段和生成检查清单。
- 用户自行粘贴或确认重要内容；任何页面写入能力都必须来自用户当前环境允许的官方/可见交互。
- 不读取或保存密码、OTP、cookie、token、recovery code 或未授权的页面数据。
- Simplify 的 `Applied` 标记可作为重复申请风险信号，但不能代替雇主官方成功回执。

## 建议顺序

### 1. Personal information

从 `answers.json` 中只使用已验证的姓名、求职邮箱、电话和公开链接。显示值与官方证件不一致时停止并让用户修正来源，不自动“纠错”。

### 2. Education 与 availability

核对学校/教育机构、degree/program 官方表述、预计毕业年月、可开始日期和可工作时长。日期和学位不得由 Codex猜测。

### 3. Work authorization 与 sponsorship

只使用问卷中 `user-explicit` 的答案。若为空、过期或语义与表单不一致，保持未填并提示用户；不要从所在地、国籍印象或学校身份推断。

### 4. Links 与 ordinary preferences

核对 LinkedIn、GitHub/Portfolio、地点、工作模式、岗位族等普通偏好。薪酬、relocation 和 travel 若配置为 `ask-each-time`，不得升级成默认自动答案。

### 5. Documents

只上传经过用户批准且 hash 可验证的文档。文件名、岗位和 artifact SHA-256 必须绑定；不要把“最新下载”当作正确版本。

### 6. Resume Builder baselines

建立少量真实经历族基准，每个基准：

- 已由用户审核；
- 标记 `immutable: true`；
- 有稳定的 `family` 和 `artifactSha256`；
- 不包含为某个具体岗位捏造的技能或经历；
- 只作为候选专用副本的起点。

## 完成检查

- 所有半自动必填问卷答案已存在且未过期。
- 法律和 protected 答案均为用户明确来源。
- Profile 页面没有虚构、占位或互相冲突的事实。
- Documents 仅含用户准备使用的真实文件。
- 至少一份不可变简历基准已登记并能复核 hash。
- 没有将任何凭据或页面秘密写入 JSON、日志、截图或回执。

完成后再进入具体岗位流程。新岗位仍必须核验其官方招聘页面；Simplify 卡片或 match score 不能单独授权申请。
