import { Route, Routes } from "react-router-dom";
import Layout from "@/Layout";
import Landing from "@/pages/Landing";
import NewLanding from "@/pages/NewLanding";
import NewProviderDetail from "@/pages/NewProviderDetail";

/**
 * Main application component
 * Displays network statistics, provider performance, and daily metrics
 */
export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/new" element={<NewLanding />} />
        <Route path="/new/provider/:providerAddress" element={<NewProviderDetail />} />
      </Routes>
    </Layout>
  );
}
