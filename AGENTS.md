# Codex Apply Pilot — contributor instructions

This repository is Chinese-first. Keep user-facing documentation and examples in Simplified Chinese; preserve product labels, portal labels, code identifiers, and exact technical terms in English.

## Product boundary

- This is a local-first workflow toolkit, not an official Simplify, OpenAI, or employer-portal connector.
- Do not implement scraping, private API access, reverse engineering, CAPTCHA/2FA bypass, credential guessing, or automation that violates a third party's terms.
- Simplify support is guided use of its official UI, Copilot, and Resume Builder. The repository may prepare truthful content and checklists, but must not drive Simplify through unauthorized automated means.
- Employer-portal adapters are disabled until the user has verified the exact site's terms and explicitly allowlisted the domain.

## Data and safety

- Commit only fictional examples. Never commit real names, email addresses, phone numbers, addresses, resumes, application answers, screenshots, cookies, tokens, passwords, OTPs, task/thread IDs, or local absolute paths.
- Runtime data belongs in `.apply-pilot/` or a user-selected directory that is excluded from Git.
- Credentials belong in the operating-system credential store. JSON may contain only a non-secret `secretRef`.
- Truthfulness is mandatory. Never invent technologies, dates, metrics, qualifications, work authorization, sponsorship, legal eligibility, protected facts, or credentials.
- A final click is at-most-once: persist intent first; ambiguous outcome becomes `unknown-submit-state-no-repeat` and must never be retried blindly.

## Modes

- Semi-auto has two candidate-bound gates: refined-resume approval and final-submit approval. The user owns new account registration/login.
- Full-auto is an advanced private/self-hosted mode. It requires readiness checks, explicit time-bounded consent, an allowlist, a daily cap, and no unresolved hard stops. Host or site-required confirmation still applies.
- CAPTCHA, OTP/2FA, OAuth/account linking, password reset, payment, contracts, government/immigration forms, and unsupported material facts always stop or park the candidate.

## Development

- Keep skills concise; put mode-specific detail in `references/`.
- Use Node.js built-ins only unless a dependency is clearly justified.
- Add or update tests for state transitions, gates, secret rejection, readiness, and no-repeat behavior.
- Run `npm run validate`, the plugin validator, and all skill validators before release.
- Keep `.drawio` sources and generated SVG previews synchronized through `npm run diagrams`.
