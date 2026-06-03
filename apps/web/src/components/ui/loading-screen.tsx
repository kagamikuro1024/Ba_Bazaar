import { Loader2 } from 'lucide-react';
import { Card, CardContent } from './card';

type LoadingScreenProps = {
  message?: string;
};

export function LoadingScreen({ message = 'Loading...' }: LoadingScreenProps) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-col items-center justify-center gap-4 p-12">
        <Loader2 className="h-12 w-12 animate-spin text-blue-600" />
        <div className="text-center">
          <p className="text-sm font-semibold text-slate-950">{message}</p>
          <p className="mt-1 text-xs text-slate-600">Please wait while we fetch your data</p>
        </div>
      </CardContent>
    </Card>
  );
}
