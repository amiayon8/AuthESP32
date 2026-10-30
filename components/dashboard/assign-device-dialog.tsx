"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Cpu, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { UiAccount, UiDevice } from "./types";

interface AssignDeviceDialogProps {
  account: UiAccount | null;
  devices: UiDevice[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccountUpdated: (account: UiAccount) => void;
}

export function AssignDeviceDialog({
  account,
  devices,
  open,
  onOpenChange,
  onAccountUpdated,
}: AssignDeviceDialogProps) {
  const [selectedDeviceId, setSelectedDeviceId] = React.useState<string>("none");
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (account) {
      setSelectedDeviceId(account.device_id || "none");
    }
  }, [account]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!account) return;

    setLoading(true);
    const targetDeviceId = selectedDeviceId === "none" ? null : selectedDeviceId;
    const assignedDevice = devices.find((d) => d.id === targetDeviceId);

    try {
      const response = await fetch(`/api/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: targetDeviceId,
        }),
      });

      const json = await response.json();

      if (!response.ok) {
        throw new Error(json.error?.message || "Failed to update device assignment");
      }

      const updated: UiAccount = {
        ...account,
        device_id: targetDeviceId,
        device_name: assignedDevice?.name || null,
        device_prefix: assignedDevice?.api_key_prefix || null,
      };

      onAccountUpdated(updated);
      toast.success(
        targetDeviceId
          ? `Assigned to ${assignedDevice?.name}. Codes will sync to this ESP32.`
          : "Account set to local phone/browser only"
      );
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to assign device");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-[#1e1f20] border-[#3c4043] rounded-3xl p-6 text-[#e3e3e3] shadow-2xl">
        <DialogHeader className="space-y-1 text-left">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-[#004a77] text-[#c2e7ff] flex items-center justify-center shrink-0">
              <Cpu className="h-5 w-5 text-[#8ab4f8]" />
            </div>
            <div>
              <DialogTitle className="text-xl font-normal text-[#e3e3e3]">
                ESP32 Hardware Sync
              </DialogTitle>
              <p className="text-xs text-[#8e918f]">
                {account?.name}
              </p>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#c4c7c5]">
              Target Hardware Authenticator
            </label>
            <select
              value={selectedDeviceId}
              onChange={(e) => setSelectedDeviceId(e.target.value)}
              className="w-full h-12 px-4 rounded-xl bg-[#282a2c] text-[#e3e3e3] border border-transparent focus:border-[#8ab4f8] focus:outline-none transition-colors text-sm appearance-none cursor-pointer"
            >
              <option value="none">Local only (No hardware sync)</option>
              {devices
                .filter((d) => d.active && !d.revoked_at)
                .map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.name} ({device.api_key_prefix}...)
                  </option>
                ))}
            </select>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
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
              Save Assignment
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
