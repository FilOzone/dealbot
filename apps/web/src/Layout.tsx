import { Footer, Header } from "@/components/shared";

type LayoutProps = {
  children: React.ReactNode;
};

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main className="relative z-10 container mx-auto px-6 py-8 space-y-8">{children}</main>
      <Footer />
    </div>
  );
}
