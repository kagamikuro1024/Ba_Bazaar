import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  LayoutDashboard,
  ShieldCheck,
  Sparkles,
  Users
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const stats = [
  { label: 'Yêu cầu chờ duyệt', value: '12', detail: 'Cần BA Manager xem xét' },
  { label: 'Yêu cầu chỉ định BA', value: '6', detail: 'Đã chọn BA cụ thể' },
  { label: 'Yêu cầu mở', value: '6', detail: 'Cần phân công BA' },
  { label: 'Khẩn cấp', value: '1', detail: 'Ưu tiên cao' }
];

const capabilities = [
  {
    title: 'Đặt lịch theo timeline và capacity',
    description:
      'PM/PO xem khối lượng công việc của BA theo ngày, tạo yêu cầu trên khoảng trống còn phù hợp và thấy ngay rủi ro quá tải.',
    icon: CalendarDays
  },
  {
    title: 'Quy trình phê duyệt rõ ràng',
    description:
      'BA Manager xử lý yêu cầu chờ duyệt, yêu cầu mở, yêu cầu chỉ định BA và yêu cầu khẩn cấp trong một hàng đợi tập trung.',
    icon: ClipboardCheck
  },
  {
    title: 'Cảnh báo quá tải sớm',
    description:
      'Hệ thống tính capacity đã duyệt và capacity đang chờ duyệt để cảnh báo trước khi lịch chính thức bị khóa.',
    icon: AlertTriangle
  }
];

const workflow = [
  {
    title: 'PM/PO tạo yêu cầu',
    description: 'Chọn BA cụ thể hoặc gửi yêu cầu mở, kèm dự án, khoảng ngày và mức capacity mong muốn.',
    tone: 'bg-blue-50 text-blue-700 ring-blue-200',
    icon: Users
  },
  {
    title: 'Yêu cầu chờ duyệt',
    description: 'Yêu cầu chờ duyệt không khóa lịch chính thức nhưng vẫn hiển thị trên timeline và cảnh báo capacity.',
    tone: 'bg-amber-50 text-amber-700 ring-amber-200',
    icon: Clock3
  },
  {
    title: 'BA Manager quyết định',
    description: 'So sánh khối lượng công việc, BA được gợi ý, rủi ro capacity và thông tin yêu cầu trước khi phê duyệt.',
    tone: 'bg-violet-50 text-violet-700 ring-violet-200',
    icon: ShieldCheck
  },
  {
    title: 'Lịch được đồng bộ',
    description: 'Yêu cầu được duyệt sẽ hiện trên timeline; yêu cầu bị từ chối có lý do và thông báo đến đúng vai trò.',
    tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    icon: CheckCircle2
  }
];

const roleBenefits = [
  {
    role: 'PM/PO',
    title: 'Đặt BA đúng thời điểm',
    body: 'Gửi yêu cầu theo dự án, timeline và mức capacity cần thiết mà không phải hỏi lịch thủ công.'
  },
  {
    role: 'BA Manager',
    title: 'Kiểm soát khối lượng công việc',
    body: 'Ưu tiên yêu cầu, xử lý rủi ro quá tải và phân bổ nguồn lực dựa trên dữ liệu capacity hiện tại.'
  },
  {
    role: 'BA',
    title: 'Nắm rõ lịch cá nhân',
    body: 'Theo dõi công việc được phân công, thay đổi lịch và thông báo liên quan trong một không gian làm việc.'
  }
];

