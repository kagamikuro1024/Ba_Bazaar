import { Card, CardContent } from './card';

type LoadingScreenProps = {
  message?: string;
};

function RunningPixelCat() {
  return (
    <div className="relative h-16 w-full max-w-xs overflow-hidden">
      <svg
        viewBox="0 0 200 32"
        className="h-full w-full"
        style={{ shapeRendering: 'crispEdges' }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* 
            Sprite sheet: 4 frames of a galloping cat.
            Each frame is 32x16 pixels:
              Frame 0: legs spread (full sprint)
              Frame 1: legs tucked 1
              Frame 2: legs crossed (opposite sprint)
              Frame 3: legs tucked 2
          */}
          <g id="cat-sprite">
            {/* ---- FRAME 0: full sprint stretch ---- */}
            <g id="f0">
              {/* shadow */}
              <ellipse cx="16" cy="30" rx="14" ry="2" fill="rgba(0,0,0,0.08)" />
              {/* tail extended horizontally */}
              <rect x="0" y="16" width="6" height="2" fill="#f59e0b" />
              <rect x="0" y="14" width="2" height="2" fill="#d97706" />
              {/* hind legs stretched back */}
              <rect x="2" y="22" width="2" height="6" fill="#b45309" rx="1" />
              <rect x="6" y="24" width="2" height="4" fill="#d97706" rx="1" />
              {/* body elongated */}
              <rect x="4" y="16" width="18" height="6" fill="#f59e0b" />
              <rect x="6" y="14" width="14" height="2" fill="#f59e0b" />
              {/* stripes */}
              <rect x="8" y="16" width="2" height="3" fill="#d97706" />
              <rect x="12" y="16" width="2" height="3" fill="#d97706" />
              <rect x="16" y="16" width="2" height="3" fill="#d97706" />
              {/* front legs stretched forward */}
              <rect x="20" y="22" width="2" height="6" fill="#d97706" rx="1" />
              <rect x="24" y="24" width="2" height="4" fill="#b45309" rx="1" />
              {/* head forward */}
              <rect x="22" y="10" width="8" height="8" fill="#f59e0b" />
              <rect x="22" y="8" width="2" height="2" fill="#d97706" />
              <rect x="28" y="8" width="2" height="2" fill="#d97706" />
              <rect x="26" y="12" width="2" height="2" fill="#1e293b" />
            </g>

            {/* ---- FRAME 1: legs tucked ---- */}
            <g id="f1" style={{ display: 'none' }}>
              <ellipse cx="16" cy="30" rx="14" ry="2" fill="rgba(0,0,0,0.08)" />
              {/* tail at angle */}
              <rect x="1" y="14" width="2" height="4" fill="#f59e0b" />
              <rect x="3" y="16" width="2" height="2" fill="#d97706" />
              {/* hind legs mid-step */}
              <rect x="4" y="22" width="2" height="4" fill="#b45309" rx="1" />
              <rect x="6" y="22" width="2" height="4" fill="#d97706" rx="1" />
              {/* body */}
              <rect x="4" y="16" width="16" height="6" fill="#f59e0b" />
              <rect x="6" y="14" width="12" height="2" fill="#f59e0b" />
              <rect x="8" y="16" width="2" height="3" fill="#d97706" />
              <rect x="12" y="16" width="2" height="3" fill="#d97706" />
              {/* front legs */}
              <rect x="18" y="22" width="2" height="4" fill="#d97706" rx="1" />
              <rect x="20" y="22" width="2" height="4" fill="#b45309" rx="1" />
              {/* head */}
              <rect x="20" y="10" width="8" height="8" fill="#f59e0b" />
              <rect x="20" y="8" width="2" height="2" fill="#d97706" />
              <rect x="26" y="8" width="2" height="2" fill="#d97706" />
              <rect x="24" y="12" width="2" height="2" fill="#1e293b" />
              <rect x="28" y="14" width="2" height="2" fill="#fcd34d" />
              <rect x="30" y="14" width="1" height="1" fill="#ef4444" />
            </g>

            {/* ---- FRAME 2: opposite sprint stretch ---- */}
            <g id="f2" style={{ display: 'none' }}>
              <ellipse cx="16" cy="30" rx="14" ry="2" fill="rgba(0,0,0,0.08)" />
              {/* tail raised */}
              <rect x="0" y="10" width="2" height="8" fill="#f59e0b" />
              <rect x="2" y="12" width="2" height="2" fill="#d97706" />
              {/* hind legs forward */}
              <rect x="4" y="24" width="2" height="4" fill="#d97706" rx="1" />
              <rect x="8" y="25" width="2" height="3" fill="#b45309" rx="1" />
              {/* body normal */}
              <rect x="4" y="16" width="18" height="6" fill="#f59e0b" />
              <rect x="6" y="14" width="14" height="2" fill="#f59e0b" />
              <rect x="8" y="16" width="2" height="3" fill="#d97706" />
              <rect x="12" y="16" width="2" height="3" fill="#d97706" />
              <rect x="16" y="16" width="2" height="3" fill="#d97706" />
              {/* front legs back */}
              <rect x="18" y="25" width="2" height="3" fill="#b45309" rx="1" />
              <rect x="22" y="24" width="2" height="4" fill="#d97706" rx="1" />
              {/* head */}
              <rect x="22" y="10" width="8" height="8" fill="#f59e0b" />
              <rect x="22" y="8" width="2" height="2" fill="#d97706" />
              <rect x="28" y="8" width="2" height="2" fill="#d97706" />
              <rect x="26" y="12" width="2" height="2" fill="#1e293b" />
              <rect x="30" y="14" width="2" height="2" fill="#fcd34d" />
              <rect x="32" y="14" width="1" height="1" fill="#ef4444" />
            </g>

            {/* ---- FRAME 3: legs tucked 2 ---- */}
            <g id="f3" style={{ display: 'none' }}>
              <ellipse cx="16" cy="30" rx="14" ry="2" fill="rgba(0,0,0,0.08)" />
              {/* tail low */}
              <rect x="1" y="16" width="2" height="4" fill="#f59e0b" />
              <rect x="3" y="18" width="2" height="1" fill="#d97706" />
              {/* hind legs */}
              <rect x="6" y="22" width="2" height="4" fill="#b45309" rx="1" />
              <rect x="8" y="22" width="2" height="4" fill="#d97706" rx="1" />
              {/* body */}
              <rect x="6" y="16" width="14" height="6" fill="#f59e0b" />
              <rect x="8" y="14" width="10" height="2" fill="#f59e0b" />
              <rect x="10" y="16" width="2" height="3" fill="#d97706" />
              <rect x="14" y="16" width="2" height="3" fill="#d97706" />
              {/* front legs */}
              <rect x="18" y="22" width="2" height="4" fill="#d97706" rx="1" />
              <rect x="20" y="22" width="2" height="4" fill="#b45309" rx="1" />
              {/* head */}
              <rect x="20" y="10" width="8" height="8" fill="#f59e0b" />
              <rect x="20" y="8" width="2" height="2" fill="#d97706" />
              <rect x="26" y="8" width="2" height="2" fill="#d97706" />
              <rect x="24" y="12" width="2" height="2" fill="#1e293b" />
            </g>
          </g>
        </defs>

        <style>
          {`
            @keyframes sprint-frames {
              0%   { transform: translateX(-96px); }
              7%   { transform: translateX(-96px); }
              25%  { transform: translateX(-32px); }
              32%  { transform: translateX(-32px); }
              50%  { transform: translateX(32px); }
              57%  { transform: translateX(32px); }
              75%  { transform: translateX(96px); }
              82%  { transform: translateX(96px); }
              100% { transform: translateX(160px); }
            }
            @keyframes frame-cycle {
              0%, 12%   { opacity: 1; }
              13%, 24%  { opacity: 0; }
              25%, 37%  { opacity: 1; }
              38%, 49%  { opacity: 0; }
              50%, 62%  { opacity: 1; }
              63%, 74%  { opacity: 0; }
              75%, 87%  { opacity: 1; }
              88%, 100% { opacity: 0; }
            }
            @keyframes dust-drift-1 {
              0%   { opacity: 0; transform: scale(0.6) translateX(0); }
              15%  { opacity: 0.5; }
              40%  { opacity: 0; transform: scale(1.2) translateX(-12px); }
              100% { opacity: 0; }
            }
            @keyframes dust-drift-2 {
              0%   { opacity: 0; transform: scale(0.6) translateX(0); }
              50%  { opacity: 0.4; }
              75%  { opacity: 0; transform: scale(1) translateX(-10px); }
              100% { opacity: 0; }
            }
            @keyframes dust-drift-3 {
              0%   { opacity: 0; transform: scale(0.6) translateX(0); }
              30%  { opacity: 0.3; }
              60%  { opacity: 0; transform: scale(1.1) translateX(-8px); }
              100% { opacity: 0; }
            }
            .cat-sprint    { animation: sprint-frames  0.8s infinite step-end; }
            .cat-f0        { animation: frame-cycle    0.8s infinite step-end; }
            .cat-f1        { animation: frame-cycle    0.8s infinite step-end 0.2s; }
            .cat-f2        { animation: frame-cycle    0.8s infinite step-end 0.4s; }
            .cat-f3        { animation: frame-cycle    0.8s infinite step-end 0.6s; }
            .dust-drift-1  { animation: dust-drift-1   1.2s infinite ease-out 0s; }
            .dust-drift-2  { animation: dust-drift-2   1.2s infinite ease-out 0.4s; }
            .dust-drift-3  { animation: dust-drift-3   1.2s infinite ease-out 0.8s; }
          `}
        </style>

        <g className="cat-sprint">
          {/* Dust */}
          <circle cx="20" cy="28" r="2" fill="#d1d5db" className="dust-drift-1" />
          <circle cx="18" cy="26" r="1.5" fill="#e5e7eb" className="dust-drift-2" />
          <circle cx="22" cy="27" r="1" fill="#f3f4f6" className="dust-drift-3" />

          <use href="#f0" className="cat-f0" />
          <use href="#f1" className="cat-f1" />
          <use href="#f2" className="cat-f2" />
          <use href="#f3" className="cat-f3" />
        </g>
      </svg>
    </div>
  );
}

export function LoadingScreen({ message = 'Loading...' }: LoadingScreenProps) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-col items-center justify-center gap-4 p-12">
        <RunningPixelCat />
        <div className="text-center">
          <p className="text-sm font-semibold text-slate-950">{message}</p>
          <p className="mt-1 text-xs text-slate-600">Please wait while we fetch your data</p>
        </div>
      </CardContent>
    </Card>
  );
}
