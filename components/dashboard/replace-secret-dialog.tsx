"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { KeyRound, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { UiAccount } from "./types";

interface ReplaceSecretDialogProps {
  account: UiAccount | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ReplaceSecretDialog({
  account,
  open,
  onOpenChange,
}: ReplaceSecretDialogProps) {
  const [newSecret, setNewSecret] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const resetState = () => {
    setNewSecret("");
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetState();
    }
    onOpenChange(newOpen);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!account) return;

    const clean = newSecret.replace(/\s+/g, "").toUpperCase();
    if (clean.length < 16) {
      toast.error("Secret key must be at least 16 Base32 characters");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/accounts/${account.id}/replace-secret`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: clean }),
      });

      const json = await response.json();

      if (!response.ok) {
        throw new Error(json.error?.message || "Failed to update secret");
      }

      account.secret = clean;
      toast.success("Secret key updated and re-encrypted");
      handleOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to update secret key");
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
              <KeyRound className="h-5 w-5 text-[#8ab4f8]" />
            </div>
            <div>
              <DialogTitle className="text-xl font-normal text-[#e3e3e3]">
                Replace Secret Key
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
              New Base32 Secret Key
            </label>
            <input
              type="text"
              placeholder="e.g. JBSWY3DPEHPK3PXP"
              value={newSecret}
              onChange={(e) => setNewSecret(e.target.value)}
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
              disabled={loading}
              className="h-10 px-6 rounded-full bg-[#8ab4f8] hover:bg-[#a8c7fa] text-[#041e49] text-sm font-medium transition-all shadow disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading && <ShieldCheck className="h-4 w-4 animate-spin" />}
              Update Key
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
