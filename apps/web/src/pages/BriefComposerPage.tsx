// BriefComposerPage — the AI-First "post a booking" experience.
//
// Flow:
//   1. PM pastes a free-text description of the work.
//   2. POST /api/ai/brief/parse returns a structured brief
//      (title, skills, level, duration, capacity, domain).
//   3. The page calls /api/ai/brief/match to score every active BA.
//   4. The user picks one and the existing BookingModal opens with
//      the brief pre-filled. From there the standard request flow
//      takes over.
//
// This is the first feature where a real AI extract lives inline
// in the product — not behind an admin tool, not behind a settings
// page. That's the AI-First shift.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Briefcase, Check, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { BookingModal } from '@/components/BookingModal';
import { postBriefParse, postBriefMatch, type BriefParseResponse, type BriefCandidate } from '@/lib/ai';

export function BriefComposerPage() {
  const [text, setText] = useState('');
  const [brief, setBrief] = useState<BriefParseResponse | null>(null);
  const [candidates, setCandidates] = useState<BriefCandidate[]>([]);
  const [parsing, setParsing] = useState(false);
  const [matching, setMatching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedBA, setSelectedBA] = useState<BriefCandidate | null>(null);

  async function runParse() {
    if (!text.trim() || parsing) return;
    setError(null);
    setBrief(null);
    setCandidates([]);
    setParsing(true);
    try {
      const parsed = await postBriefParse(text);
      setBrief(parsed);
      // Auto-run match so the user sees results without a second click.
      setMatching(true);
      try {
        const matched = await postBriefMatch(parsed, 5);
        setCandidates(matched.candidates);
      } catch (e) {
        // Match failure shouldn't lose the parse; just show no candidates.
        console.warn('brief match failed', e);
      } finally {
        setMatching(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Parse failed');
    } finally {
      setParsing(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Brief Composer"
        description="Describe the work in plain English. The AI extracts a structured brief and matches BAs."
        actions={
          <Link to="/dashboard" className="text-sm text-slate-600 hover:text-slate-900">
            ← Back to dashboard
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: input + extracted brief */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-blue-600" />
                Describe what you need
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="e.g. We need a senior BA for a 6-week KYC migration in Q3. Someone with payments or fintech experience would be ideal. 50% capacity is fine."
                rows={6}
                className="w-full resize-y rounded-md border border-slate-200 bg-white p-3 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <div className="flex items-center justify-between">
                <div className="text-xs text-slate-500">
                  The AI extracts title, required skills, level, duration, and capacity.
                </div>
                <Button onClick={runParse} disabled={!text.trim() || parsing}>
                  {parsing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Parsing…
                    </>
                  ) : (
                    <>
                      Parse brief
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
              {error && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {error}
                </div>
              )}
            </CardContent>
          </Card>

          {brief && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Extracted brief</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <div className="text-xs font-semibold uppercase text-slate-500">Title</div>
                  <div className="font-medium text-slate-900">{brief.title}</div>
                </div>
                <dl className="grid grid-cols-2 gap-3">
                  <div>
                    <dt className="text-xs font-semibold uppercase text-slate-500">Level</dt>
                    <dd>{brief.level}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase text-slate-500">Duration</dt>
                    <dd>{brief.duration_weeks} weeks</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase text-slate-500">Capacity</dt>
                    <dd>{brief.capacity_percent}%</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase text-slate-500">Domain</dt>
                    <dd>{brief.domain}</dd>
                  </div>
                </dl>
                <div>
                  <div className="text-xs font-semibold uppercase text-slate-500">Required skills</div>
                  {brief.required_skills.length === 0 ? (
                    <div className="text-xs text-slate-400">None specified</div>
                  ) : (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {brief.required_skills.map((s) => (
                        <span
                          key={s}
                          className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {brief.reasoning && (
                  <div className="rounded-md bg-slate-50 p-2 text-xs text-slate-600">
                    <span className="font-semibold">AI reasoning:</span> {brief.reasoning}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: matched candidates */}
        <div className="space-y-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <Briefcase className="h-4 w-4" />
            Best matches
            {matching && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
          </h2>
          {!brief && !matching && (
            <Card>
              <CardContent className="p-6 text-center text-sm text-slate-500">
                Run a parse to see BA matches.
              </CardContent>
            </Card>
          )}
          {brief && candidates.length === 0 && !matching && (
            <Card>
              <CardContent className="p-6 text-center text-sm text-slate-500">
                No candidates found. Try broadening the brief.
              </CardContent>
            </Card>
          )}
          {candidates.map((c) => (
            <Card
              key={c.id}
              className={selectedBA?.id === c.id ? 'border-blue-400 ring-1 ring-blue-400' : ''}
            >
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{c.full_name}</div>
                    <div className="text-xs text-slate-500">
                      {c.level} · {c.status}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-500">Match</div>
                    <div className="text-sm font-semibold text-blue-600">
                      {c.match_score.toFixed(1)}
                    </div>
                  </div>
                </div>
                {c.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {c.tags.slice(0, 6).map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                <div className="text-xs text-slate-600">{c.why}</div>
                <Button
                  size="sm"
                  variant={selectedBA?.id === c.id ? 'default' : 'secondary'}
                  onClick={() => setSelectedBA(c)}
                  className="w-full"
                >
                  {selectedBA?.id === c.id ? (
                    <>
                      <Check className="mr-1 h-3 w-3" />
                      Selected — open booking form
                    </>
                  ) : (
                    'Pick this BA'
                  )}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {selectedBA && brief && (
        <BookingModal
          open={!!selectedBA}
          onClose={() => setSelectedBA(null)}
          initialBaId={selectedBA.id}
          initialStartDate={dateOffset(0)}
          initialEndDate={dateOffset(brief.duration_weeks * 7)}
        />
      )}
    </div>
  );
}

// dateOffset returns YYYY-MM-DD for "today + days".
function dateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
