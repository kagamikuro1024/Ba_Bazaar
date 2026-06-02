import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { apiFetch, downloadCsv } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

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
  const report = useQuery({
    queryKey: ['reports', month],
    queryFn: () => apiFetch<Report>(`/api/reports/utilization?month=${month}`)
  });

  return (
    <div className="grid gap-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-950">Reports</h2>
          <p className="text-sm text-slate-600">Utilization report and CSV export.</p>
        </div>
        <div className="flex gap-2">
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="h-10 rounded-md border px-3 text-sm" />
          <Button onClick={() => void downloadCsv(`/api/reports/utilization.csv?month=${month}`)}>
            <Download className="h-4 w-4" /> CSV
          </Button>
        </div>
      </div>
      {report.isLoading ? (
        <Card><CardContent className="p-5 text-sm text-slate-600">Loading report...</CardContent></Card>
      ) : null}
      {report.error ? (
        <Card><CardContent className="p-5 text-sm text-rose-700">Could not load report. Check API connection and retry.</CardContent></Card>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-slate-500">Active BA</p>
            <p className="mt-2 text-4xl font-bold text-slate-950">{report.data?.active_ba_count ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-slate-500">Approved bookings</p>
            <p className="mt-2 text-4xl font-bold text-slate-950">{report.data?.total_booking_count ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-slate-500">Average utilization</p>
            <p className="mt-2 text-4xl font-bold text-blue-700">{report.data?.average_utilization_percent ?? 0}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-slate-500">Next month bookings</p>
            <p className="mt-2 text-4xl font-bold text-slate-950">{report.data?.next_month_booking_count ?? 0}</p>
          </CardContent>
        </Card>
      </div>
      {report.data && report.data.total_booking_count === 0 ? (
        <Card>
          <CardContent className="p-10 text-center">
            <p className="text-base font-semibold text-slate-950">No bookings in this month</p>
            <p className="mt-2 text-sm text-slate-600">
              There are no approved or completed bookings overlapping the selected month.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[760px] text-sm">
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
                {(report.data?.rows ?? []).map((row) => (
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
            {report.data?.rows.length === 0 ? (
              <div className="p-5 text-sm text-slate-600">No utilization rows for this month.</div>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
