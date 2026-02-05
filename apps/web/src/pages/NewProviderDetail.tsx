import { FileBarChart } from "lucide-react";
import { useParams } from "react-router-dom";
import { ComingSoon } from "@/components/shared";

export default function NewProviderDetail() {
  const { providerAddress } = useParams<{ providerAddress: string }>();

  return (
    <ComingSoon
      description={
        <>
          We're building a new provider detail view for{" "}
          <span className="font-mono text-foreground">{providerAddress}</span>
        </>
      }
      Icon={FileBarChart}
    />
  );
}
