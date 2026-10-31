"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Check, Copy, Cpu, ShieldAlert, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { UiDevice } from "./types";

interface RegisterDeviceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeviceCreated: (device: UiDevice) => void;
}

export function RegisterDeviceDialog({
  open,
  onOpenChange,
  onDeviceCreated,
}: RegisterDeviceDialogProps) {
  const [name, setName] = React.useState("");
  const [identifier, setIdentifier] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [createdApiKey, setCreatedApiKey] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const resetState = () => {
    setName("");
    setIdentifier("");
    setCreatedApiKey(null);
    setCopied(false);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetState();
    }
    onOpenChange(newOpen);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !identifier.trim()) {
      toast.error("Please enter both a name and device identifier");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          deviceIdentifier: identifier.trim(),
        }),
      });

      const json = await response.json();

      if (!response.ok) {
        throw new Error(json.error?.message || "Failed to provision device");
      }

      const deviceData = json.data?.device || json.data;
      const newDevice: UiDevice = {
        id: deviceData.id,
        name: deviceData.name,
        device_identifier: deviceData.device_identifier,
        api_key_prefix: deviceData.api_key_prefix,
        active: deviceData.active ?? true,
        revoked_at: null,
        last_sync_at: null,
        last_seen_at: null,
        config_version: deviceData.config_version ?? 1,
        sync_failure_count: 0,
        last_error_code: null,
        created_at: deviceData.created_at || new Date().toISOString(),
        active_account_count: 0,
        total_account_count: 0,
      };

      setCreatedApiKey(json.data?.api_key || json.data?.apiKey);
      onDeviceCreated(newDevice);
      toast.success("ESP32 hardware authenticator paired");
    } catch (err: any) {
      toast.error(err.message || "Failed to provision ESP32 device");
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async () => {
    if (!createdApiKey) return;
    await navigator.clipboard.writeText(createdApiKey);
    setCopied(true);
    toast.success("API key copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md bg-[#1e1f20] border-[#3c4043] rounded-3xl p-6 text-[#e3e3e3] shadow-2xl">
        <DialogHeader className="space-y-1 text-left">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-[#004a77] text-[#c2e7ff] flex items-center justify-center shrink-0">
              <Cpu className="h-5 w-5 text-[#8ab4f8]" />
            </div>
            <div>
              <DialogTitle className="text-xl font-normal text-[#e3e3e3]">
                {createdApiKey ? "ESP32 Paired" : "Pair ESP32 Authenticator"}
              </DialogTitle>
              <p className="text-xs text-[#8e918f]">
                {createdApiKey
                  ? "Save your device API key securely before closing"
                  : "Register a physical microcontroller token"}
              </p>
            </div>
          </div>
        </DialogHeader>

        {createdApiKey ? (
          <div className="space-y-4 mt-3">
            <div className="rounded-2xl bg-[#282a2c] p-4 space-y-2 border border-[#3c4043]">
              <span className="text-[11px] font-medium text-[#c4c7c5]">
                One-Time Device API Key
              </span>
              <div className="flex items-center justify-between gap-2 bg-[#131314] p-3 rounded-xl border border-[#3c4043]">
                <code className="text-xs font-mono text-[#8ab4f8] break-all select-all">
                  {createdApiKey}
                </code>
                <button
                  type="button"
                  onClick={copyToClipboard}
                  className="h-8 px-3 rounded-full bg-[#282a2c] hover:bg-[#3c4043] text-xs font-medium text-[#e3e3e3] flex items-center gap-1.5 transition-colors shrink-0"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-[#81c995]" /> : <Copy className="h-3.5 w-3.5" />}
                  Copy
                </button>
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-[#3c1414]/30 border border-[#f28b82]/20 flex items-start gap-2.5 text-xs text-[#f28b82]">
              <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
              <p>
                Store this key in your ESP32 sketch now. It is hashed on the server and cannot be retrieved again.
              </p>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => handleOpenChange(false)}
                className="h-10 px-6 rounded-full bg-[#8ab4f8] hover:bg-[#a8c7fa] text-[#041e49] text-xs font-medium transition-all shadow"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 mt-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#c4c7c5]">
                Device Name
              </label>
              <input
                type="text"
                placeholder="e.g. ESP32-S3 Keychain or Desk Authenticator"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full h-12 px-4 rounded-xl bg-[#282a2c] text-[#e3e3e3] placeholder:text-[#8e918f] border border-transparent focus:border-[#8ab4f8] focus:outline-none transition-colors text-sm"
                required
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#c4c7c5]">
                Device Identifier
              </label>
              <input
                type="text"
                placeholder="e.g. esp32-desk-01 (unique identifier)"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="w-full h-12 px-4 rounded-xl bg-[#282a2c] text-[#e3e3e3] placeholder:text-[#8e918f] border border-transparent focus:border-[#8ab4f8] focus:outline-none transition-colors text-sm font-mono"
                required
              />
            </div>

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
                className="h-10 px-6 rounded-full bg-[#8ab4f8] hover:bg-[#a8c7fa] text-[#041e49] text-sm font-medium transition-all shadow disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Pairing..." : "Generate Key & Pair"}
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
