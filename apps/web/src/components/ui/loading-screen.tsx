import { Card, CardContent } from './card';

type LoadingScreenProps = {
  message?: string;
};

function RunningPixelCat() {
  return (
    <div className="relative h-16 w-full overflow-hidden">
      <svg
        viewBox="0 0 128 32"
        className="h-full w-full"
        style={{ shapeRendering: 'crispEdges' }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <style>
          {`
            @keyframes cat-run {
              0% { transform: translateX(-40px); }
              100% { transform: translateX(100px); }
            }
            @keyframes cat-bounce {
              0%, 100% { transform: translateY(0px); }
              50% { transform: translateY(-3px); }
            }
            @keyframes cat-tail {
              0%, 100% { transform: rotate(0deg); }
              50% { transform: rotate(-20deg); }
            }
            @keyframes cat-legs-1 {
              0%, 100% { transform: rotate(-15deg); }
              50% { transform: rotate(15deg); }
            }
            @keyframes cat-legs-2 {
              0%, 100% { transform: rotate(15deg); }
              50% { transform: rotate(-15deg); }
            }
            @keyframes dust-puff {
              0% { opacity: 0; transform: scale(0.5); }
              20% { opacity: 0.6; transform: scale(1); }
              100% { opacity: 0; transform: scale(1.5) translateX(-8px); }
            }
            .cat-runner { animation: cat-run 2s infinite linear; }
            .cat-bounce { animation: cat-bounce 0.3s infinite step-end; }
            .cat-tail { animation: cat-tail 0.3s infinite step-end; transform-origin: 6px 14px; }
            .cat-legs-1 { animation: cat-legs-1 0.3s infinite step-end; transform-origin: 10px 22px; }
            .cat-legs-2 { animation: cat-legs-2 0.3s infinite step-end; transform-origin: 22px 22px; }
            .dust-1 { animation: dust-puff 1s infinite ease-out 0s; }
            .dust-2 { animation: dust-puff 1s infinite ease-out 0.3s; }
            .dust-3 { animation: dust-puff 1s infinite ease-out 0.6s; }
          `}
        </style>
        
        <g className="cat-runner">
          {/* Dust puffs */}
          <circle cx="8" cy="26" r="2" fill="#d1d5db" className="dust-1" />
          <circle cx="12" cy="24" r="1.5" fill="#e5e7eb" className="dust-2" />
          <circle cx="6" cy="25" r="1" fill="#f3f4f6" className="dust-3" />
          
          <g className="cat-bounce">
            {/* Back Leg (Left) */}
            <g className="cat-legs-1">
              <rect x="8" y="22" width="2" height="4" fill="#d97706" />
              <rect x="10" y="22" width="2" height="4" fill="#b45309" />
            </g>
            
            {/* Front Leg (Right) */}
            <g className="cat-legs-2">
              <rect x="20" y="22" width="2" height="4" fill="#d97706" />
              <rect x="22" y="22" width="2" height="4" fill="#b45309" />
            </g>
            
            {/* Tail */}
            <g className="cat-tail">
              <rect x="2" y="10" width="2" height="6" fill="#f59e0b" />
              <rect x="4" y="14" width="2" height="2" fill="#f59e0b" />
            </g>

            {/* Body */}
            <rect x="6" y="14" width="16" height="8" fill="#f59e0b" />
            <rect x="8" y="12" width="12" height="2" fill="#f59e0b" />
            
            {/* Stripes */}
            <rect x="10" y="14" width="2" height="4" fill="#d97706" />
            <rect x="14" y="14" width="2" height="4" fill="#d97706" />
            <rect x="18" y="14" width="2" height="4" fill="#d97706" />
            
            {/* Head */}
            <rect x="20" y="8" width="8" height="8" fill="#f59e0b" />
            {/* Ears */}
            <rect x="20" y="6" width="2" height="2" fill="#d97706" />
            <rect x="26" y="6" width="2" height="2" fill="#d97706" />
            
            {/* Eyes */}
            <rect x="24" y="10" width="2" height="2" fill="#1e293b" />
            {/* Nose/Snout */}
            <rect x="28" y="12" width="2" height="2" fill="#fcd34d" />
            <rect x="30" y="12" width="1" height="1" fill="#ef4444" />
          </g>
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
