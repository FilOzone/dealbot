import { Badge } from "@/components/ui/badge";

interface ApprovalBadgeProps {
  approved: boolean;
}

export function ApprovalBadge({ approved }: ApprovalBadgeProps) {
  if (!approved) return null;

  return (
    <Badge className="text-center" variant="default">
      Approved
    </Badge>
  );
}
