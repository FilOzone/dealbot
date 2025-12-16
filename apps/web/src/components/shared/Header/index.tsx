import { ModeToggle } from "@/components/shared";

const Header = () => (
  <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
    <div className="container mx-auto px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-md bg-primary/20 flex items-center justify-center text-primary font-bold">
            DB
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Deal Bot</h1>
            <p className="text-xs text-muted-foreground">Filecoin storage provider metrics</p>
          </div>
        </div>
        <ModeToggle />
      </div>
    </div>
  </header>
);

export default Header;
