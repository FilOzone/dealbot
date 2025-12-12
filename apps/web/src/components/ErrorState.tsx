import { RefreshCw, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Alert variant='destructive' className='flex flex-col items-center text-center gap-4'>
      <TriangleAlert className='h-5 w-5' />
      <div>
        <AlertTitle>System error</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </div>
      <Button variant='destructive' onClick={onRetry} className='mt-2'>
        <RefreshCw className='h-4 w-4 mr-2' /> Retry
      </Button>
    </Alert>
  );
}
