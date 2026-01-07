const Footer = () => (
  <footer className="relative z-10 mt-20 py-8 border-t">
    <div className="container mx-auto px-6">
      <div className="flex flex-col lg:flex-row items-center justify-between gap-6">
        <div>
          <p className="text-sm font-semibold">Mini Deal Bot Analytics</p>
          <p className="text-sm text-muted-foreground">Automated storage deals on Filecoin network</p>
          <p className="text-xs text-muted-foreground mt-1">
            CDN A/B testing • Performance tracking • Real-time monitoring
          </p>
        </div>

        <div>
          <p className="text-sm font-medium">Open Source</p>
          <a
            href="https://github.com/FilOzone/dealbot"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            github.com/FilOzone/dealbot
          </a>
        </div>
      </div>
    </div>
  </footer>
);

export default Footer;
