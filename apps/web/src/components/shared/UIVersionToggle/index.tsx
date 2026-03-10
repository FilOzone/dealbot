import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Switch } from "@/components/ui/switch";

export default function UIVersionToggle() {
  const location = useLocation();
  const navigate = useNavigate();

  const isNewUI = location.pathname.startsWith("/new");

  const handleToggle = useCallback(
    (checked: boolean) => {
      navigate(checked ? "/new" : "/");
    },
    [navigate],
  );

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">New UI</span>
      <Switch id="ui-toggle" className="cursor-pointer" checked={isNewUI} onCheckedChange={handleToggle} />
    </div>
  );
}
