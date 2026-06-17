# PRD — Digital Bank Onboarding & E-Wallet Platform (Fintech)

> **Cách dùng khi demo:** Đăng nhập PM/PO → tạo booking request → mở ô **Extract Skill from PRD / paste PRD** → **copy toàn bộ phần dưới đây** (từ "1. Background" tới hết) → bấm **Extract**.
> Kỳ vọng AI trích ra: **Fintech**, **API Specification**, **BPMN**, **Data Analysis**, **User Story Mapping**, **Stakeholder Workshop**, và đề xuất level **SENIOR** (vì có payments, compliance, fraud, integrations, reporting). Nếu mạng lỗi, fallback heuristic vẫn bắt đúng các từ khóa này.

---

## 1. Background & Problem
Our company is launching a **Fintech** product: a mobile **digital bank onboarding and e-wallet platform** for retail customers in Vietnam. Today, customer onboarding is manual, KYC verification is slow, and wallet top-up, peer-to-peer transfer, and bill-payment journeys are fragmented across disconnected systems. We need a single, compliant platform that onboards a customer in under 5 minutes and supports high-volume, low-value transactions with strong fraud controls.

## 2. Goals & Success Metrics
- Reduce digital onboarding time from 2 days to **under 5 minutes** (eKYC straight-through processing rate ≥ 70%).
- Support **5,000 transactions/minute** at peak with 99.95% uptime.
- Keep fraud/chargeback rate below 0.1% of transaction value.
- Daily automated **reconciliation** with the core banking ledger at 100% match before 8:00 AM.

## 3. Stakeholders & Alignment
This is a multi-stakeholder program. We will run a series of **Stakeholder Workshop** sessions to align requirements and sign-offs across: Compliance & AML, Risk & Fraud, Core Banking Operations, Finance/Treasury (reconciliation), Customer Support, Information Security, and the Mobile Product team. Each workshop produces agreed acceptance criteria and a decision log; conflicting rules (e.g. KYC risk tiers vs. transaction limits) must be resolved with the Compliance and Risk owners.

## 4. Scope — Epics & User Stories
We will apply **User Story Mapping** to break the journey into epics and prioritized stories with clear acceptance criteria.

**Epic A — Customer Onboarding (eKYC)**
- As a new customer, I want to open an account by taking a photo of my national ID and a selfie, so that I can be verified without visiting a branch.
- As a compliance officer, I want high-risk applications auto-routed to manual review, so that AML obligations are met.
- Acceptance: OCR + liveness check pass; sanction/PEP screening returns clear; account created with the correct KYC tier.

**Epic B — E-Wallet Top-up & Transfer**
- As a customer, I want to top up my wallet from a linked bank card or account, so that I can spend instantly.
- As a customer, I want to send money to another wallet via phone number, so that P2P transfer is frictionless.
- Acceptance: balance updates atomically; failed top-ups are auto-reversed; transfer limits enforced per KYC tier.

**Epic C — Bill Payment & Refund/Dispute**
- As a customer, I want to pay utility and telco bills, so that I manage everything in one app.
- As a support agent, I want to raise a refund/dispute and track its status, so that complaints are resolved within SLA.

## 5. Business Process Flows (BPMN)
We will model the core operational flows in **BPMN** before build, including swimlanes for customer, system, and back-office roles:
- **KYC Approval flow:** capture → OCR/liveness → AML screening → auto-approve or escalate to manual review → account activation.
- **Transaction Reconciliation flow:** wallet ledger ↔ payment gateway settlement ↔ core banking, with exception handling for mismatches.
- **Refund / Dispute flow:** intake → eligibility check → reversal authorization → notification, with timers for SLA escalation.

## 6. Integrations & API Specification
The platform is integration-heavy and requires a detailed **API Specification** (request/response contracts, idempotency keys, error codes, retry and timeout behavior) for each external system:
- **Payment Gateway API** — card and bank top-ups, settlement webhooks.
- **eKYC / Identity Provider API** — OCR, liveness, sanction & PEP screening.
- **Core Banking API** — ledger posting, balance inquiry, reconciliation feeds.
- **OTP / SMS Gateway API** — transaction authentication.
- **Card Network API** — tokenization and 3-D Secure.
All integrations must be idempotent, signed (HMAC), and rate-limited; every endpoint needs a documented contract and sandbox test cases.

## 7. Reporting & Analytics (Data Analysis)
Operations, Risk and Finance need **Data Analysis** and reporting:
- Real-time transaction monitoring dashboard (volume, success rate, latency).
- **Fraud detection** analytics: velocity rules, anomaly scoring, and cohort analysis of suspicious accounts.
- Daily reconciliation and settlement reports with exception drill-downs.
- Customer behavior cohorts to measure activation, retention, and average revenue per user.

## 8. Compliance, Risk & Non-Functional
- Regulatory: AML/CFT, eKYC per SBV guidelines, PCI-DSS for card data, data residency and audit logging of every financial action.
- Security: encryption in transit and at rest, role-based access, full audit trail.
- Performance: sub-300ms p95 for balance and transfer APIs; horizontal scalability.

## 9. Open Questions / Risks
- Final KYC risk-tier matrix pending Compliance sign-off.
- Payment gateway sandbox availability may delay integration testing.
- Fraud thresholds need tuning against historical transaction data after launch.

---
*Required BA profile (expected from this PRD): a **Senior** BA with **Fintech** domain experience, strong in **API Specification**, **BPMN** process modeling, **Data Analysis** for reporting/fraud, **User Story Mapping**, and facilitating **Stakeholder Workshop** across compliance, risk, and operations.*
