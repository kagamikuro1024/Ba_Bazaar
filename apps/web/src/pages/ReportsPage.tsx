import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Search, X } from 'lucide-react';
import { apiFetch, downloadCsv, type ManagerDashboardSummary } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LoadingScreen } from '@/components/ui/loading-screen';

const pageSizeOptions = [10, 25, 50];

type Report = {
  active_ba_count: number;
  total_booking_count: number;
  next_month_booking_count: number;
  average_utilization_percent: number;
  rows: Array<{
    ba_id: string;
    ba_name: string;
    level: string;
    status: string;
    booked_days: number;
    working_days: number;
    utilization_percent: number;
    project_count: number;
  }>;
};

export function ReportsPage() {
  const [month, setMonth] = useState('2026-06');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const report = useQuery({
    queryKey: ['reports', month],
    queryFn: () => apiFetch<Report>(`/api/reports/utilization?month=${month}`)
  });
  const monthRange = useMemo(() => getMonthDateRange(month), [month]);
  const managerSummary = useQuery({
    queryKey: ['reports-manager-summary', monthRange.from, monthRange.to],
    queryFn: () =>
      apiFetch<ManagerDashboardSummary>(
        `/api/dashboard/manager-summary?from=${monthRange.from}&to=${monthRange.to}`
      )
  });
  const rows = useMemo(() => report.data?.rows ?? [], [report.data?.rows]);
  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;

    return rows.filter((row) =>
      [
        row.ba_name,
        row.level,
        row.status,
        `${row.utilization_percent}%`,
        `${row.booked_days}/${row.working_days}`,
        `${row.project_count} projects`
      ]
        .join(' ')
        .toLowerCase()
        .includes(query)
    );
  }, [rows, search]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const firstRow = filteredRows.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastRow = Math.min(currentPage * pageSize, filteredRows.length);

  function handleSearchChange(value: string) {
    setSearch(value);
    setPage(1);
  }

  function handlePageSizeChange(value: string) {
    setPageSize(Number(value));
    setPage(1);
  }

  return (
    <div className="grid gap-4 sm:gap-5">
      <div className="grid gap-3 md:flex md:items-center md:justify-between">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 md:ml-auto md:flex">
          <input
            type="month"
            value={month}
            onChange={(event) => {
              setMonth(event.target.value);
              setPage(1);
            }}
            className="h-10 min-w-0 rounded-md border px-3 text-sm"
          />
          <Button onClick={() => void downloadCsv(`/api/reports/utilization.csv?month=${month}`)}>
            <Download className="h-4 w-4" /> CSV
          </Button>
        </div>
      </div>
      {report.isLoading || managerSummary.isLoading ? (
        <LoadingScreen message="Loading report" />
      ) : null}
      {report.error || managerSummary.error ? (
        <Card><CardContent className="p-5 text-sm text-rose-700">Could not load report. Check API connection and retry.</CardContent></Card>
      ) : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Card>
          <CardContent className="p-4 sm:p-5">
            <p className="text-xs font-medium uppercase text-slate-500 sm:text-sm sm:normal-case">Active BA</p>
            <p className="mt-2 text-3xl font-bold text-slate-950 sm:text-4xl">{report.data?.active_ba_count ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 sm:p-5">
            <p className="text-xs font-medium uppercase text-slate-500 sm:text-sm sm:normal-case">Man-days</p>
            <p className="mt-2 text-3xl font-bold text-slate-950 sm:text-4xl">{managerSummary.data?.team.total_man_days ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 sm:p-5">
            <p className="text-xs font-medium uppercase text-slate-500 sm:text-sm sm:normal-case">Avg. utilization</p>
            <p className="mt-2 text-3xl font-bold text-blue-700 sm:text-4xl">{report.data?.average_utilization_percent ?? 0}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 sm:p-5">
            <p className="text-xs font-medium uppercase text-slate-500 sm:text-sm sm:normal-case">Bench rate</p>
            <p className="mt-2 text-3xl font-bold text-slate-950 sm:text-4xl">{managerSummary.data?.team.bench_rate_percent ?? 0}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 sm:p-5">
            <p className="text-xs font-medium uppercase text-slate-500 sm:text-sm sm:normal-case">Bench BA</p>
            <p className="mt-2 text-3xl font-bold text-slate-950 sm:text-4xl">{managerSummary.data?.team.bench_count ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 sm:p-5">
            <p className="text-xs font-medium uppercase text-slate-500 sm:text-sm sm:normal-case">Overbooked</p>
            <p className="mt-2 text-3xl font-bold text-rose-700 sm:text-4xl">{managerSummary.data?.team.overbooked_count ?? 0}</p>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardContent className="grid gap-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-base font-semibold text-slate-950">Project effort distribution</p>
              <p className="mt-1 text-sm text-slate-500">Approved/in-progress/completed effort by man-day.</p>
            </div>
            <span className="text-sm font-semibold text-slate-600">
              {managerSummary.data?.project_effort.length ?? 0} projects
            </span>
          </div>
          <div className="grid gap-3">
            {(managerSummary.data?.project_effort ?? []).slice(0, 8).map((project) => (
              <div key={project.project_id} className="grid gap-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: project.color }}
                    />
                    <span className="truncate font-medium text-slate-800">{project.project_name}</span>
                  </div>
                  <span className="shrink-0 text-slate-600">
                    {project.man_days} md · {project.allocation_percent}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-blue-600"
                    style={{ width: `${Math.min(100, project.allocation_percent)}%` }}
                  />
                </div>
              </div>
            ))}
            {managerSummary.data?.project_effort.length === 0 ? (
              <p className="text-sm text-slate-500">No project effort in this month.</p>
            ) : null}
          </div>
        </CardContent>
      </Card>
      {report.data && report.data.total_booking_count === 0 ? (
        <Card>
          <CardContent className="p-6 text-center sm:p-10">
            <p className="text-base font-semibold text-slate-950">No bookings in this month</p>
            <p className="mt-2 text-sm text-slate-600">
              There are no approved or completed bookings overlapping the selected month.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="grid gap-3 border-b border-slate-200 p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:p-4">
              <div className="grid gap-1">
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <span className="sr-only">Search BA reports</span>
                  <input
                    value={search}
                    onChange={(event) => handleSearchChange(event.target.value)}
                    placeholder="Search BA, status, utilization..."
                    className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-10 text-sm"
                    autoComplete="off"
                  />
                  {search ? (
                    <button
                      type="button"
                      onClick={() => handleSearchChange('')}
                      className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                      aria-label="Clear report search"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : null}
                </label>
                <p className="text-xs text-slate-500">
                  {search.trim()
                    ? `${filteredRows.length} result${filteredRows.length === 1 ? '' : 's'} for "${search.trim()}"`
                    : `${rows.length} BA in this report`}
                </p>
              </div>
              <select
                value={pageSize}
                onChange={(event) => handlePageSizeChange(event.target.value)}
                className="h-10 self-start rounded-md border border-slate-200 bg-white px-3 text-sm"
                aria-label="Rows per page"
              >
                {pageSizeOptions.map((size) => (
                  <option key={size} value={size}>{size} / page</option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 p-3 md:hidden">
              {paginatedRows.map((row) => (
                <div key={row.ba_id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-950">{row.ba_name}</p>
                      <p className="text-xs text-slate-500">{row.level} · {row.status}</p>
                    </div>
                    <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700">
                      {row.utilization_percent}%
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-lg bg-slate-50 p-2">
                      <p className="text-xs text-slate-500">Booked days</p>
                      <p className="font-semibold text-slate-950">{row.booked_days}/{row.working_days}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-2">
                      <p className="text-xs text-slate-500">Projects</p>
                      <p className="font-semibold text-slate-950">{row.project_count}</p>
                    </div>
                  </div>
                </div>
              ))}
              {filteredRows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  No BA found for "{search.trim()}". Try a name, level, status, utilization, or project count.
                </div>
              ) : null}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="p-3">BA</th>
                    <th className="p-3">Level</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Booked days</th>
                    <th className="p-3">Projects</th>
                    <th className="p-3">Utilization</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedRows.map((row) => (
                    <tr key={row.ba_id} className="border-t">
                      <td className="p-3 font-semibold">{row.ba_name}</td>
                      <td className="p-3">{row.level}</td>
                      <td className="p-3">{row.status}</td>
                      <td className="p-3">{row.booked_days}/{row.working_days}</td>
                      <td className="p-3">{row.project_count}</td>
                      <td className="p-3 font-semibold">{row.utilization_percent}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredRows.length === 0 ? (
                <div className="p-5 text-sm text-slate-600">
                  No BA found for "{search.trim()}". Try a name, level, status, utilization, or project count.
                </div>
              ) : null}
            </div>
            <div className="flex flex-col gap-3 border-t border-slate-200 p-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between sm:p-4">
              <span>
                Showing {firstRow}-{lastRow} of {filteredRows.length} BA
              </span>
              <div className="grid grid-cols-2 gap-2 sm:flex">
                <Button
                  variant="secondary"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function getMonthDateRange(month: string) {
  const [year, monthIndex] = month.split('-').map(Number);
  const from = `${month}-01`;
  const endDate = new Date(Date.UTC(year, monthIndex, 0));
  const to = endDate.toISOString().slice(0, 10);

  return { from, to };
}
