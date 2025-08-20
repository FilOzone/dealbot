export function Skeleton() {
  return (
    <div className="min-h-screen cyber-bg" data-theme="cyberpunk">
      {/* Animated background particles */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-2 h-2 bg-yellow-400 rounded-full animate-pulse opacity-60"></div>
        <div className="absolute top-3/4 right-1/4 w-1 h-1 bg-yellow-300 rounded-full animate-ping opacity-40"></div>
        <div className="absolute top-1/2 left-3/4 w-1.5 h-1.5 bg-yellow-500 rounded-full animate-pulse opacity-50"></div>
      </div>

      <div className="cyber-header">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-yellow-400/20 rounded-xl animate-pulse"></div>
              <div>
                <div className="h-8 w-48 bg-yellow-400/20 rounded animate-pulse mb-2"></div>
                <div className="h-4 w-32 bg-yellow-400/10 rounded animate-pulse"></div>
              </div>
            </div>
            <div className="h-10 w-24 bg-yellow-400/20 rounded-lg animate-pulse"></div>
          </div>
        </div>
      </div>

      <div className="relative z-10 p-8 space-y-12 max-w-7xl mx-auto">
        <div className="text-center py-12">
          <div className="h-16 w-96 bg-yellow-400/20 rounded-lg mx-auto mb-4 animate-pulse"></div>
          <div className="h-6 w-64 bg-yellow-400/10 rounded mx-auto animate-pulse"></div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="glass-card-cyber animate-pulse">
              <div className="stat-cyber">
                <div className="h-4 w-24 bg-yellow-400/20 rounded mb-2"></div>
                <div className="h-8 w-16 bg-yellow-400/30 rounded"></div>
              </div>
            </div>
          ))}
        </div>

        <div className="glass-card-cyber p-8 animate-pulse">
          <div className="h-8 w-48 bg-yellow-400/20 rounded mb-6"></div>
          <div className="h-80 w-full bg-yellow-400/10 rounded-2xl"></div>
        </div>
      </div>
    </div>
  );
}
