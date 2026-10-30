"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, Check, Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { UiDevice } from "./types";

interface RotateKeyDialogProps {
  device: UiDevice | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onKeyRotated: (deviceId: string, newPrefix: string) => void;
}

export function RotateKeyDialog({
  device,
  open,
  onOpenChange,
  onKeyRotated,
}: RotateKeyDialogProps) {
  const [confirmation, setConfirmation] = React.useState("");
  const [newKey, setNewKey] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const resetState = () => {
    setConfirmation("");
    setNewKey(null);
    setCopied(false);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetState();
    }
    onOpenChange(newOpen);
  };

  const handleRotate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!device) return;
    if (confirmation !== "ROTATE") {
      toast.error("Type ROTATE to confirm key rotation");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/devices/${device.id}/rotate-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "ROTATE" }),
      });

      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error?.message || "Failed to rotate key");
      }

      const generatedKey = json.data.apiKey || json.data.api_key;
      const generatedPrefix = json.data.apiKeyPrefix || json.data.api_key_prefix;
      setNewKey(generatedKey);
      onKeyRotated(device.id, generatedPrefix);
      toast.success("API key rotated successfully");
    } catch (err: any) {
      toast.error(err.message || "Failed to rotate device API key");
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async () => {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey);
    setCopied(true);
    toast.success("New API key copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md bg-[#1e1f20] border-[#3c4043] rounded-3xl p-6 text-[#e3e3e3] shadow-2xl">
        <DialogHeader className="space-y-1 text-left">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-[#3c2a10] text-[#fdd663] flex items-center justify-center shrink-0">
              <RefreshCw className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-xl font-normal text-[#e3e3e3]">
                Rotate Device API Key
              </DialogTitle>
              <p className="text-xs text-[#8e918f]">
                {device?.name} ({device?.api_key_prefix}...)
              </p>
            </div>
          </div>
        </DialogHeader>

        {newKey ? (
          <div className="space-y-4 mt-3">
            <div className="rounded-2xl bg-[#282a2c] p-4 space-y-2 border border-[#3c4043]">
              <span className="text-[11px] font-medium text-[#c4c7c5]">
                New Device API Key
              </span>
              <div className="flex items-center justify-between gap-2 bg-[#131314] p-3 rounded-xl border border-[#3c4043]">
                <code className="text-xs font-mono text-[#8ab4f8] break-all select-all">
                  {newKey}
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

            <div className="p-3.5 rounded-2xl bg-[#3c2a10]/40 border border-[#fdd663]/20 flex items-start gap-2.5 text-xs text-[#fdd663]">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <p>
                Update your ESP32 device firmware sketch with this new key. The previous key has been immediately revoked.
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
          <form onSubmit={handleRotate} className="space-y-4 mt-3">
            <div className="p-3.5 rounded-2xl bg-[#3c1414]/30 border border-[#f28b82]/20 flex items-start gap-2.5 text-xs text-[#f28b82]">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <p>
                Rotating this key will immediately invalidate the existing key. Any ESP32 hardware using the old key will fail to sync until re-flashed.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#c4c7c5]">
                Type ROTATE to confirm
              </label>
              <input
                type="text"
                placeholder="ROTATE"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                className="w-full h-12 px-4 rounded-xl bg-[#282a2c] text-[#e3e3e3] placeholder:text-[#8e918f] border border-transparent focus:border-[#8ab4f8] focus:outline-none transition-colors text-sm font-mono uppercase"
                required
                autoFocus
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
                disabled={loading || confirmation !== "ROTATE"}
                className="h-10 px-6 rounded-full bg-[#f28b82] hover:bg-[#f6aea9] text-[#041e49] text-sm font-medium transition-all shadow disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Rotating..." : "Rotate Key Now"}
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
