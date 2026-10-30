"use client";

import * as React from "react";
import {
  Search,
  Plus,
  Cpu,
  MoreVertical,
  Trash2,
  Key,
  Shield,
  QrCode,
  KeyRound,
  Check,
  Upload,
  ArrowRight,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { UiAccount, UiDevice } from "./types";
import { generateTotpCode, formatTotpCode, getSecondsRemaining } from "@/lib/totp-client";

interface AuthenticatorCodesViewProps {
  accounts: UiAccount[];
  devices: UiDevice[];
  searchQuery?: string;
  onOpenAdd: () => void;
  onOpenScanQr: () => void;
  onOpenImport: () => void;
  onAccountDeleted: (accountId: string) => void;
  onOpenReplaceSecret: (account: UiAccount) => void;
  onOpenAssignDevice: (account: UiAccount) => void;
  onOpenRegisterDevice: () => void;
}

export function AuthenticatorCodesView({
  accounts,
  devices,
  searchQuery = "",
  onOpenAdd,
  onOpenScanQr,
  onOpenImport,
  onAccountDeleted,
  onOpenReplaceSecret,
  onOpenAssignDevice,
  onOpenRegisterDevice,
}: AuthenticatorCodesViewProps) {
  const [activeFilter, setActiveFilter] = React.useState<"all" | "synced" | "local">("all");
  const [codes, setCodes] = React.useState<Record<string, string>>({});
  const [secondsRemaining, setSecondsRemaining] = React.useState<number>(30);
  const [recentlyCopiedId, setRecentlyCopiedId] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;

    const updateCodes = async () => {
      const remaining = getSecondsRemaining(30);
      if (active) {
        setSecondsRemaining(remaining);
      }

      const freshCodes: Record<string, string> = {};
      for (const account of accounts) {
        if (!account.enabled) {
          freshCodes[account.id] = "DISABLED";
          continue;
        }

        if (account.secret) {
          const code = await generateTotpCode(
            account.secret,
            account.period || 30,
            account.digits || 6,
            account.algorithm || "SHA1"
          );
          freshCodes[account.id] = code;
        } else {
          freshCodes[account.id] = "------";
        }
      }

      if (active) {
        setCodes(freshCodes);
      }
    };

    updateCodes();
    const intervalTimer = setInterval(updateCodes, 1000);

    return () => {
      active = false;
      clearInterval(intervalTimer);
    };
  }, [accounts]);

  const filteredAccounts = accounts.filter((account) => {
    const query = searchQuery.trim().toLowerCase();
    const matchesQuery =
      query === "" ||
      account.name.toLowerCase().includes(query) ||
      (account.issuer && account.issuer.toLowerCase().includes(query)) ||
      (account.account_label && account.account_label.toLowerCase().includes(query));

    if (!matchesQuery) return false;

    if (activeFilter === "synced") {
      return Boolean(account.device_id);
    }
    if (activeFilter === "local") {
      return !account.device_id;
    }
    return true;
  });

  const handleCopyCode = async (account: UiAccount) => {
    const code = codes[account.id];
    if (!code || code === "DISABLED" || code === "------") return;

    await navigator.clipboard.writeText(code);
    setRecentlyCopiedId(account.id);
    toast.success(`Copied ${formatTotpCode(code)} to clipboard`);
    setTimeout(() => {
      setRecentlyCopiedId(null);
    }, 2000);
  };

  const timerRadius = 12;
  const timerCircumference = 2 * Math.PI * timerRadius;
  const strokeDashoffset = timerCircumference - (secondsRemaining / 30) * timerCircumference;
  const isExpiringSoon = secondsRemaining <= 5;

  return (
    <div className="w-full max-w-2xl mx-auto space-y-4 pb-24">
      {accounts.length > 0 && (
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-1.5 overflow-x-auto py-1">
            <button
              type="button"
              onClick={() => setActiveFilter("all")}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${
                activeFilter === "all"
                  ? "bg-[#004a77] text-[#c2e7ff] border border-[#7cacf8]/40"
                  : "bg-[#1e1f20] text-[#8e918f] hover:text-[#e3e3e3] border border-transparent"
              }`}
            >
              All accounts ({accounts.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveFilter("synced")}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all inline-flex items-center gap-1.5 ${
                activeFilter === "synced"
                  ? "bg-[#004a77] text-[#c2e7ff] border border-[#7cacf8]/40"
                  : "bg-[#1e1f20] text-[#8e918f] hover:text-[#e3e3e3] border border-transparent"
              }`}
            >
              <Cpu className="h-3 w-3" />
              ESP32 Synced ({accounts.filter((a) => a.device_id).length})
            </button>
            <button
              type="button"
              onClick={() => setActiveFilter("local")}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${
                activeFilter === "local"
                  ? "bg-[#004a77] text-[#c2e7ff] border border-[#7cacf8]/40"
                  : "bg-[#1e1f20] text-[#8e918f] hover:text-[#e3e3e3] border border-transparent"
              }`}
            >
              Phone/PC Only ({accounts.filter((a) => !a.device_id).length})
            </button>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onOpenImport}
              className="p-2 rounded-full text-[#8e918f] hover:text-[#e3e3e3] hover:bg-[#282a2c] transition-colors"
              title="Import codes"
            >
              <Upload className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center px-4 py-16 sm:py-24">
          <div className="relative mb-6">
            <div className="h-28 w-28 rounded-full bg-[#1e1f20] border border-white/5 flex items-center justify-center shadow-lg">
              <Shield className="h-14 w-14 text-[#8ab4f8] stroke-[1.5]" />
            </div>
            <div className="absolute -bottom-1 -right-1 h-9 w-9 rounded-full bg-[#004a77] text-[#c2e7ff] border-2 border-[#131314] flex items-center justify-center shadow">
              <KeyRound className="h-4 w-4" />
            </div>
          </div>

          <h2 className="text-2xl font-normal text-[#e3e3e3] tracking-tight">
            Get your verification codes
          </h2>
          <p className="text-sm text-[#8e918f] max-w-sm mx-auto mt-2 leading-relaxed">
            Generate two-step verification codes for all your online accounts. You can also pair an ESP32 hardware device to view codes when your phone is unavailable.
          </p>

          <div className="flex flex-col sm:flex-row items-center gap-3 mt-8 w-full max-w-md">
            <button
              type="button"
              onClick={onOpenScanQr}
              className="w-full h-11 px-5 rounded-full bg-[#8ab4f8] hover:bg-[#a8c7fa] text-[#041e49] font-medium text-sm transition-all flex items-center justify-center gap-2 shadow"
            >
              <QrCode className="h-4 w-4" />
              Scan a QR code
            </button>

            <button
              type="button"
              onClick={onOpenAdd}
              className="w-full h-11 px-5 rounded-full bg-[#1e1f20] hover:bg-[#282a2c] text-[#e3e3e3] border border-white/10 font-medium text-sm transition-all flex items-center justify-center gap-2"
            >
              <KeyRound className="h-4 w-4 text-[#8ab4f8]" />
              Enter setup key
            </button>

            <button
              type="button"
              onClick={onOpenRegisterDevice}
              className="w-full h-11 px-5 rounded-full bg-[#1e1f20] hover:bg-[#282a2c] text-[#e3e3e3] border border-white/10 font-medium text-sm transition-all flex items-center justify-center gap-2"
            >
              <Cpu className="h-4 w-4 text-[#8ab4f8]" />
              Pair ESP32
            </button>
          </div>
        </div>
      ) : filteredAccounts.length === 0 ? (
        <div className="rounded-2xl bg-[#1e1f20]/60 border border-[#282a2c] py-14 text-center px-4">
          <div className="h-12 w-12 rounded-full bg-[#282a2c] text-[#8e918f] mx-auto flex items-center justify-center mb-3">
            <Search className="h-5 w-5" />
          </div>
          <h3 className="text-base font-medium text-[#e3e3e3]">No accounts found</h3>
          <p className="text-xs text-[#8e918f] max-w-xs mx-auto mt-1">
            Try adjusting your search query or selecting a different filter.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredAccounts.map((account) => {
            const rawCode = codes[account.id] || "------";
            const formatted = formatTotpCode(rawCode);
            const isCopied = recentlyCopiedId === account.id;

            return (
              <div
                key={account.id}
                onClick={() => handleCopyCode(account)}
                className="group relative rounded-2xl bg-[#1e1f20] hover:bg-[#282a2c] border border-transparent hover:border-white/5 p-4 sm:px-5 sm:py-4 transition-all duration-150 cursor-pointer select-none active:scale-[0.99] flex items-center justify-between gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[17px] font-medium text-[#e3e3e3] truncate tracking-normal">
                      {account.issuer || account.name}
                    </h3>
                  </div>

                  <p className="text-[13px] text-[#8e918f] truncate font-normal mt-0.5">
                    {account.account_label || account.name}
                  </p>

                  {account.device_name && (
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#004a77]/50 text-[#c2e7ff] border border-[#7cacf8]/30 mt-2">
                      <Cpu className="h-3 w-3 text-[#8ab4f8]" />
                      <span>ESP32: {account.device_name}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-[32px] sm:text-[38px] leading-none tracking-[0.16em] tabular-nums font-mono font-normal transition-colors duration-200 ${
                        rawCode === "DISABLED"
                          ? "text-[#8e918f] text-xl tracking-normal font-sans"
                          : isExpiringSoon
                          ? "text-[#f28b82]"
                          : "text-[#8ab4f8]"
                      }`}
                    >
                      {rawCode === "DISABLED" ? "Disabled" : formatted}
                    </span>

                    {rawCode !== "DISABLED" && (
                      <div className="relative flex items-center justify-center h-7 w-7 shrink-0">
                        <svg className="w-7 h-7 -rotate-90" viewBox="0 0 28 28">
                          <circle
                            cx="14"
                            cy="14"
                            r={timerRadius}
                            stroke="currentColor"
                            strokeWidth="2.5"
                            fill="transparent"
                            className="text-[#3c4043]"
                          />
                          <circle
                            cx="14"
                            cy="14"
                            r={timerRadius}
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeDasharray={timerCircumference}
                            strokeDashoffset={strokeDashoffset}
                            strokeLinecap="round"
                            fill="transparent"
                            className={`transition-all duration-1000 ease-linear ${
                              isExpiringSoon ? "text-[#f28b82]" : "text-[#8ab4f8]"
                            }`}
                          />
                        </svg>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="h-10 w-10 rounded-full text-[#8e918f] hover:text-[#e3e3e3] hover:bg-[#3c4043]/50 flex items-center justify-center transition-colors"
                        >
                          <MoreVertical className="h-5 w-5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52 rounded-xl bg-[#282a2c] border-[#3c4043] text-xs py-1.5 shadow-xl">
                        <DropdownMenuItem
                          onClick={() => onOpenAssignDevice(account)}
                          className="px-3 py-2 text-[#e3e3e3] hover:bg-[#3c4043] focus:bg-[#3c4043] cursor-pointer"
                        >
                          <Cpu className="h-4 w-4 mr-2.5 text-[#8ab4f8]" />
                          Assign to ESP32 device
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => onOpenReplaceSecret(account)}
                          className="px-3 py-2 text-[#e3e3e3] hover:bg-[#3c4043] focus:bg-[#3c4043] cursor-pointer"
                        >
                          <Key className="h-4 w-4 mr-2.5 text-[#8ab4f8]" />
                          Replace setup key
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-[#3c4043]" />
                        <DropdownMenuItem
                          onClick={() => onAccountDeleted(account.id)}
                          className="px-3 py-2 text-[#f28b82] hover:bg-[#3c4043] focus:bg-[#3c4043] cursor-pointer"
                        >
                          <Trash2 className="h-4 w-4 mr-2.5" />
                          Delete account
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
