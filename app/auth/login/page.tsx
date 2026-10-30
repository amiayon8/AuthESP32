"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Shield, Lock, ArrowRight, KeyRound } from "lucide-react";
import { toast } from "sonner";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email || !password) {
      toast.error("Please enter email and password");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.error?.message || "Invalid credentials");
      }

      toast.success("Signed in successfully");
      router.push("/");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#131314] text-[#e3e3e3] flex flex-col justify-center items-center px-4 py-12 selection:bg-[#8ab4f8]/30 selection:text-[#8ab4f8]">
      <div className="w-full max-w-[440px] rounded-3xl bg-[#1e1f20] border border-[#3c4043] p-8 sm:p-10 shadow-2xl space-y-6">
        <div className="space-y-3">
          <div className="h-12 w-12 rounded-2xl bg-[#004a77] text-[#c2e7ff] flex items-center justify-center shadow">
            <Shield className="h-6 w-6 text-[#8ab4f8]" />
          </div>

          <div>
            <h1 className="text-2xl font-normal text-[#e3e3e3] tracking-tight">
              Sign in
            </h1>
            <p className="text-sm text-[#8e918f] mt-1">
              to continue to Google Authenticator
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#c4c7c5]">
              Email or phone
            </label>
            <input
              type="email"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-13 px-4 rounded-xl bg-[#282a2c] text-[#e3e3e3] placeholder:text-[#8e918f] border border-transparent focus:border-[#8ab4f8] focus:outline-none transition-colors text-sm"
              required
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#c4c7c5]">
              Password
            </label>
            <input
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-13 px-4 rounded-xl bg-[#282a2c] text-[#e3e3e3] placeholder:text-[#8e918f] border border-transparent focus:border-[#8ab4f8] focus:outline-none transition-colors text-sm"
              required
            />
          </div>

          <div className="flex items-center justify-between pt-4">
            <span className="text-xs text-[#8e918f]">
              Protected with ESP32 backup
            </span>

            <button
              type="submit"
              disabled={loading}
              className="h-11 px-8 rounded-full bg-[#8ab4f8] hover:bg-[#a8c7fa] text-[#041e49] font-medium text-sm transition-all shadow disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading ? "Signing in..." : "Sign in"}
              {!loading && <ArrowRight className="h-4 w-4" />}
            </button>
          </div>
        </form>
      </div>

      <div className="mt-8 flex items-center gap-6 text-xs text-[#8e918f]">
        <span>Google Authenticator</span>
        <span>ESP32 Hardware Sync</span>
        <span>RFC 6238 Standard</span>
      </div>
    </div>
  );
}
