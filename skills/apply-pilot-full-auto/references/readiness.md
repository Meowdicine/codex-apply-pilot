# Full-auto readiness

每次 full-auto session 前，以及相关 policy、consent、capability 或 application index 变化后读取本文件。

## 默认检查

从当前 policy 读取阈值，不要硬编码。仓库默认值为：

- verified semi-auto submissions：至少 3；
- approved immutable resume baselines：至少 3；
- distinct resume families：至少 3；
- distinct successful portal families：至少 2；
- full-auto 必填 questionnaire answers：完整且当前有效；
- OS credential store：ready；
- browser smoke test：passed；
- exactly-once recovery test：passed；
- dry runs：至少 2；
- unresolved security/unsupported-fact/unknown-submit Hard Stops：0；
- active、未撤销、有时间边界且含非空 domain allowlist 的 consent。

## 证据规则

- 只有 state 为 `submitted-verified` 且来自官方证据的申请才计为 semi-auto success。
- 只计算具有有效 artifact SHA-256 的 immutable baseline。
- 不为 `unknown` 记录编造 portal family。
- 缺失、null、空、过期或来源错误的必填答案都视为不完整。
- Capability flag 是已完成本地测试的证据，不是为了方便切换的值。
- 未解决 Hard Stop 阻止 readiness；删除记录不等于解决。

返回包含 `id`、`passed` 与非秘密 `evidence` 的 check array。只有全部检查通过时才有 `ready=true`。

## 重新核验

Readiness 不是永久状态。Full-auto session 前，以及 consent、cap、domain、browser capability、questionnaire、artifact 或 candidate state 可能变化时，在 final submit 前重新评估。
