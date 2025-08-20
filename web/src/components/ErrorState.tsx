export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="glass-card-cyber p-8 text-center border-red-500/30">
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-16 w-16 text-red-400 animate-pulse"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 18.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
          <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-400 rounded-full animate-ping"></div>
        </div>
        <div>
          <h3 className="text-xl font-bold text-red-400 cyber-text-glow mb-2">SYSTEM ERROR</h3>
          <p className="text-yellow-300/80">{message}</p>
        </div>
        <button
          className="cyber-button bg-red-500/20 border-red-400/50 text-red-400 hover:bg-red-500/30"
          onClick={onRetry}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4 mr-2"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          RETRY CONNECTION
        </button>
      </div>
    </div>
  );
}
