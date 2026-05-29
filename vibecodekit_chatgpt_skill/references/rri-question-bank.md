# RRI Universal Question Bank — ChatGPT Edition

Use this as a menu, not a script. Select questions based on project risk and what the Scan already answered.

## End User Persona

### Identity & Context
- Who are the primary users?
- How many user types exist?
- What is their technical level?
- Where do they use it: office, mobile, field, home?
- Usage frequency: daily, weekly, ad-hoc, seasonal?

### Workflow & Goals
- What is the main goal when opening the product?
- What is the end-to-end workflow?
- What happens before and after using this tool?
- What is the most critical action?
- What is the fastest path users expect?

### Pain Points
- What is frustrating about current solutions?
- What would make users abandon this?
- What would delight users beyond basic function?
- What speed is expected: instant, a few seconds, batch okay?

### Access & Devices
- Primary device: mobile, desktop, tablet, mixed?
- Offline mode needed?
- Accessibility requirements?
- Language/localization requirements?

## Business Analyst Persona

### Goals & Metrics
- Primary business goal?
- Success metrics/KPIs?
- Impact if project fails or is delayed?
- Revenue or efficiency model?

### Rules & Logic
- Top 3–5 features by priority?
- Complex business rules?
- Approval workflows?
- Calculations or conditional rules?
- Data entities and relationships?
- Reports/analytics needed?

### Compliance & Constraints
- Regulatory requirements?
- Audit trail needed?
- Data retention rules?
- Timeline/budget constraints?
- Stakeholders who approve output?

### Process
- Existing business process to integrate with?
- Notifications/alerts?
- Imports/exports?
- Required formats: CSV, Excel, PDF, JSON, API?

## QA / Tester Persona

### Validation
- Valid input ranges and formats?
- Required fields?
- Empty state behavior?
- Maximum data volumes?
- Concurrent usage expectations?

### Error Handling
- How should errors be shown?
- Error language/tone?
- Retry/undo/rollback needed?
- What happens when dependencies fail?

### Security & Data
- Data sensitivity: public, internal, PII, financial, health?
- Auth method?
- Authorization model?
- Input sanitization concerns?
- Logging restrictions?

### Quality Gates
- Performance targets?
- Uptime/availability?
- Browser/device/runtime support?
- Required tests: unit, integration, e2e, contract?

## Developer Persona

### Architecture
- Which existing patterns should be reused?
- Technical debt to address first?
- Performance bottlenecks?
- Dependency risks?
- Where should new code live?

### Code Quality
- Type safety expectations?
- Lint/format rules?
- Test coverage expectations?
- Documentation standards?
- Naming conventions?

### Integration
- External APIs/services?
- Authentication with external services?
- Webhooks/events?
- Data synchronization?
- Migration/backfill needed?

### Developer Experience
- Local setup requirements?
- CI/CD?
- Feature flags?
- Logging/debug tools?
- Seed data or fixtures?

## Operator Persona

### Deployment
- Target environment: local, VPS, cloud, serverless, mobile store?
- Dev/staging/prod environments?
- Containerization needed?
- Deployment frequency?
- Rollback strategy?

### Observability
- Monitoring requirements?
- Error alerting?
- Logging aggregation?
- Analytics?
- APM/tracing?

### Backup & Recovery
- Backup frequency?
- RPO/RTO?
- Disaster recovery?
- Migration/restore testing?

### Scaling & Cost
- Expected growth?
- Auto-scaling?
- CDN/multi-region?
- Cost ceiling?
- Rate limits?

## Question Mode Examples

### CHALLENGE
```text
I propose we start with email/password auth and add OAuth later. OK?
```

### GUIDED
```text
For notifications, choose:
A. In-app only
B. Email only
C. In-app + email
D. Custom
```

### EXPLORE
```text
Walk me through the most complicated real-world case this system must handle.
```
