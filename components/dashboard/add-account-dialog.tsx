"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { KeyRound, Cpu, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { UiAccount, UiDevice } from "./types";
import { parseOtpAuthUri } from "@/lib/validation/otp-uri";

interface AddAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  devices: UiDevice[];
  onAccountCreated: (account: UiAccount) => void;
}

export function AddAccountDialog({
  open,
  onOpenChange,
  devices,
  onAccountCreated,
}: AddAccountDialogProps) {
  const [accountName, setAccountName] = React.useState("");
  const [secretKey, setSecretKey] = React.useState("");
  const [keyType, setKeyType] = React.useState<"time-based">("time-based");
  const [deviceId, setDeviceId] = React.useState<string>("none");
  const [loading, setLoading] = React.useState(false);

  const resetForm = () => {
    setAccountName("");
    setSecretKey("");
    setKeyType("time-based");
    setDeviceId("none");
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetForm();
    }
    onOpenChange(newOpen);
  };

  const handleSecretChange = (value: string) => {
    const trimmed = value.trim();
    if (trimmed.startsWith("otpauth://")) {
      try {
        const parsed = parseOtpAuthUri(trimmed);
        const nameParts: string[] = [];
        if (parsed.issuer) nameParts.push(parsed.issuer);
        if (parsed.account) nameParts.push(parsed.account);
        setAccountName(
          nameParts.join(" (") + (nameParts.length > 1 ? ")" : ""),
        );
        setSecretKey(parsed.secret);
        toast.success("Parsed QR setup key from URI");
        return;
      } catch {}
    }
    setSecretKey(value);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accountName.trim()) {
      toast.error("Please enter an account name");
      return;
    }

    const cleanSecret = secretKey.replace(/\s+/g, "").toUpperCase();
    if (cleanSecret.length < 16) {
      toast.error("Secret key must be at least 16 Base32 characters");
      return;
    }

    setLoading(true);
    try {
      let issuerValue: string | undefined = undefined;
      let labelValue: string | undefined = accountName.trim();

      if (accountName.includes(":")) {
        const parts = accountName.split(":");
        issuerValue = parts[0]?.trim();
        labelValue = parts.slice(1).join(":").trim();
      } else if (accountName.includes("(") && accountName.includes(")")) {
        const match = accountName.match(/^(.*?)\s*\((.*?)\)$/);
        if (match && match[1] && match[2]) {
          issuerValue = match[1].trim();
          labelValue = match[2].trim();
        }
      }

      const payload = {
        name: accountName.trim(),
        issuer: issuerValue,
        accountLabel: labelValue,
        secret: cleanSecret,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        deviceId: deviceId === "none" ? undefined : deviceId,
      };

      const response = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await response.json();

      if (!response.ok) {
        throw new Error(json.error?.message || "Failed to create account");
      }

      const assignedDevice = devices.find((d) => d.id === deviceId);
      const newAccount: UiAccount = {
        id: json.data.id,
        name: json.data.name,
        issuer: json.data.issuer || issuerValue || null,
        account_label: json.data.account_label || labelValue || null,
        algorithm: json.data.algorithm || "SHA1",
        digits: json.data.digits || 6,
        period: json.data.period || 30,
        sort_order: json.data.sort_order ?? 0,
        enabled: true,
        created_at: new Date().toISOString(),
        device_id: deviceId === "none" ? null : deviceId,
        device_name: assignedDevice?.name || null,
        device_prefix: assignedDevice?.api_key_prefix || null,
        secret: cleanSecret,
      };

      onAccountCreated(newAccount);
      toast.success("Account added to AuthESP");
      handleOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to add account");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md bg-[#1e1f20] border-[#3c4043] rounded-3xl p-6 text-[#e3e3e3] shadow-2xl">
        <DialogHeader className="space-y-1 text-left">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-[#004a77] text-[#c2e7ff] flex items-center justify-center shrink-0">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-xl font-normal text-[#e3e3e3]">
                Enter account details
              </DialogTitle>
              <p className="text-xs text-[#8e918f]">
                Add an account using its secret setup key
              </p>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 mt-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#c4c7c5]">
              Account name
            </label>
            <input
              type="text"
              placeholder="e.g. Google (user@gmail.com) or GitHub"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              className="w-full h-12 px-4 rounded-xl bg-[#282a2c] text-[#e3e3e3] placeholder:text-[#8e918f] border border-transparent focus:border-[#8ab4f8] focus:outline-none transition-colors text-sm"
              required
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#c4c7c5]">
              Your key
            </label>
            <input
              type="text"
              placeholder="Base32 key or otpauth://totp/..."
              value={secretKey}
              onChange={(e) => handleSecretChange(e.target.value)}
              className="w-full h-12 px-4 rounded-xl bg-[#282a2c] text-[#e3e3e3] placeholder:text-[#8e918f] border border-transparent focus:border-[#8ab4f8] focus:outline-none transition-colors text-sm font-mono uppercase"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#c4c7c5]">
              Type of key
            </label>
            <select
              value={keyType}
              onChange={(e) => setKeyType(e.target.value as "time-based")}
              className="w-full h-12 px-4 rounded-xl bg-[#282a2c] text-[#e3e3e3] border border-transparent focus:border-[#8ab4f8] focus:outline-none transition-colors text-sm appearance-none cursor-pointer"
            >
              <option value="time-based">Time based (TOTP RFC 6238)</option>
            </select>
          </div>

          {devices.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#c4c7c5] flex items-center gap-1.5">
                <Cpu className="h-3.5 w-3.5 text-[#8ab4f8]" />
                Backup to ESP32 Hardware Authenticator
              </label>
              <select
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                className="w-full h-12 px-4 rounded-xl bg-[#282a2c] text-[#e3e3e3] border border-transparent focus:border-[#8ab4f8] focus:outline-none transition-colors text-sm appearance-none cursor-pointer"
              >
                <option value="none">
                  Local only (do not sync to hardware)
                </option>
                {devices
                  .filter((d) => d.active && !d.revoked_at)
                  .map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.name} ({device.api_key_prefix}...)
                    </option>
                  ))}
              </select>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-3">
            <button
              type="button"
              onClick={() => handleOpenChange(false)}
              className="h-10 px-5 rounded-full text-sm font-medium text-[#8ab4f8] hover:bg-[#8ab4f8]/10 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="h-10 px-6 rounded-full bg-[#8ab4f8] hover:bg-[#a8c7fa] text-[#041e49] text-sm font-medium transition-all shadow disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading && <ShieldCheck className="h-4 w-4 animate-spin" />}
              Add
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
