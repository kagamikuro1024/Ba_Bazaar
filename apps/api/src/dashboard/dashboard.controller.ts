import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { ReportsService } from '../reports/reports.service';

type DashboardCitation = {
  id: string;
  label: string;
  value: string;
};

type DashboardLLMSummary = {
  summary: string;
  bullets: Array<{ text: string; citations: string[]; highlights?: string[] }>;
  citations: DashboardCitation[];
  provider: 'deepseek' | 'fallback';
  grounded: boolean;
  reason?: string;
};

type GroundingPacket = {
  timeframe: Record<string, unknown>;
  team: Record<string, unknown>;
  actions: Record<string, unknown>;
  capacity_distribution: unknown;
  overbooked_ba: Array<Record<string, unknown>>;
  bench_ba: Array<Record<string, unknown>>;
  highest_utilization_ba: Array<Record<string, unknown>>;
  top_project_effort: Array<Record<string, unknown>>;
};

@Controller('api/dashboard')
export class DashboardController {
  constructor(
    @Inject(AuthService)
    private readonly authService: AuthService,
    @Inject(ReportsService)
    private readonly reportsService: ReportsService
  ) {}

  @Get('manager-summary')
  async managerSummary(
    @Req() request: Request,
    @Query('from') from?: string,
    @Query('to') to?: string
  ) {
    return this.reportsService.managerSummary(
      await this.authService.getCurrentUser(request),
      from,
      to
    );
  }

  @Get('manager-summary/llm')
  async managerSummaryLLM(
    @Req() request: Request,
    @Query('from') from?: string,
    @Query('to') to?: string
  ): Promise<DashboardLLMSummary> {
    const summary = await this.reportsService.managerSummary(
      await this.authService.getCurrentUser(request),
      from,
      to
    );

    try {
      return await summarizeDashboardWithDeepSeek(summary);
    } catch (error) {
      return buildGroundedDashboardFallback(summary, safeDashboardLLMReason(error));
    }
  }
}

