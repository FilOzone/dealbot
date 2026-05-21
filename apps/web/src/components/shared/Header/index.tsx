import { ModeToggle, NetworkSwitcher, UIVersionToggle } from "@/components/shared";

const Header = () => (
  <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
    <div className="container mx-auto px-4 py-3 sm:px-6 sm:py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          <div className="h-9 w-9 shrink-0 rounded-md bg-primary/20 flex items-center justify-center text-primary font-bold">
            DB
          </div>
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-semibold tracking-tight truncate">Deal Bot</h1>
            <p className="hidden sm:block text-xs text-muted-foreground truncate">Filecoin storage provider metrics</p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <NetworkSwitcher />
          <UIVersionToggle />
          <ModeToggle />
        </div>
      </div>
    </div>
  </header>
);

export default Header;
