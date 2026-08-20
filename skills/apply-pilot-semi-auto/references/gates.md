# 候选绑定 Gate 合约

创建、批准、作废或审计任一 semi-auto Gate 时读取本文件。

## Gate 1

为一个候选专用简历版本展示 review packet。最低绑定：

- candidate ID 与 company/role；
- official source host/hash；
- baseline ID/family；
- artifact filename 与 `resumeVersionSha`；
- content/artifact QA disposition；
- state version。

只有对该准确 artifact 的明确批准才能继续。任何编辑、re-export、candidate/source drift 或 state replacement 都会使批准失效。

## Gate 2

只从 `submit-review-required` 生成 manifest。绑定：

- `candidateId`;
- `officialUrlHash`;
- `resumeVersionSha`;
- `formSnapshotSha`;
- current `stateVersion`;
- final button label;
- short `expiresAt`.

批准必须是用户对当前 manifest 的直接决定。“Continue”、Gate-1 批准、旧候选批准或一般许可都不是 Gate-2 authority。

## 点击前验证

- manifest 当前有效且未过期；
- candidate、URL hash、resume hash、form hash 与 state version 匹配；
- `submitAttemptCount=0` 且不存在 submit intent；
- 不存在 terminal/no-repeat evidence；
- 不存在 active security 或 unsupported-fact boundary；
- final button 含义明确。

点击前写入 `SUBMIT_INTENT`。即使页面之后变得不明确，该 intent 也已消费权限。
