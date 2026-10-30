"use client";

import * as React from "react";
import {
  Cpu,
  Plus,
  RefreshCw,
  Trash2,
  Search,
  Radio,
  Clock,
  Key,
  Smartphone,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { UiDevice } from "./types";
import { RotateKeyDialog } from "./rotate-key-dialog";

interface DevicesTabProps {
  devices: UiDevice[];
  onOpenRegister: () => void;
  onDeviceUpdated: (device: UiDevice) => void;
  onDeviceDeleted: (deviceId: string) => void;
}

export function DevicesTab({
  devices,
  onOpenRegister,
  onDeviceUpdated,
  onDeviceDeleted,
}: DevicesTabProps) {
  const [search, setSearch] = React.useState("");
  const [deviceToRotate, setDeviceToRotate] = React.useState<UiDevice | null>(null);
  const [rotateOpen, setRotateOpen] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  const filtered = devices.filter((device) => {
    const q = search.toLowerCase();
    return (
      device.name.toLowerCase().includes(q) ||
      device.device_identifier.toLowerCase().includes(q) ||
      device.api_key_prefix.toLowerCase().includes(q)
    );
  });

  const handleDelete = async (device: UiDevice) => {
    if (!window.confirm(`Are you sure you want to delete "${device.name}"? Hardware with this key will stop authenticating.`)) {
      return;
    }

    setDeletingId(device.id);
    try {
      const response = await fetch(`/api/devices/${device.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        const json = await response.json();
        throw new Error(json.error?.message || "Failed to delete device");
      }

      onDeviceDeleted(device.id);
      toast.success("ESP32 hardware authenticator deleted");
    } catch (err: any) {
      toast.error(err.message || "Failed to delete device");
    } finally {
      setDeletingId(null);
    }
  };

  const handleKeyRotated = (deviceId: string, newPrefix: string) => {
    const current = devices.find((d) => d.id === deviceId);
    if (current) {
      onDeviceUpdated({
        ...current,
        api_key_prefix: newPrefix,
        config_version: current.config_version + 1,
      });
    }
    toast.success("API key rotated. Update your ESP32 firmware with the new key.");
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-4 pb-20">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1">
        <div>
          <h2 className="text-xl font-normal text-[#e3e3e3] tracking-tight">
            ESP32 Authenticators
          </h2>
          <p className="text-xs text-[#8e918f] mt-0.5">
            Physical hardware tokens that sync verification codes over local Wi-Fi.
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenRegister}
          className="h-10 px-5 rounded-full bg-[#8ab4f8] hover:bg-[#a8c7fa] text-[#041e49] text-xs font-medium transition-all shadow flex items-center justify-center gap-2 shrink-0 self-start sm:self-auto"
        >
          <Plus className="h-4 w-4 stroke-[2.5]" />
          Pair New ESP32
        </button>
      </div>

      {devices.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3.5 top-3 h-4 w-4 text-[#8e918f]" />
          <input
            type="text"
            placeholder="Search paired hardware devices"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 pl-10 pr-4 rounded-full bg-[#1e1f20] text-xs text-[#e3e3e3] placeholder:text-[#8e918f] border border-transparent focus:border-[#8ab4f8] focus:outline-none transition-colors"
          />
        </div>
      )}

      {devices.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center px-4 py-16 rounded-3xl bg-[#1e1f20]/40 border border-[#282a2c]">
          <div className="h-20 w-20 rounded-full bg-[#1e1f20] border border-white/5 flex items-center justify-center mb-4 text-[#8ab4f8]">
            <Cpu className="h-10 w-10 stroke-[1.5]" />
          </div>
          <h3 className="text-lg font-normal text-[#e3e3e3]">
            No ESP32 authenticators paired
          </h3>
          <p className="text-xs text-[#8e918f] max-w-sm mx-auto mt-1.5 leading-relaxed">
            Pair an ESP32 hardware device (ESP32-S3, C3, or classic) to use as a dedicated physical authenticator whenever your phone or computer is unavailable.
          </p>
          <button
            type="button"
            onClick={onOpenRegister}
            className="mt-6 h-10 px-6 rounded-full bg-[#8ab4f8] hover:bg-[#a8c7fa] text-[#041e49] text-xs font-medium transition-all shadow flex items-center gap-2"
          >
            <Plus className="h-4 w-4 stroke-[2.5]" />
            Pair your first device
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl bg-[#1e1f20]/60 border border-[#282a2c] py-12 text-center px-4">
          <p className="text-xs text-[#8e918f]">
            No devices matched your search query.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((device) => {
            const isActive = device.active && !device.revoked_at;
            return (
              <div
                key={device.id}
                className="rounded-3xl bg-[#1e1f20] border border-[#282a2c] p-5 space-y-4 hover:border-[#3c4043] transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="h-11 w-11 rounded-2xl bg-[#004a77] text-[#c2e7ff] flex items-center justify-center shrink-0">
                      <Cpu className="h-6 w-6 text-[#8ab4f8]" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-base font-medium text-[#e3e3e3] truncate">
                        {device.name}
                      </h4>
                      <p className="text-xs font-mono text-[#8e918f] truncate mt-0.5">
                        ID: {device.device_identifier}
                      </p>
                    </div>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium shrink-0 ${
                      isActive
                        ? "bg-[#143220] text-[#81c995] border border-[#81c995]/30"
                        : "bg-[#3c1414] text-[#f28b82] border border-[#f28b82]/30"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        isActive ? "bg-[#81c995] animate-pulse" : "bg-[#f28b82]"
                      }`}
                    />
                    {isActive ? "Active" : "Revoked"}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-2xl bg-[#282a2c] p-3 space-y-1">
                    <span className="text-[11px] text-[#8e918f] flex items-center gap-1.5">
                      <Key className="h-3 w-3" />
                      Key Prefix
                    </span>
                    <p className="font-mono font-medium text-[#e3e3e3] truncate">
                      {device.api_key_prefix}...
                    </p>
                  </div>

                  <div className="rounded-2xl bg-[#282a2c] p-3 space-y-1">
                    <span className="text-[11px] text-[#8e918f] flex items-center gap-1.5">
                      <Smartphone className="h-3 w-3" />
                      Synced Accounts
                    </span>
                    <p className="font-medium text-[#e3e3e3]">
                      {device.active_account_count ?? 0} active
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-[#8e918f] px-1">
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    Last sync: {device.last_sync_at ? new Date(device.last_sync_at).toLocaleTimeString() : "Never"}
                  </span>
                  <span className="font-mono text-[11px]">
                    Config v{device.config_version}
                  </span>
                </div>

                <div className="pt-2 flex items-center justify-end gap-2 border-t border-[#282a2c]">
                  <button
                    type="button"
                    onClick={() => {
                      setDeviceToRotate(device);
                      setRotateOpen(true);
                    }}
                    className="h-9 px-4 rounded-full text-xs font-medium text-[#8ab4f8] hover:bg-[#8ab4f8]/10 transition-colors flex items-center gap-1.5"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Rotate Key
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDelete(device)}
                    disabled={deletingId === device.id}
                    className="h-9 px-4 rounded-full text-xs font-medium text-[#f28b82] hover:bg-[#f28b82]/10 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <RotateKeyDialog
        device={deviceToRotate}
        open={rotateOpen}
        onOpenChange={setRotateOpen}
        onKeyRotated={handleKeyRotated}
      />
    </div>
  );
}