async function summarizeDashboardWithDeepSeek(payload: unknown): Promise<DashboardLLMSummary> {
  const apiKey = String(process.env.DEEPSEEK_API_KEY ?? '').trim();
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY is not configured');
  }

  const model = String(process.env.DEEPSEEK_MODEL ?? 'deepseek-chat').trim();
  const baseURL = String(process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').trim().replace(/\/$/, '');
  const grounding = buildGroundingPacket(payload);
  const citations = buildDashboardCitations(grounding);
  const facts = JSON.stringify({ grounding, citations });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), dashboardLLMTimeoutMs());

  try {
    const response = await fetch(`${baseURL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'You write grounded executive dashboard summaries with citations. Return valid JSON only.'
          },
          {
            role: 'user',
            content: `You summarize a BA manager dashboard using a RAG-style grounding packet. Use ONLY the provided JSON facts and citation values. Do not invent names, causes, trends, or recommendations.
Return ONLY compact JSON matching this schema:
{"summary":"one sentence","bullets":[{"text":"grounded bullet","highlights":["exact word or phrase from text"],"citations":["C1"]}],"grounded":true}
Rules:
- Every bullet must include at least one citation ID from provided citations.
- Every bullet should include 1-3 highlights; each highlight must be an exact substring from that bullet text.
- Highlight important BA names, project names, risk labels, or exact numbers.
- Cite the most specific evidence available, such as overbooked BA, bench BA, or project effort citations.
- Use exact numbers and names from facts.
- If a conclusion is not directly supported by a citation, omit it.
- Keep to 3-5 bullets.
- Do not copy the citations array back; the server will attach verified citations.

Facts:
${facts}`
          }
        ],
        temperature: 0
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`DeepSeek status ${response.status}: ${(await response.text()).slice(0, 160)}`);
    }

    const decoded = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = cleanLLMJson(decoded.choices?.[0]?.message?.content ?? '');
    const parsed = JSON.parse(content) as DashboardLLMSummary;
    const allowed = new Set(citations.map((citation) => citation.id));

    if (!Array.isArray(parsed.bullets) || parsed.bullets.length === 0) {
      throw new Error('DeepSeek summary has no bullets');
    }

    const bullets = parsed.bullets.slice(0, 5).map((bullet) => {
      const text = String(bullet.text ?? '').trim();
      return {
        text,
        highlights: sanitizeHighlights(bullet.highlights, text),
        citations: sanitizeCitationIDs(bullet.citations, allowed)
      };
    });

    if (bullets.some((bullet) => !bullet.text || bullet.citations.length === 0)) {
      throw new Error('DeepSeek summary returned uncited bullets');
    }

    return {
      summary: String(parsed.summary ?? '').trim() || 'Grounded dashboard summary generated from cited dashboard facts.',
      bullets,
      citations,
      provider: 'deepseek',
      grounded: true
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildGroundingPacket(payload: unknown): GroundingPacket {
  const dashboard = asRecord(payload);
  const baRows = arrayOfRecords(dashboard.ba_utilization);
  const projectRows = arrayOfRecords(dashboard.project_effort);

  const overbooked = baRows
    .filter((row) => valueString(row.capacity_label) === 'OVERBOOKED' || numberValue(row.risk_capacity) > 100)
    .sort((left, right) => numberValue(right.risk_capacity) - numberValue(left.risk_capacity))
    .slice(0, 5)
    .map(projectBAEvidenceRow);

  const bench = baRows
    .filter((row) => valueString(row.capacity_label) === 'BENCH' || numberValue(row.utilization_percent) === 0)
    .slice(0, 5)
    .map(projectBAEvidenceRow);

  const highestUtilization = baRows
    .filter((row) => numberValue(row.utilization_percent) > 0)
    .sort((left, right) => numberValue(right.utilization_percent) - numberValue(left.utilization_percent))
    .slice(0, 5)
    .map(projectBAEvidenceRow);

  const topProjectEffort = projectRows
    .sort((left, right) => numberValue(right.man_days) - numberValue(left.man_days))
    .slice(0, 5)
    .map((row) => ({
      project_name: row.project_name,
      man_days: row.man_days,
      ba_count: row.ba_count,
      booking_count: row.booking_count
    }));

  return {
    timeframe: asRecord(dashboard.timeframe),
    team: asRecord(dashboard.team),
    actions: asRecord(dashboard.actions),
    capacity_distribution: dashboard.capacity_distribution,
    overbooked_ba: overbooked,
    bench_ba: bench,
    highest_utilization_ba: highestUtilization,
    top_project_effort: topProjectEffort
  };
}

function buildDashboardCitations(grounding: GroundingPacket): DashboardCitation[] {
  const citations: DashboardCitation[] = [
    { id: 'C1', label: 'Timeframe', value: `${valueString(grounding.timeframe.from)} to ${valueString(grounding.timeframe.to)}` },
    { id: 'C2', label: 'Team utilization', value: `${valueString(grounding.team.team_utilization_percent)}% across ${valueString(grounding.team.total_ba)} active BA` },
    { id: 'C3', label: 'Booked man-days', value: `${valueString(grounding.team.total_man_days)} booked of ${valueString(grounding.team.total_available_man_days)} available man-days` },
    { id: 'C4', label: 'Pending requests', value: `${valueString(grounding.actions.pending_requests)} pending, ${valueString(grounding.actions.unassigned_requests)} unassigned, ${valueString(grounding.actions.urgent_requests)} urgent` },
    { id: 'C5', label: 'Capacity risk', value: `${valueString(grounding.actions.overbooked_ba)} overbooked BA, ${valueString(grounding.actions.bench_ba)} bench BA` }
  ];

  if (grounding.overbooked_ba.length > 0) {
    citations.push({ id: 'C6', label: 'Overbooked BA detail', value: grounding.overbooked_ba.map(formatBAEvidence).join('; ') });
  }
  if (grounding.bench_ba.length > 0) {
    citations.push({ id: 'C7', label: 'Bench BA detail', value: grounding.bench_ba.map(formatBAEvidence).join('; ') });
  }
  if (grounding.highest_utilization_ba.length > 0) {
    citations.push({ id: 'C8', label: 'Highest utilization BA', value: grounding.highest_utilization_ba.map(formatBAEvidence).join('; ') });
  }
  if (grounding.top_project_effort.length > 0) {
    citations.push({ id: 'C9', label: 'Top project effort', value: grounding.top_project_effort.map(formatProjectEvidence).join('; ') });
  }

  return citations;
}

function buildGroundedDashboardFallback(payload: unknown, reason: string): DashboardLLMSummary {
  const grounding = buildGroundingPacket(payload);
  const citations = buildDashboardCitations(grounding);
  const detailBullets = buildDetailFallbackBullets(grounding);

  return {
    summary: `Dashboard summary for the selected timeframe: utilization is ${valueString(grounding.team.team_utilization_percent)}% with ${valueString(grounding.actions.pending_requests)} pending requests.`,
    provider: 'fallback',
    grounded: true,
    reason,
    citations,
    bullets: [
      { text: `Team utilization is ${valueString(grounding.team.team_utilization_percent)}% across ${valueString(grounding.team.total_ba)} active BA.`, highlights: [`${valueString(grounding.team.team_utilization_percent)}%`, `${valueString(grounding.team.total_ba)} active BA`], citations: ['C2'] },
      { text: `There are ${valueString(grounding.actions.pending_requests)} pending requests, including ${valueString(grounding.actions.unassigned_requests)} unassigned and ${valueString(grounding.actions.urgent_requests)} urgent.`, highlights: [`${valueString(grounding.actions.pending_requests)} pending`, `${valueString(grounding.actions.urgent_requests)} urgent`], citations: ['C4'] },
      ...detailBullets
    ].slice(0, 5)
  };
}

function buildDetailFallbackBullets(grounding: GroundingPacket) {
  const bullets: Array<{ text: string; citations: string[]; highlights?: string[] }> = [];
  if (grounding.overbooked_ba.length > 0) {
    bullets.push({ text: `Overbook risk is concentrated in ${grounding.overbooked_ba.map((row) => valueString(row.ba_name)).join(', ')}.`, highlights: grounding.overbooked_ba.map((row) => valueString(row.ba_name)).slice(0, 3), citations: ['C6'] });
  } else {
    bullets.push({ text: `Capacity watchlist shows ${valueString(grounding.actions.overbooked_ba)} overbooked BA and ${valueString(grounding.actions.bench_ba)} bench BA.`, highlights: [`${valueString(grounding.actions.overbooked_ba)} overbooked BA`, `${valueString(grounding.actions.bench_ba)} bench BA`], citations: ['C5'] });
  }
  if (grounding.bench_ba.length > 0) {
    bullets.push({ text: `Bench capacity is visible for ${grounding.bench_ba.map((row) => valueString(row.ba_name)).join(', ')}.`, highlights: grounding.bench_ba.map((row) => valueString(row.ba_name)).slice(0, 3), citations: ['C7'] });
  }
  if (grounding.top_project_effort.length > 0) {
    const topProject = formatProjectEvidence(grounding.top_project_effort[0]);
    bullets.push({ text: `Largest project effort is ${topProject}.`, highlights: [valueString(grounding.top_project_effort[0].project_name), `${valueString(grounding.top_project_effort[0].man_days)} man-days`], citations: ['C9'] });
  }
  return bullets;
}

function projectBAEvidenceRow(row: Record<string, unknown>) {
  return {
    ba_name: row.ba_name,
    level: row.level,
    utilization_percent: row.utilization_percent,
    risk_capacity: row.risk_capacity,
    capacity_label: row.capacity_label,
    current_projects: row.current_projects
  };
}

function formatBAEvidence(row: Record<string, unknown>) {
  return `${valueString(row.ba_name)} (${valueString(row.capacity_label)}, utilization ${valueString(row.utilization_percent)}%, risk ${valueString(row.risk_capacity)}%)`;
}

function formatProjectEvidence(row: Record<string, unknown>) {
  return `${valueString(row.project_name)}: ${valueString(row.man_days)} man-days, ${valueString(row.ba_count)} BA, ${valueString(row.booking_count)} bookings`;
}

function cleanLLMJson(content: string) {
  return content.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
}

function sanitizeCitationIDs(ids: unknown, allowed: Set<string>) {
  if (!Array.isArray(ids)) return [];
  return Array.from(new Set(ids.map((id) => String(id).trim()).filter((id) => allowed.has(id))));
}

function sanitizeHighlights(highlights: unknown, text: string) {
  if (!Array.isArray(highlights)) return [];
  return Array.from(
    new Set(
      highlights
        .map((highlight) => String(highlight).trim())
        .filter((highlight) => highlight.length > 0 && text.includes(highlight))
    )
  ).slice(0, 3);
}

function safeDashboardLLMReason(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? 'LLM summary was unavailable');
  const lower = message.toLowerCase();
  if (lower.includes('api_key')) return 'DEEPSEEK_API_KEY is not configured';
  if (lower.includes('deadline exceeded') || lower.includes('timeout') || lower.includes('aborted')) {
    return 'DeepSeek request timed out; check network access to api.deepseek.com or increase DASHBOARD_LLM_TIMEOUT_SECONDS';
  }
  return message;
}

function dashboardLLMTimeoutMs() {
  const seconds = Number(process.env.DASHBOARD_LLM_TIMEOUT_SECONDS ?? 45);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 45000;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function valueString(value: unknown) {
  return value === null || value === undefined || value === '' ? 'not provided' : String(value);
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
