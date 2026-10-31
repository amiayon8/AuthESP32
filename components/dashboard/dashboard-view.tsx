"use client";

import * as React from "react";
import {
  Cpu,
  KeyRound,
  Layers,
  BookOpen,
  Plus,
  RefreshCw,
  Search,
  X,
  Cloud,
  LogOut,
  QrCode,
  Key,
  Camera,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { UiDevice, UiAccount, UiAuditLog, DashboardTab } from "./types";
import { AuthenticatorCodesView } from "./authenticator-codes-view";
import { DevicesTab } from "./devices-tab";
import { AuditTab } from "./audit-tab";
import { SetupGuideTab } from "./setup-guide-tab";
import { RegisterDeviceDialog } from "./register-device-dialog";
import { AddAccountDialog } from "./add-account-dialog";
import { ImportAccountsDialog } from "./import-accounts-dialog";
import { ReplaceSecretDialog } from "./replace-secret-dialog";
import { AssignDeviceDialog } from "./assign-device-dialog";
import { QrScannerDialog } from "./qr-scanner-dialog";

export function DashboardView() {
  const [activeTab, setActiveTab] = React.useState<DashboardTab>("authenticator");
  const [devices, setDevices] = React.useState<UiDevice[]>([]);
  const [accounts, setAccounts] = React.useState<UiAccount[]>([]);
  const [auditLogs, setAuditLogs] = React.useState<UiAuditLog[]>([]);
  const [refreshing, setRefreshing] = React.useState(false);
  const [initialLoading, setInitialLoading] = React.useState(true);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [speedDialOpen, setSpeedDialOpen] = React.useState(false);

  const [qrScannerOpen, setQrScannerOpen] = React.useState(false);
  const [registerOpen, setRegisterOpen] = React.useState(false);
  const [addAccountOpen, setAddAccountOpen] = React.useState(false);
  const [importAccountsOpen, setImportAccountsOpen] = React.useState(false);
  const [selectedAccountForReplace, setSelectedAccountForReplace] = React.useState<UiAccount | null>(null);
  const [replaceSecretOpen, setReplaceSecretOpen] = React.useState(false);
  const [selectedAccountForAssign, setSelectedAccountForAssign] = React.useState<UiAccount | null>(null);
  const [assignDeviceOpen, setAssignDeviceOpen] = React.useState(false);

  const fetchDashboardData = React.useCallback(async (showToast = false) => {
    setRefreshing(true);
    try {
      const [devicesRes, accountsRes, auditRes] = await Promise.allSettled([
        fetch("/api/devices").then((res) => (res.ok ? res.json() : null)),
        fetch("/api/accounts").then((res) => (res.ok ? res.json() : null)),
        fetch("/api/audit").then((res) => (res.ok ? res.json() : null)),
      ]);

      if (devicesRes.status === "fulfilled" && devicesRes.value?.data) {
        const fetchedDevices = Array.isArray(devicesRes.value.data)
          ? devicesRes.value.data
          : devicesRes.value.data.devices || [];
        setDevices(fetchedDevices);
      }
      if (accountsRes.status === "fulfilled" && accountsRes.value?.data) {
        const fetchedAccounts = Array.isArray(accountsRes.value.data)
          ? accountsRes.value.data
          : accountsRes.value.data.accounts || [];
        setAccounts(fetchedAccounts);
      }
      if (auditRes.status === "fulfilled" && auditRes.value?.data) {
        const fetchedLogs = Array.isArray(auditRes.value.data)
          ? auditRes.value.data
          : auditRes.value.data.logs || [];
        setAuditLogs(fetchedLogs);
      }

      if (showToast) {
        toast.success("Synchronized with cloud and hardware authenticators");
      }
    } catch {
      if (showToast) {
        toast.error("Network error while syncing accounts");
      }
    } finally {
      setRefreshing(false);
      setInitialLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchDashboardData(false);
  }, [fetchDashboardData]);

  const handleDeviceCreated = (newDevice: UiDevice) => {
    setDevices((prev) => [newDevice, ...prev]);
  };

  const handleDeviceUpdated = (updatedDevice: UiDevice) => {
    setDevices((prev) =>
      prev.map((d) => (d.id === updatedDevice.id ? updatedDevice : d))
    );
  };

  const handleDeviceDeleted = (deviceId: string) => {
    setDevices((prev) => prev.filter((d) => d.id !== deviceId));
    setAccounts((prev) =>
      prev.map((acc) =>
        acc.device_id === deviceId
          ? { ...acc, device_id: null, device_name: null, device_prefix: null }
          : acc
      )
    );
  };

  const handleAccountCreated = (newAccount: UiAccount) => {
    setAccounts((prev) => [newAccount, ...prev]);
    if (newAccount.device_id) {
      setDevices((prev) =>
        prev.map((dev) =>
          dev.id === newAccount.device_id
            ? {
                ...dev,
                active_account_count: (dev.active_account_count ?? 0) + 1,
                total_account_count: (dev.total_account_count ?? 0) + 1,
              }
            : dev
        )
      );
    }
  };

  const handleAccountsImported = (imported: UiAccount[]) => {
    setAccounts((prev) => [...imported, ...prev]);
  };

  const handleAccountUpdated = (updatedAccount: UiAccount) => {
    setAccounts((prev) =>
      prev.map((a) => (a.id === updatedAccount.id ? updatedAccount : a))
    );
  };

  const handleAccountDeleted = (accountId: string) => {
    setAccounts((prev) => prev.filter((a) => a.id !== accountId));
    toast.success("Account deleted");
  };

  const handleSignOut = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/auth/login";
    } catch {
      window.location.href = "/auth/login";
    }
  };

  const activeHardwareCount = devices.filter((d) => d.active && !d.revoked_at).length;
  const syncedAccountCount = accounts.filter((a) => a.device_id && a.enabled).length;

  return (
    <div className="min-h-screen bg-[#131314] text-[#e3e3e3] flex flex-col font-sans selection:bg-[#8ab4f8]/30 selection:text-[#8ab4f8] relative">
      {refreshing && (
        <div className="fixed top-0 left-0 right-0 h-1 z-50 overflow-hidden bg-[#1e1f20]">
          <div className="h-full bg-[#8ab4f8] w-1/3 animate-pulse" />
        </div>
      )}

      <header className="sticky top-0 z-30 pt-3 pb-2 px-4 bg-[#131314]/90 backdrop-blur-md">
        <div className="max-w-2xl mx-auto space-y-3">
          <div className="h-14 rounded-full bg-[#1e1f20] hover:bg-[#282a2c] transition-all px-4 flex items-center justify-between gap-3 shadow-md border border-white/5">
            <Search className="h-5 w-5 text-[#8e918f] shrink-0" />

            <input
              type="text"
              placeholder="Search accounts"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent border-none text-[15px] sm:text-[16px] text-[#e3e3e3] placeholder:text-[#8e918f] focus:outline-none focus:ring-0 font-normal"
            />

            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="p-1 rounded-full text-[#8e918f] hover:text-[#e3e3e3] transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            )}

            <button
              type="button"
              onClick={() => fetchDashboardData(true)}
              className="p-2 rounded-full text-[#8e918f] hover:text-[#e3e3e3] hover:bg-[#3c4043]/40 transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="relative h-8 w-8 rounded-full bg-[#8ab4f8] hover:bg-[#a8c7fa] text-[#041e49] font-medium text-sm flex items-center justify-center transition-all shadow shrink-0"
                >
                  <span>A</span>
                  <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-[#81c995] border-2 border-[#1e1f20]" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72 rounded-3xl bg-[#282a2c] border-[#3c4043] p-4 shadow-2xl text-[#e3e3e3]">
                <div className="flex items-center gap-3 pb-3 border-b border-[#3c4043]">
                  <div className="h-10 w-10 rounded-full bg-[#8ab4f8] text-[#041e49] font-medium flex items-center justify-center text-base">
                    A
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#e3e3e3] truncate">
                      Authenticator Account
                    </p>
                    <p className="text-xs text-[#8e918f] truncate">
                      user@company.internal
                    </p>
                  </div>
                </div>

                <div className="py-3 space-y-2 border-b border-[#3c4043] text-xs">
                  <div className="flex items-center justify-between text-[#c4c7c5]">
                    <span className="flex items-center gap-2">
                      <Cloud className="h-3.5 w-3.5 text-[#81c995]" />
                      Cloud backup
                    </span>
                    <span className="text-[#81c995] font-medium">Active</span>
                  </div>

                  <div className="flex items-center justify-between text-[#c4c7c5]">
                    <span className="flex items-center gap-2">
                      <Cpu className="h-3.5 w-3.5 text-[#8ab4f8]" />
                      ESP32 hardware keys
                    </span>
                    <span className="font-mono text-[#8ab4f8]">
                      {activeHardwareCount} paired
                    </span>
                  </div>
                </div>

                <div className="pt-2">
                  <DropdownMenuItem
                    onClick={handleSignOut}
                    className="px-3 py-2 text-[#f28b82] hover:bg-[#3c4043] focus:bg-[#3c4043] rounded-xl cursor-pointer text-xs"
                  >
                    <LogOut className="h-4 w-4 mr-2" />
                    Sign out
                  </DropdownMenuItem>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <nav className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 px-1">
            <button
              type="button"
              onClick={() => setActiveTab("authenticator")}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all shrink-0 flex items-center gap-1.5 ${
                activeTab === "authenticator"
                  ? "bg-[#004a77] text-[#c2e7ff] border border-[#7cacf8]/40 shadow-sm"
                  : "bg-[#1e1f20] text-[#8e918f] hover:text-[#e3e3e3] border border-transparent"
              }`}
            >
              <KeyRound className="h-3.5 w-3.5" />
              Codes
              <span className="ml-1 px-1.5 py-0.2 rounded-full bg-[#131314]/40 text-[10px]">
                {accounts.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("devices")}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all shrink-0 flex items-center gap-1.5 ${
                activeTab === "devices"
                  ? "bg-[#004a77] text-[#c2e7ff] border border-[#7cacf8]/40 shadow-sm"
                  : "bg-[#1e1f20] text-[#8e918f] hover:text-[#e3e3e3] border border-transparent"
              }`}
            >
              <Cpu className="h-3.5 w-3.5" />
              ESP32 Authenticators
              <span className="ml-1 px-1.5 py-0.2 rounded-full bg-[#131314]/40 text-[10px]">
                {devices.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("audit")}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all shrink-0 flex items-center gap-1.5 ${
                activeTab === "audit"
                  ? "bg-[#004a77] text-[#c2e7ff] border border-[#7cacf8]/40 shadow-sm"
                  : "bg-[#1e1f20] text-[#8e918f] hover:text-[#e3e3e3] border border-transparent"
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              Activity
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("guide")}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all shrink-0 flex items-center gap-1.5 ${
                activeTab === "guide"
                  ? "bg-[#004a77] text-[#c2e7ff] border border-[#7cacf8]/40 shadow-sm"
                  : "bg-[#1e1f20] text-[#8e918f] hover:text-[#e3e3e3] border border-transparent"
              }`}
            >
              <BookOpen className="h-3.5 w-3.5" />
              Firmware Setup
            </button>
          </nav>
        </div>
      </header>

      <main className="flex-1 w-full max-w-2xl mx-auto px-4 py-3">
        {activeTab === "authenticator" && (
          <AuthenticatorCodesView
            accounts={accounts}
            devices={devices}
            searchQuery={searchQuery}
            onOpenAdd={() => setAddAccountOpen(true)}
            onOpenScanQr={() => setQrScannerOpen(true)}
            onOpenImport={() => setImportAccountsOpen(true)}
            onAccountDeleted={handleAccountDeleted}
            onOpenReplaceSecret={(acc) => {
              setSelectedAccountForReplace(acc);
              setReplaceSecretOpen(true);
            }}
            onOpenAssignDevice={(acc) => {
              setSelectedAccountForAssign(acc);
              setAssignDeviceOpen(true);
            }}
            onOpenRegisterDevice={() => setRegisterOpen(true)}
          />
        )}

        {activeTab === "devices" && (
          <DevicesTab
            devices={devices}
            onOpenRegister={() => setRegisterOpen(true)}
            onDeviceUpdated={handleDeviceUpdated}
            onDeviceDeleted={handleDeviceDeleted}
          />
        )}

        {activeTab === "audit" && <AuditTab auditLogs={auditLogs} />}

        {activeTab === "guide" && <SetupGuideTab />}
      </main>

      <div className="fixed bottom-6 right-6 sm:bottom-8 sm:right-8 z-40 flex flex-col items-end gap-3">
        {speedDialOpen && (
          <div className="flex flex-col items-end gap-2.5 animate-in fade-in slide-in-from-bottom-3 duration-200">
            <button
              type="button"
              onClick={() => {
                setSpeedDialOpen(false);
                setQrScannerOpen(true);
              }}
              className="flex items-center gap-3 px-4 py-2.5 rounded-full bg-[#282a2c] text-[#e3e3e3] hover:bg-[#3c4043] border border-white/5 shadow-lg text-xs font-medium transition-all active:scale-95"
            >
              <span>Scan a QR code</span>
              <div className="h-8 w-8 rounded-full bg-[#004a77] text-[#c2e7ff] flex items-center justify-center">
                <Camera className="h-4 w-4 text-[#8ab4f8]" />
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setSpeedDialOpen(false);
                setAddAccountOpen(true);
              }}
              className="flex items-center gap-3 px-4 py-2.5 rounded-full bg-[#282a2c] text-[#e3e3e3] hover:bg-[#3c4043] border border-white/5 shadow-lg text-xs font-medium transition-all active:scale-95"
            >
              <span>Enter a setup key</span>
              <div className="h-8 w-8 rounded-full bg-[#004a77] text-[#c2e7ff] flex items-center justify-center">
                <Key className="h-4 w-4" />
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setSpeedDialOpen(false);
                setImportAccountsOpen(true);
              }}
              className="flex items-center gap-3 px-4 py-2.5 rounded-full bg-[#282a2c] text-[#e3e3e3] hover:bg-[#3c4043] border border-white/5 shadow-lg text-xs font-medium transition-all active:scale-95"
            >
              <span>Import accounts URI</span>
              <div className="h-8 w-8 rounded-full bg-[#004a77] text-[#c2e7ff] flex items-center justify-center">
                <QrCode className="h-4 w-4" />
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setSpeedDialOpen(false);
                setRegisterOpen(true);
              }}
              className="flex items-center gap-3 px-4 py-2.5 rounded-full bg-[#282a2c] text-[#e3e3e3] hover:bg-[#3c4043] border border-white/5 shadow-lg text-xs font-medium transition-all active:scale-95"
            >
              <span>Pair ESP32 authenticator</span>
              <div className="h-8 w-8 rounded-full bg-[#004a77] text-[#c2e7ff] flex items-center justify-center">
                <Cpu className="h-4 w-4" />
              </div>
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => setSpeedDialOpen(!speedDialOpen)}
          className={`h-14 w-14 rounded-2xl bg-[#a8c7fa] hover:bg-[#8ab4f8] text-[#041e49] shadow-xl hover:shadow-2xl flex items-center justify-center transition-all duration-200 active:scale-95 ${
            speedDialOpen ? "rotate-45" : ""
          }`}
          title="Add account or hardware authenticator"
        >
          <Plus className="h-7 w-7 stroke-[2.5]" />
        </button>
      </div>

      <QrScannerDialog
        open={qrScannerOpen}
        onOpenChange={setQrScannerOpen}
        devices={devices}
        onAccountCreated={handleAccountCreated}
      />

      <RegisterDeviceDialog
        open={registerOpen}
        onOpenChange={setRegisterOpen}
        onDeviceCreated={handleDeviceCreated}
      />

      <AddAccountDialog
        open={addAccountOpen}
        onOpenChange={setAddAccountOpen}
        devices={devices}
        onAccountCreated={handleAccountCreated}
      />

      <ImportAccountsDialog
        open={importAccountsOpen}
        onOpenChange={setImportAccountsOpen}
        devices={devices}
        onAccountsImported={handleAccountsImported}
      />

      <ReplaceSecretDialog
        account={selectedAccountForReplace}
        open={replaceSecretOpen}
        onOpenChange={setReplaceSecretOpen}
      />

      <AssignDeviceDialog
        account={selectedAccountForAssign}
        devices={devices}
        open={assignDeviceOpen}
        onOpenChange={setAssignDeviceOpen}
        onAccountUpdated={handleAccountUpdated}
      />
    </div>
  );
}
