import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { DashboardPage } from "./pages/dashboard/DashboardPage";
import { ProfilePage } from "./pages/profile/ProfilePage";
import { ProgramsPage } from "./pages/programs/ProgramsPage";
import { SubmissionsPage } from "./pages/submissions/SubmissionsPage";
import { DesignSystemPage } from "./pages/design-system/DesignSystemPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

function isDevQuery(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("dev") === "1";
}

export default function App() {
  const showDesignSystem = isDevQuery();
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="programs" element={<ProgramsPage />} />
            <Route path="submissions" element={<SubmissionsPage />} />
            {showDesignSystem ? (
              <Route path="design-system" element={<DesignSystemPage />} />
            ) : null}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
