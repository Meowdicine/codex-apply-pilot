# 简历 artifact QA

内容精修后、Gate 1 或 policy release 前读取本文件。

## 内容检查

- candidate company/role binding 正确；
- 所有 dates、titles、degrees、skills、metrics 与 claims 匹配批准证据；
- 没有 comments、tracked-change residue、hidden text 或 placeholder text；
- contact data 当前有效且确实用于申请；
- 未嵌入秘密或 protected answers；
- links 有效且为有意加入。

## Artifact 检查

- 文件可打开，render 无 clipping/overlap；
- 格式支持时，text 可选择/搜索；
- page count 与 layout 匹配当前用户 policy；
- fonts、symbols 与 links 一致呈现；
- exported artifact 与已审计版本相同；
- 最终 export 后计算 SHA-256；之后任何变更都使其失效。

## 非秘密 review packet

只包含：

- candidate ID、company 与 role；
- official source host/hash；
- baseline ID/family 与 candidate version ID；
- final artifact filename 与 SHA-256；
- QA pass/fail list；
- supported/unsupported keyword counts，不含 resume prose；
- current state version 与准确 next authorization boundary。

`semi-auto` 中用户批准准确 artifact hash。`full-auto` 中当前 readiness、allowlist 与 consent 必须授权同一 hash。artifact 变化后必须重新 QA 并取得新授权。
