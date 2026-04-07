import { ThemeProvider } from "@/context/theme-provider";
import { DataProvider } from "@/context/data-provider";
import Modals from "@/components/modals";
import Navbar from "./components/navbar";
import { RithmicSyncNotifications } from "./components/import/rithmic/sync/rithmic-notifications";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RithmicSyncContextProvider } from "@/context/rithmic-sync-context";
import { TradovateSyncContextProvider } from "@/context/tradovate-sync-context";
import { DxFeedSyncContextProvider } from "@/context/dxfeed-sync-context";
import { FirstradeSyncContextProvider } from "@/context/firstrade-sync-context"
import { DailyBalanceFetcher } from "./components/import/firstrade/sync/daily-balance-fetcher";

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <TooltipProvider>
      <ThemeProvider>
        <DataProvider>
          <RithmicSyncContextProvider>
            <TradovateSyncContextProvider>
              <DxFeedSyncContextProvider>
                <FirstradeSyncContextProvider>
                  <DailyBalanceFetcher />
                  <RithmicSyncNotifications />
                  <Toaster />
                  <Navbar />
                  {children}
                  <Modals />
                </FirstradeSyncContextProvider>
              </DxFeedSyncContextProvider>
            </TradovateSyncContextProvider>
          </RithmicSyncContextProvider>
        </DataProvider>
      </ThemeProvider>
    </TooltipProvider>
  );
}