const timelineRows = [
  {
    name: 'Nguyễn Ngọc Linh',
    role: 'Senior BA',
    capacity: '72%',
    tone: 'text-amber-600',
    bars: [
      { label: 'Payment Flow', width: '44%', left: '4%', color: 'bg-blue-600' },
      { label: 'CRM Revamp', width: '28%', left: '52%', color: 'border border-dashed border-amber-400 bg-amber-100 text-amber-800' }
    ]
  },
  {
    name: 'Hoàng Thanh Tâm',
    role: 'Middle BA',
    capacity: '40%',
    tone: 'text-emerald-600',
    bars: [
      { label: 'Mobile App', width: '34%', left: '18%', color: 'bg-emerald-600' }
    ]
  },
  {
    name: 'Lê Đăng Khoa',
    role: 'Middle BA',
    capacity: '0%',
    tone: 'text-emerald-600',
    bars: [
      { label: 'Available', width: '36%', left: '58%', color: 'border border-dashed border-slate-300 bg-slate-50 text-slate-500' }
    ]
  }
];

function ProductPreview() {
  return (
    <div
      className="relative min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-3 shadow-2xl shadow-slate-900/10"
      aria-label="Bản xem trước giao diện dashboard và timeline BA Bazaar"
    >
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase text-blue-700">Manager Dashboard</p>
            <p className="truncate text-sm font-semibold text-slate-950">
              Yêu cầu cần xử lý hôm nay
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
              3 Pending
            </span>
            <span className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">
              1 Risk
            </span>
          </div>
        </div>

        <div className="grid gap-4 p-4 xl:grid-cols-[0.88fr_1.12fr]">
          <div className="grid gap-3">
            {[
              {
                title: 'Payment Refund Flow',
                meta: 'Requested BA: Bùi Phương Thảo',
                badge: 'Pending',
                tone: 'border-blue-300 bg-blue-50'
              },
              {
                title: 'CRM Revamp',
                meta: 'BA not assigned yet',
                badge: 'Open request',
                tone: 'border-slate-200 bg-white'
              },
              {
                title: 'Mobile Onboarding',
                meta: 'Needs manager verification',
                badge: 'Urgent',
                tone: 'border-rose-200 bg-rose-50'
              }
            ].map((item) => (
              <div key={item.title} className={`rounded-lg border p-3 ${item.tone}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-950">{item.title}</p>
                    <p className="mt-1 text-xs text-slate-600">{item.meta}</p>
                  </div>
                  <span className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
                    {item.badge}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-3 py-3">
              <div>
                <p className="text-xs font-bold uppercase text-slate-500">Resource timeline</p>
                <p className="text-sm font-semibold text-slate-950">Tuần 01/06 - 07/06</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-5 rounded bg-blue-600" />
                  Approved
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-5 rounded border border-dashed border-amber-400 bg-amber-100" />
                  Pending
                </span>
              </div>
            </div>

            <div className="grid grid-cols-[148px_repeat(7,minmax(34px,1fr))] text-xs">
              <div className="border-b border-r border-slate-200 bg-slate-50 px-3 py-2 font-semibold text-slate-500">
                BA
              </div>
              {['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((day) => (
                <div
                  key={day}
                  className="border-b border-r border-slate-200 bg-slate-50 px-1 py-2 text-center font-semibold text-slate-500"
                >
                  {day}
                </div>
              ))}

              {timelineRows.map((row) => (
                <div key={row.name} className="contents">
                  <div className="flex min-h-16 items-center justify-between gap-2 border-b border-r border-slate-200 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-slate-950">{row.name}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">{row.role}</p>
                    </div>
                    <span className={`shrink-0 text-xs font-bold ${row.tone}`}>
                      {row.capacity}
                    </span>
                  </div>
                  <div className="relative col-span-7 min-h-16 border-b border-r border-slate-200 bg-[repeating-linear-gradient(-45deg,#f8fafc,#f8fafc_6px,#eef2f7_6px,#eef2f7_12px)]">
                    {row.bars.map((bar) => (
                      <div
                        key={bar.label}
                        className={`absolute top-4 h-7 truncate rounded-md px-2 py-1 text-xs font-semibold text-white shadow-sm ${bar.color}`}
                        style={{ left: bar.left, width: bar.width }}
                      >
                        {bar.label}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid gap-3 border-t border-slate-200 bg-slate-50 p-4 sm:grid-cols-3">
          <div>
            <p className="text-xs font-medium text-slate-500">Average capacity</p>
            <p className="mt-1 text-2xl font-bold text-blue-700">72%</p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">BA available</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">5</p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Overbook risk</p>
            <p className="mt-1 text-2xl font-bold text-rose-600">1</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="fixed inset-x-0 top-0 z-40 border-b border-white/70 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <Link to="/" className="min-w-0" aria-label="Trang chủ BA Bazaar">
            <p className="text-xs font-bold uppercase text-blue-700">BA Bazaar</p>
            <p className="text-base font-bold text-slate-950">Booking + CRM</p>
          </Link>
          <nav className="hidden items-center gap-7 text-sm font-semibold text-slate-600 md:flex">
            <a href="#platform" className="transition hover:text-blue-700">
              Nền tảng
            </a>
            <a href="#workflow" className="transition hover:text-blue-700">
              Quy trình
            </a>
            <a href="#roles" className="transition hover:text-blue-700">
              Vai trò
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Button variant="secondary" asChild>
              <Link to="/login">Đăng nhập</Link>
            </Button>
            <Button className="hidden sm:inline-flex" asChild>
              <Link to="/register">
                Đăng ký <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden border-b border-slate-200 bg-white pt-24">
          <div className="relative mx-auto grid max-w-7xl gap-10 px-4 pb-12 pt-12 sm:px-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(420px,1.05fr)] lg:items-center lg:px-8 lg:pb-14 lg:pt-16">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700">
                <Sparkles className="h-4 w-4" />
                Nền tảng đặt lịch nguồn lực cho đội BA
              </div>
              <h1 className="mt-6 max-w-2xl text-4xl font-bold leading-tight text-slate-950">
                BA Bazaar Booking + CRM
              </h1>
              <p className="mt-5 max-w-xl text-base leading-7 text-slate-600">
                Điều phối BA theo timeline, capacity và quy trình phê duyệt trong một hệ
                thống rõ ràng cho PM/PO, BA Manager và BA.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button className="h-11 px-5" asChild>
                  <Link to="/login">
                    Mở hệ thống <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button variant="secondary" className="h-11 px-5" asChild>
                  <a href="#platform">Xem nền tảng</a>
                </Button>
              </div>
            </div>

            <ProductPreview />

            <div className="hidden max-w-3xl gap-3 sm:grid sm:grid-cols-2 lg:col-span-2 lg:grid-cols-4">
              {stats.map((item) => (
                <div
                  key={item.label}
                  className="rounded-lg border border-slate-200 bg-white/90 p-4 shadow-sm backdrop-blur"
                >
                  <p className="text-sm font-medium text-slate-500">{item.label}</p>
                  <p className="mt-2 text-3xl font-bold text-slate-950">{item.value}</p>
                  <p className="mt-1 text-sm text-slate-500">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="platform" className="border-b border-slate-200 bg-slate-50 py-14 sm:py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
              <div>
                <p className="text-sm font-bold uppercase text-blue-700">
                  Trải nghiệm ưu tiên capacity
                </p>
                <h2 className="mt-3 max-w-xl text-3xl font-bold text-slate-950">
                  Nhìn vào là biết BA nào còn rảnh, BA nào gần kín lịch, yêu cầu nào cần quyết định.
                </h2>
                <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600">
                  Giao diện giữ đúng tinh thần của ứng dụng hiện tại: nền sáng,
                  khối nội dung rõ ràng, biểu tượng nét mảnh, nút hành động màu xanh và các trạng thái
                  Approved, Pending, Available được tách bạch bằng màu sắc lẫn nhãn chữ.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {capabilities.map((item) => {
                  const Icon = item.icon;

                  return (
                    <Card key={item.title} className="h-full transition hover:-translate-y-0.5 hover:shadow-md">
                      <CardContent className="p-5">
                        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-50 text-blue-700">
                          <Icon className="h-5 w-5" />
                        </div>
                        <h3 className="mt-4 text-base font-bold text-slate-950">{item.title}</h3>
                        <p className="mt-2 text-sm leading-6 text-slate-600">
                          {item.description}
                        </p>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section id="workflow" className="bg-white py-14 sm:py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
              <div>
                <p className="text-sm font-bold uppercase text-blue-700">
                  Quy trình phê duyệt
                </p>
                <h2 className="mt-3 text-3xl font-bold text-slate-950">
                  Từ yêu cầu đặt lịch đến lịch được duyệt trong một luồng xử lý rõ ràng.
                </h2>
              </div>
              <Button variant="secondary" asChild>
                <Link to="/login">
                  Đăng nhập để xử lý yêu cầu <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {workflow.map((item, index) => {
                const Icon = item.icon;

                return (
                  <div key={item.title} className="relative">
                    <Card className="h-full">
                      <CardContent className="p-5">
                        <div className="flex items-center justify-between gap-3">
                          <div
                            className={`flex h-10 w-10 items-center justify-center rounded-md ring-1 ring-inset ${item.tone}`}
                          >
                            <Icon className="h-5 w-5" />
                          </div>
                          <span className="text-sm font-bold text-slate-400">
                            0{index + 1}
                          </span>
                        </div>
                        <h3 className="mt-4 text-base font-bold text-slate-950">
                          {item.title}
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-slate-600">
                          {item.description}
                        </p>
                      </CardContent>
                    </Card>
                    {index < workflow.length - 1 ? (
                      <ArrowRight className="absolute -right-3 top-1/2 z-10 hidden h-5 w-5 -translate-y-1/2 text-slate-300 xl:block" />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section id="roles" className="border-y border-slate-200 bg-slate-50 py-14 sm:py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
              <div>
                <p className="text-sm font-bold uppercase text-blue-700">
                  Thiết kế cho đội vận hành
                </p>
                <h2 className="mt-3 text-3xl font-bold text-slate-950">
                  Mỗi vai trò thấy đúng việc cần xử lý.
                </h2>
                <p className="mt-4 text-sm leading-6 text-slate-600">
                  Dashboard, timeline, hộp xử lý của BA Manager, danh bạ BA và báo cáo được tổ chức
                  theo luồng công việc thực tế của đội ngũ BA.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                {roleBenefits.map((item) => (
                  <Card key={item.role} className="h-full">
                    <CardContent className="p-5">
                      <p className="text-sm font-bold uppercase text-blue-700">
                        {item.role}
                      </p>
                      <h3 className="mt-3 text-base font-bold text-slate-950">{item.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{item.body}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="bg-white py-14 sm:py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-6 rounded-lg border border-blue-200 bg-blue-50 p-6 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <div className="flex items-center gap-2 text-sm font-bold uppercase text-blue-700">
                  <LayoutDashboard className="h-4 w-4" />
                  Sẵn sàng triển khai
                </div>
                <h2 className="mt-3 text-2xl font-bold text-slate-950">
                  Đưa quy trình đặt lịch BA vào một không gian làm việc có thể vận hành ngay.
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                  Kết nối dashboard, timeline, hộp xử lý của BA Manager và báo cáo capacity để
                  giảm trao đổi thủ công và tăng tính minh bạch khi phân bổ BA.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row md:justify-end">
                <Button asChild>
                  <Link to="/login">
                    Mở hệ thống <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button variant="secondary" asChild>
                  <Link to="/register">Đăng ký PM/PO</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-6 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p className="font-semibold text-slate-700">BA Bazaar Booking + CRM</p>
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-1">
              <BarChart3 className="h-4 w-4 text-blue-600" />
              Tổng hợp capacity
            </span>
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="h-4 w-4 text-blue-600" />
              BA Manager phê duyệt
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
