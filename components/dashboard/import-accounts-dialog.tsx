"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Upload, CheckCircle2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { UiAccount, UiDevice } from "./types";
import { parseOtpAuthUri } from "@/lib/validation/otp-uri";

interface ImportAccountsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  devices: UiDevice[];
  onAccountsImported: (accounts: UiAccount[]) => void;
}

export function ImportAccountsDialog({
  open,
  onOpenChange,
  devices,
  onAccountsImported,
}: ImportAccountsDialogProps) {
  const [urisText, setUrisText] = React.useState("");
  const [deviceId, setDeviceId] = React.useState<string>("none");
  const [loading, setLoading] = React.useState(false);

  const uris = React.useMemo(() => {
    return urisText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("otpauth://"));
  }, [urisText]);

  const resetForm = () => {
    setUrisText("");
    setDeviceId("none");
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetForm();
    }
    onOpenChange(newOpen);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (uris.length === 0) {
      toast.error("Please paste at least one valid otpauth://totp/ URI");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/accounts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uris,
          deviceId: deviceId === "none" ? undefined : deviceId,
        }),
      });

      const json = await response.json();

      if (!response.ok) {
        throw new Error(json.error?.message || "Failed to import accounts");
      }

      const assignedDevice = devices.find((d) => d.id === deviceId);
      const parsedSecrets: Record<string, string> = {};
      uris.forEach((uri) => {
        try {
          const parsed = parseOtpAuthUri(uri);
          parsedSecrets[parsed.account] = parsed.secret;
        } catch {
        }
      });

      const newAccounts: UiAccount[] = (json.data.accounts || []).map((acc: any) => ({
        id: acc.id,
        name: acc.name,
        issuer: acc.issuer || null,
        account_label: acc.account_label || null,
        algorithm: acc.algorithm as "SHA1" | "SHA256" | "SHA512",
        digits: acc.digits,
        period: acc.period,
        sort_order: acc.sort_order ?? 0,
        enabled: true,
        created_at: new Date().toISOString(),
        device_id: deviceId === "none" ? null : deviceId,
        device_name: assignedDevice?.name || null,
        device_prefix: assignedDevice?.api_key_prefix || null,
        secret: parsedSecrets[acc.account_label || acc.name] || undefined,
      }));

      onAccountsImported(newAccounts);
      toast.success(`Imported ${newAccounts.length} account(s)`);
      handleOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to import accounts");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg bg-[#1e1f20] border-[#3c4043] rounded-3xl p-6 text-[#e3e3e3] shadow-2xl">
        <DialogHeader className="space-y-1 text-left">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-[#004a77] text-[#c2e7ff] flex items-center justify-center shrink-0">
              <Upload className="h-5 w-5 text-[#8ab4f8]" />
            </div>
            <div>
              <DialogTitle className="text-xl font-normal text-[#e3e3e3]">
                Import Authenticator URIs
              </DialogTitle>
              <p className="text-xs text-[#8e918f]">
                Import standard otpauth:// URIs exported from your existing authenticator
              </p>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-[#c4c7c5]">
              <label className="font-medium">One URI per line</label>
              {uris.length > 0 && (
                <span className="text-[#81c995] inline-flex items-center gap-1 font-mono">
                  <CheckCircle2 className="h-3 w-3" />
                  {uris.length} URI{uris.length === 1 ? "" : "s"} detected
                </span>
              )}
            </div>
            <textarea
              rows={5}
              placeholder="otpauth://totp/GitHub:alice?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&#10;otpauth://totp/Google:user@gmail.com?secret=KVKFKRCPNZQUYMLX"
              value={urisText}
              onChange={(e) => setUrisText(e.target.value)}
              className="w-full p-3.5 rounded-xl bg-[#282a2c] text-[#e3e3e3] placeholder:text-[#8e918f] border border-transparent focus:border-[#8ab4f8] focus:outline-none transition-colors text-xs font-mono resize-none"
            />
          </div>

          {devices.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#c4c7c5]">
                Backup to ESP32 Hardware Authenticator
              </label>
              <select
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                className="w-full h-12 px-4 rounded-xl bg-[#282a2c] text-[#e3e3e3] border border-transparent focus:border-[#8ab4f8] focus:outline-none transition-colors text-sm appearance-none cursor-pointer"
              >
                <option value="none">Local only (do not sync to hardware)</option>
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
              disabled={loading || uris.length === 0}
              className="h-10 px-6 rounded-full bg-[#8ab4f8] hover:bg-[#a8c7fa] text-[#041e49] text-sm font-medium transition-all shadow disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading && <ShieldCheck className="h-4 w-4 animate-spin" />}
              {loading ? "Importing..." : `Import ${uris.length > 0 ? uris.length : ""} Account${uris.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
