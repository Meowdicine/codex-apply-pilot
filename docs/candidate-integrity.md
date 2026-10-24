# 候选完整性链路

本链路在 tailoring、upload 或 browser action 之前先核对本地事实，再把实际答案和 artifact 冻结到同一候选。它不读取第三方隐藏接口、不控制 Simplify DOM，也不把真实运行数据提交到 Git。

## 1. Canonical candidate identity v2

Identity v2 使用 official HTTPS URL、official host 与 employer requisition ID 建立强身份。存在 requisition ID 时，`candidateId` 以 host + normalized requisition ID 为主；缺失时使用 canonical URL。URL 会移除 fragment、已知 tracking 参数、重复尾斜线并排序 query parameters。

Company、role 与 location 的 canonical label 和 aliases 不进入 `candidateId`，而是形成 collision review key。这样更名不会制造新候选，但相同 company/role/location 的不同 requisition 会要求明确复核。

```powershell
node scripts/apply-pilot.mjs preflight --state-dir .apply-pilot `
  --company "示例公司" --role "示例岗位" --location "示例城市" `
  --official-url "https://careers.example.test/jobs/DEMO-001" --job-id "DEMO-001" --json
```

## 2. Terminal-first preflight

Preflight 在创建候选以及高风险 state event 前读取 application index 与 receipt ledger。判定优先级为：

1. `stop-no-repeat`：已有 submit intent、verified submit 或 unknown no-repeat evidence。
2. `stop-terminal`：已有其他 terminal state。
3. `stop-duplicate`：同一 active candidate 已存在。
4. `review-collision`：official source 或 company/role/location aliases 疑似碰撞。
5. `proceed`：未发现阻断证据。

Collision review 只能把 `review-collision` 确认为 `proceed-reviewed-collision`。它不能覆盖 terminal、no-repeat 或 exact active duplicate。Review JSON 必须绑定当前 `collisionFingerprintSha256`、`candidateId`、`reviewedAt`、`reviewedBy=user`、`decision=distinct-candidate` 与 reason。Fingerprint 由 identity 和 findings 计算，因此重新检查的时间戳不会使已核验的不同候选结论失效；新增碰撞证据会使旧 review 失效。

## 3. Candidate answer snapshot

账号就绪并进入 `form-staging` 后，先准备 questions JSON。每一项保留 portal 的原始 prompt、显式 semantic key、answer mapping、review decision、review actor 与 review time。

```json
{
  "reviewedBy": "user",
  "reviewedAt": "2026-01-15T00:00:00.000Z",
  "questions": [
    {
      "portalQuestionId": "demo-q1",
      "prompt": "Will you now or in the future require sponsorship?",
      "semanticKey": "legal.sponsorship.required",
      "answerQuestionId": "legal.sponsorship-required",
      "answerQuestionRevision": 1,
      "decision": "use-stored-answer"
    }
  ]
}
```

```powershell
node scripts/apply-pilot.mjs snapshot-answers --state-dir .apply-pilot `
  --application APPLICATION_ID --questions-file .\candidate-questions.json
```

过期答案、revision drift、缺失事实和秘密字段 fail closed。Protected/legal 或非 `auto-fill` 答案要求逐候选用户审核，并默认只把 value hash 写入 snapshot。

## 4. Artifact provenance lock

Artifact plan 只把 `file` 用作本地 hash 输入；absolute path 不进入最终 manifest。至少包含一个与 `resumeVersionSha` 完全一致的 resume，以及一个 `sourceType=portal-form` 的 form snapshot。

```json
{
  "artifacts": [
    {
      "kind": "resume",
      "logicalName": "candidate-resume.pdf",
      "mediaType": "application/pdf",
      "file": "./artifacts/candidate-resume.pdf",
      "sourceType": "candidate-generated",
      "sourceId": "software-baseline-v1",
      "sourceArtifactSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },
    {
      "kind": "form-snapshot",
      "logicalName": "form-snapshot.json",
      "mediaType": "application/json",
      "file": "./artifacts/form-snapshot.json",
      "sourceType": "portal-form"
    }
  ]
}
```

```powershell
node scripts/apply-pilot.mjs lock-artifacts --state-dir .apply-pilot `
  --application APPLICATION_ID --artifacts-file .\artifact-plan.json
```

CLI 从实际 bytes 计算 hash，随后把 `candidateIdentitySha256`、`officialUrlSha256`、`resumeVersionSha256`、`answerSnapshotSha256`、`formSnapshotSha256` 与所有 source provenance 写入 content-addressed manifest。`FORM_STAGED`、Gate 2 和 submit authority 都必须保持这些绑定不漂移。

## Runtime artifacts

- `preflight/<candidateId>/<sha>.json`
- `snapshots/answers/<applicationId>/<sha>.json`
- `manifests/artifacts/<applicationId>/<sha>.json`
- `artifacts/<sha>`：与 manifest 相同 bytes 的冻结副本；上传时使用该副本。

这些文件属于 `.apply-pilot/` runtime，不得提交。Receipt ledger 只记录 event payload hash，不复制答案值、prompt 正文或 artifact 内容。

CLI 以 `.writer.lock` 串行推进同一 state directory。进程异常结束时不自动抢锁；先核验原进程已结束和候选状态，再人工恢复。Preflight 同时读取 index、实际 application 文件和 receipt ledger，避免部分写入使已存在候选被遗漏。Gate 2 与 submit 前重新核验 snapshot、manifest 和冻结文件 bytes。
