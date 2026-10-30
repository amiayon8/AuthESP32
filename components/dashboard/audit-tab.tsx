"use client";

import * as React from "react";
import { Shield, Search, CheckCircle2, XCircle, Clock, Globe } from "lucide-react";
import { UiAuditLog } from "./types";

interface AuditTabProps {
  auditLogs: UiAuditLog[];
}

export function AuditTab({ auditLogs }: AuditTabProps) {
  const [search, setSearch] = React.useState("");
  const [resultFilter, setResultFilter] = React.useState<string>("all");

  const filtered = auditLogs.filter((log) => {
    const q = search.toLowerCase();
    const matchesSearch =
      log.action.toLowerCase().includes(q) ||
      (log.ip_address && log.ip_address.toLowerCase().includes(q)) ||
      (log.user_agent && log.user_agent.toLowerCase().includes(q));

    const matchesResult =
      resultFilter === "all" || log.result === resultFilter;

    return matchesSearch && matchesResult;
  });

  return (
    <div className="w-full max-w-2xl mx-auto space-y-4 pb-20">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1">
        <div>
          <h2 className="text-xl font-normal text-[#e3e3e3] tracking-tight">
            Security Activity
          </h2>
          <p className="text-xs text-[#8e918f] mt-0.5">
            Audit history of hardware synchronization and credential changes.
          </p>
        </div>

        <span className="font-mono text-xs text-[#8e918f] px-3 py-1 rounded-full bg-[#1e1f20] self-start sm:self-auto">
          {auditLogs.length} events
        </span>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-3 h-4 w-4 text-[#8e918f]" />
          <input
            placeholder="Search activity by action or IP..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 pl-10 pr-4 rounded-full bg-[#1e1f20] text-xs text-[#e3e3e3] placeholder:text-[#8e918f] border border-transparent focus:border-[#8ab4f8] focus:outline-none transition-colors"
          />
        </div>

        <div className="flex items-center gap-1 bg-[#1e1f20] p-1 rounded-full shrink-0">
          <button
            type="button"
            onClick={() => setResultFilter("all")}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
              resultFilter === "all"
                ? "bg-[#004a77] text-[#c2e7ff]"
                : "text-[#8e918f] hover:text-[#e3e3e3]"
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setResultFilter("success")}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
              resultFilter === "success"
                ? "bg-[#143220] text-[#81c995]"
                : "text-[#8e918f] hover:text-[#e3e3e3]"
            }`}
          >
            Success
          </button>
          <button
            type="button"
            onClick={() => setResultFilter("failure")}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
              resultFilter === "failure"
                ? "bg-[#3c1414] text-[#f28b82]"
                : "text-[#8e918f] hover:text-[#e3e3e3]"
            }`}
          >
            Failed
          </button>
        </div>
      </div>

      {auditLogs.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center px-4 py-16 rounded-3xl bg-[#1e1f20]/40 border border-[#282a2c]">
          <div className="h-16 w-16 rounded-full bg-[#1e1f20] border border-white/5 flex items-center justify-center mb-3 text-[#8ab4f8]">
            <Shield className="h-8 w-8 stroke-[1.5]" />
          </div>
          <h3 className="text-base font-normal text-[#e3e3e3]">
            No security events yet
          </h3>
          <p className="text-xs text-[#8e918f] max-w-xs mx-auto mt-1 leading-relaxed">
            When hardware devices sync or accounts are added, events will be recorded here.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl bg-[#1e1f20]/60 border border-[#282a2c] py-12 text-center px-4">
          <p className="text-xs text-[#8e918f]">
            No events match your filter criteria.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((log) => {
            const isSuccess = log.result === "success";
            return (
              <div
                key={log.id}
                className="rounded-2xl bg-[#1e1f20] border border-[#282a2c] p-4 flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${
                      isSuccess
                        ? "bg-[#143220] text-[#81c995]"
                        : "bg-[#3c1414] text-[#f28b82]"
                    }`}
                  >
                    {isSuccess ? (
                      <CheckCircle2 className="h-5 w-5" />
                    ) : (
                      <XCircle className="h-5 w-5" />
                    )}
                  </div>

                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#e3e3e3] truncate">
                      {log.action.replace(/_/g, " ").toUpperCase()}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-[#8e918f] font-mono mt-0.5">
                      {log.ip_address && <span>{log.ip_address}</span>}
                      {log.user_agent && (
                        <span className="truncate max-w-[150px]">
                          {log.user_agent}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className="text-xs font-mono text-[#8e918f] block">
                    {new Date(log.created_at).toLocaleTimeString()}
                  </span>
                  <span className="text-[11px] text-[#8e918f] block">
                    {new Date(log.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
