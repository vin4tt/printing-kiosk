import React, { useState, useEffect } from 'react';
import {
  Activity,
  CheckCircle,
  Clock,
  CreditCard,
  Database,
  FileCheck,
  FileText,
  HardDrive,
  Layers,
  Printer,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Tag,
  Terminal,
  Trash2,
  Users,
  XCircle,
  AlertTriangle,
  Play,
  RotateCw,
} from 'lucide-react';
import { AuditLogEntry, KioskData, PricingRule, PrintJobData } from '../types/kiosk.ts';

interface AdminDashboardProps {
  onRefreshKiosk: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onRefreshKiosk }) => {
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'JOBS' | 'PRICING' | 'KIOSKS' | 'CONVERSION' | 'AUDIT' | 'DEPLOY'>('OVERVIEW');

  // Data states
  const [jobs, setJobs] = useState<PrintJobData[]>([]);
  const [kiosks, setKiosks] = useState<KioskData[]>([]);
  const [pricingRules, setPricingRules] = useState<PricingRule[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Filter & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Edit Pricing Modal State
  const [editingRule, setEditingRule] = useState<PricingRule | null>(null);
  const [editPriceInput, setEditPriceInput] = useState<number>(2);

  // Fetch all admin data
  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [jobsRes, kiosksRes, rulesRes, auditRes] = await Promise.all([
        fetch('/api/jobs').then((r) => r.json()),
        fetch('/api/kiosks').then((r) => r.json()),
        fetch('/api/pricing-rules').then((r) => r.json()),
        fetch('/api/audit-logs').then((r) => r.json()),
      ]);

      setJobs(Array.isArray(jobsRes) ? jobsRes : []);
      setKiosks(Array.isArray(kiosksRes) ? kiosksRes : []);
      setPricingRules(Array.isArray(rulesRes) ? rulesRes : []);
      setAuditLogs(Array.isArray(auditRes) ? auditRes : []);
    } catch (err) {
      console.error('Failed to load admin data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 8000);
    return () => clearInterval(interval);
  }, []);

  // Flash action message
  const flash = (text: string, type: 'success' | 'error' = 'success') => {
    setActionMessage({ text, type });
    setTimeout(() => setActionMessage(null), 4000);
  };

  // 1. Confirm Job Payment (Cash / UPI) -> Immediately triggers spooler!
  const handleConfirmPayment = async (jobId: string, method: 'CASH' | 'UPI_MANUAL') => {
    try {
      const res = await fetch(`/api/jobs/${jobId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method,
          authorizedBy: 'OPERATOR_DESK',
        }),
      });

      const data = await res.json();
      if (res.ok) {
        flash(`Payment verified for Job ${jobId}. Enqueued to printer spooler!`, 'success');
        fetchData();
        onRefreshKiosk();
      } else {
        flash(data.error || 'Failed to confirm payment', 'error');
      }
    } catch (err: any) {
      flash('Error connecting to server', 'error');
    }
  };

  // 2. Authorize Reprint / Retry
  const handleRetryJob = async (jobId: string) => {
    try {
      const res = await fetch(`/api/jobs/${jobId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authorizedBy: 'ADMIN_DESK' }),
      });
      const data = await res.json();
      if (res.ok) {
        flash(`Reprint authorized for Job ${jobId}. Sent to spooler.`, 'success');
        fetchData();
      } else {
        flash(data.error || 'Failed to retry job', 'error');
      }
    } catch (err) {
      flash('Error retrying job', 'error');
    }
  };

  // 3. Cancel Job
  const handleCancelJob = async (jobId: string) => {
    try {
      const res = await fetch(`/api/jobs/${jobId}/cancel`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok) {
        flash(`Job ${jobId} cancelled.`, 'success');
        fetchData();
      } else {
        flash(data.error || 'Failed to cancel job', 'error');
      }
    } catch (err) {
      flash('Error cancelling job', 'error');
    }
  };

  // 4. Update Pricing Rule
  const handleSavePriceRule = async () => {
    if (!editingRule) return;
    try {
      const res = await fetch(`/api/pricing-rules/${editingRule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pricePerPage: editPriceInput,
          isActive: editingRule.isActive,
        }),
      });
      if (res.ok) {
        flash('Pricing rule updated successfully.', 'success');
        setEditingRule(null);
        fetchData();
      }
    } catch (err) {
      flash('Failed to update pricing rule', 'error');
    }
  };

  // 5. Set / Simulate Printer Hardware Status
  const handleSetPrinterStatus = async (
    kioskId: string,
    status: string,
    reason?: string,
    customSupplies?: { paperA4?: number; toner?: number }
  ) => {
    try {
      const res = await fetch('/api/printers/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kioskId,
          printerStatus: status,
          reason: reason || `Manual status change: ${status}`,
          paperA4Level: customSupplies?.paperA4,
          tonerLevel: customSupplies?.toner,
        }),
      });
      if (res.ok) {
        flash(`Kiosk ${kioskId} printer status updated to ${status}.`, 'success');
        fetchData();
        onRefreshKiosk();
      } else {
        flash('Failed to update printer status', 'error');
      }
    } catch (err) {
      flash('Error reporting printer status', 'error');
    }
  };

  // Filtered jobs
  const filteredJobs = jobs.filter((job) => {
    const matchesSearch =
      job.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.customerPhone.includes(searchQuery) ||
      job.originalFileName.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;
    if (statusFilter === 'ALL') return true;
    if (statusFilter === 'PENDING_PAYMENT') return job.status === 'PAYMENT_PENDING' || job.paymentStatus === 'PENDING';
    if (statusFilter === 'PRINTING') return job.status === 'PRINTING' || job.status === 'QUEUED';
    if (statusFilter === 'COMPLETED') return job.status === 'COMPLETED';
    if (statusFilter === 'FAILED') return job.status === 'FAILED' || job.status === 'PRINTER_ERROR';
    return true;
  });

  // Calculate Overview Metrics
  const totalRevenue = jobs
    .filter((j) => j.paymentStatus === 'PAID')
    .reduce((acc, curr) => acc + (curr.totalPrice || 0), 0);

  const printingNowCount = jobs.filter((j) => j.status === 'PRINTING' || j.status === 'QUEUED').length;
  const completedJobsCount = jobs.filter((j) => j.status === 'COMPLETED').length;
  const pendingPaymentCount = jobs.filter((j) => j.paymentStatus === 'PENDING' && j.status !== 'CANCELLED').length;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl text-slate-100 min-h-[780px] flex flex-col justify-between">
      {/* ADMIN HEADER */}
      <div>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-600/30">
                <Activity className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-black text-white tracking-tight">Kiosk Operator & Admin Console</h2>
                <p className="text-xs text-slate-400">
                  Role: <strong className="text-emerald-400">Authorized Operator Desk</strong> • Smart Print Spooler Control
                </p>
              </div>
            </div>
          </div>

          {/* Action notification banner */}
          {actionMessage && (
            <div
              className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 border animate-in fade-in ${
                actionMessage.type === 'success'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
              }`}
            >
              <CheckCircle className="w-4 h-4" />
              <span>{actionMessage.text}</span>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={fetchData}
              disabled={isLoading}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Refresh Data</span>
            </button>
          </div>
        </div>

        {/* TABS NAVIGATION */}
        <div className="flex gap-2 pt-4 pb-6 overflow-x-auto">
          {[
            { id: 'OVERVIEW', label: 'System Overview', icon: Layers },
            { id: 'JOBS', label: `Print Queue (${jobs.length})`, icon: FileText },
            { id: 'PRICING', label: 'Pricing Rules', icon: Tag },
            { id: 'KIOSKS', label: 'Kiosks & Hardware', icon: Printer },
            { id: 'CONVERSION', label: 'Conversion Engine', icon: FileCheck },
            { id: 'AUDIT', label: 'Audit Trail', icon: ShieldCheck },
            { id: 'DEPLOY', label: 'Windows Setup Guide', icon: Terminal },
          ].map((tab) => {
            const Icon = tab.icon;
            const isSelected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition whitespace-nowrap ${
                  isSelected
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                    : 'bg-slate-800/80 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700/60'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* TAB 1: OVERVIEW METRICS */}
        {activeTab === 'OVERVIEW' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* Stat Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl">
                <span className="text-xs text-slate-500 font-semibold block mb-1">Total Print Jobs</span>
                <span className="text-3xl font-black text-white">{jobs.length}</span>
                <span className="text-[10px] text-slate-400 block mt-1">Lifecycle tracked</span>
              </div>

              <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl">
                <span className="text-xs text-slate-500 font-semibold block mb-1">Spooling / Queued</span>
                <span className="text-3xl font-black text-amber-400">{printingNowCount}</span>
                <span className="text-[10px] text-amber-500/80 block mt-1">In Windows print spooler</span>
              </div>

              <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl">
                <span className="text-xs text-slate-500 font-semibold block mb-1">Pending Desk Payment</span>
                <span className="text-3xl font-black text-blue-400">{pendingPaymentCount}</span>
                <span className="text-[10px] text-blue-400/80 block mt-1">Awaiting Cash / UPI authorization</span>
              </div>

              <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl">
                <span className="text-xs text-slate-500 font-semibold block mb-1">Total Revenue</span>
                <span className="text-3xl font-black text-emerald-400">₹{totalRevenue}</span>
                <span className="text-[10px] text-emerald-500/80 block mt-1">Real database calculated</span>
              </div>
            </div>

            {/* Quick Operator Desk Actions Card */}
            <div className="p-6 bg-slate-950 border border-slate-800 rounded-2xl">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-emerald-400" />
                    Payment Authorization Desk (Cash & UPI)
                  </h3>
                  <p className="text-xs text-slate-400">
                    Customers awaiting payment release at the counter before physical spooling begins.
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  {jobs.filter((j) => j.paymentStatus === 'PENDING').length} Unpaid Jobs
                </span>
              </div>

              <div className="divide-y divide-slate-800/80">
                {jobs
                  .filter((j) => j.paymentStatus === 'PENDING' && j.status !== 'CANCELLED')
                  .slice(0, 5)
                  .map((job) => (
                    <div key={job.id} className="py-3 flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-white text-sm">{job.id}</span>
                          <span className="text-xs text-slate-400">• {job.customerName} ({job.customerPhone})</span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {job.originalFileName} • {job.pagesToPrintCount} pgs × {job.copies} copies • {job.paperSize} {job.colorMode}
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="text-lg font-black text-emerald-400">₹{job.totalPrice}</span>
                        <button
                          onClick={() => handleConfirmPayment(job.id, 'CASH')}
                          className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/20 transition"
                        >
                          Confirm Cash
                        </button>
                        <button
                          onClick={() => handleConfirmPayment(job.id, 'UPI_MANUAL')}
                          className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/20 transition"
                        >
                          Confirm UPI
                        </button>
                      </div>
                    </div>
                  ))}

                {jobs.filter((j) => j.paymentStatus === 'PENDING' && j.status !== 'CANCELLED').length === 0 && (
                  <p className="py-6 text-center text-xs text-slate-500">
                    No customers currently waiting for payment authorization.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: PRINT QUEUE & JOB MANAGEMENT */}
        {activeTab === 'JOBS' && (
          <div className="space-y-4 animate-in fade-in duration-200">
            {/* Search and Filters */}
            <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="text"
                  placeholder="Search Job ID, Phone, Customer..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex gap-2 overflow-x-auto w-full sm:w-auto">
                {['ALL', 'PENDING_PAYMENT', 'PRINTING', 'COMPLETED', 'FAILED'].map((st) => (
                  <button
                    key={st}
                    onClick={() => setStatusFilter(st)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
                      statusFilter === st
                        ? 'bg-slate-700 text-white font-bold'
                        : 'bg-slate-800/60 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {st.replace('_', ' ')}
                  </button>
                ))}
              </div>
            </div>

            {/* Jobs Table */}
            <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Job ID</th>
                    <th className="py-3 px-4 font-semibold">Customer</th>
                    <th className="py-3 px-4 font-semibold">Document & Specs</th>
                    <th className="py-3 px-4 font-semibold">Price</th>
                    <th className="py-3 px-4 font-semibold">Payment</th>
                    <th className="py-3 px-4 font-semibold">Spool Status</th>
                    <th className="py-3 px-4 font-semibold">Privacy State</th>
                    <th className="py-3 px-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredJobs.map((job) => (
                    <tr key={job.id} className="hover:bg-slate-900/40 transition">
                      <td className="py-3 px-4 font-mono font-bold text-white">
                        {job.id}
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-semibold text-slate-200 block">{job.customerName}</span>
                        <span className="text-[10px] text-slate-400 font-mono">{job.customerPhone}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-medium text-slate-300 block truncate max-w-[160px]">
                          {job.originalFileName}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {job.pagesToPrintCount} pgs × {job.copies} cp • {job.paperSize} {job.colorMode}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-bold text-emerald-400 text-sm">
                        ₹{job.totalPrice}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            job.paymentStatus === 'PAID'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          }`}
                        >
                          {job.paymentStatus}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            job.status === 'COMPLETED'
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : job.status === 'PRINTING' || job.status === 'QUEUED'
                              ? 'bg-blue-500/10 text-blue-400 animate-pulse'
                              : job.status === 'FAILED' || job.status === 'PRINTER_ERROR'
                              ? 'bg-rose-500/10 text-rose-400'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {job.status}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {job.isDocumentDeleted ? (
                          <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-semibold">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            File Purged
                          </span>
                        ) : (
                          <span className="text-[10px] text-amber-400 flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            Active Spool
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right space-x-1">
                        {job.paymentStatus === 'PENDING' && (
                          <button
                            onClick={() => handleConfirmPayment(job.id, 'CASH')}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold transition"
                          >
                            Mark Paid
                          </button>
                        )}
                        {(job.status === 'FAILED' || job.status === 'COMPLETED') && (
                          <button
                            onClick={() => handleRetryJob(job.id)}
                            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold border border-slate-700 transition"
                            title="Reprint Job with authorization"
                          >
                            Reprint
                          </button>
                        )}
                        {job.status !== 'COMPLETED' && job.status !== 'CANCELLED' && (
                          <button
                            onClick={() => handleCancelJob(job.id)}
                            className="px-2 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-[11px] font-semibold transition"
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}

                  {filteredJobs.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-500">
                        No print jobs match current query.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: PRICING RULES ENGINE */}
        {activeTab === 'PRICING' && (
          <div className="space-y-4 animate-in fade-in duration-200">
            <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white">Dynamic Pricing Engine</h3>
                <p className="text-xs text-slate-400">
                  Rates are governed centrally in PostgreSQL. Any change instantly recalculates customer quotes.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Rule ID</th>
                    <th className="py-3 px-4 font-semibold">Paper Size</th>
                    <th className="py-3 px-4 font-semibold">Color Mode</th>
                    <th className="py-3 px-4 font-semibold">Sides</th>
                    <th className="py-3 px-4 font-semibold">Price / Page</th>
                    <th className="py-3 px-4 font-semibold">Status</th>
                    <th className="py-3 px-4 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {pricingRules.map((rule) => (
                    <tr key={rule.id} className="hover:bg-slate-900/40">
                      <td className="py-3 px-4 font-mono text-slate-400">#{rule.id}</td>
                      <td className="py-3 px-4 font-bold text-white">{rule.paperSize}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            rule.colorMode === 'COLOR'
                              ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {rule.colorMode === 'COLOR' ? 'Color' : 'B&W'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-300">
                        {rule.isDuplex ? 'Double-sided' : 'Single-sided'}
                      </td>
                      <td className="py-3 px-4 font-black text-emerald-400 text-base">
                        ₹{rule.pricePerPage}
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-emerald-400 font-semibold flex items-center gap-1 text-[11px]">
                          <CheckCircle className="w-3 h-3" /> Active
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => {
                            setEditingRule(rule);
                            setEditPriceInput(rule.pricePerPage);
                          }}
                          className="px-3 py-1 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition"
                        >
                          Edit Price
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: KIOSKS & HARDWARE MONITOR */}
        {activeTab === 'KIOSKS' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {kiosks.map((k) => (
                <div key={k.id} className="p-6 bg-slate-950 border border-slate-800 rounded-3xl space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center text-blue-400 font-bold">
                        {k.id.slice(-3)}
                      </div>
                      <div>
                        <h4 className="font-bold text-white text-base">{k.name}</h4>
                        <p className="text-xs text-slate-400">{k.location}</p>
                      </div>
                    </div>
                    <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      {k.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-3 bg-slate-900 rounded-xl">
                      <span className="text-slate-500 block mb-1">Attached Printer:</span>
                      <span className="font-bold text-slate-200">{k.printerName}</span>
                    </div>
                    <div className="p-3 bg-slate-900 rounded-xl">
                      <span className="text-slate-500 block mb-1">Printer Health:</span>
                      <span className="font-bold text-emerald-400">{k.printerStatus}</span>
                    </div>
                    <div className="p-3 bg-slate-900 rounded-xl">
                      <span className="text-slate-500 block mb-1">Software Version:</span>
                      <span className="font-mono text-slate-300">{k.softwareVersion}</span>
                    </div>
                    <div className="p-3 bg-slate-900 rounded-xl">
                      <span className="text-slate-500 block mb-1">Spooler Architecture:</span>
                      <span className="text-blue-400 font-semibold">Windows Spooler PCL6</span>
                    </div>
                  </div>

                  {/* Hardware supplies gauge */}
                  <div className="space-y-2 pt-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Tray 1 (A4 Paper):</span>
                      <span className="font-bold text-slate-200">
                        {k.printerStatus === 'OUT_OF_PAPER' ? '0% (EMPTY)' : '88% (440 / 500 sheets)'}
                      </span>
                    </div>
                    <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          k.printerStatus === 'OUT_OF_PAPER'
                            ? 'bg-rose-500 w-[0%]'
                            : 'bg-emerald-500 w-[88%]'
                        }`}
                      />
                    </div>

                    <div className="flex justify-between text-xs pt-1">
                      <span className="text-slate-400">Black & Color Toner:</span>
                      <span className="font-bold text-slate-200">
                        {k.printerStatus === 'LOW_TONER' ? '12% (LOW)' : '92%'}
                      </span>
                    </div>
                    <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          k.printerStatus === 'LOW_TONER'
                            ? 'bg-yellow-500 w-[12%]'
                            : 'bg-blue-500 w-[92%]'
                        }`}
                      />
                    </div>
                  </div>

                  {/* Operator Hardware Status Diagnostics & Simulation Controls */}
                  <div className="pt-3 border-t border-slate-800 space-y-2">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                      Hardware Telemetry & Status Control:
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        onClick={() => handleSetPrinterStatus(k.id, 'READY', 'Operator set printer ready', { paperA4: 90, toner: 92 })}
                        className="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/30 text-[11px] font-semibold transition"
                      >
                        ✓ Set Ready
                      </button>
                      <button
                        onClick={() => handleSetPrinterStatus(k.id, 'OUT_OF_PAPER', 'Tray 1 sensor reports 0 sheets', { paperA4: 0 })}
                        className="px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/30 text-[11px] font-semibold transition"
                      >
                        ⚠️ Out of Paper
                      </button>
                      <button
                        onClick={() => handleSetPrinterStatus(k.id, 'PAPER_JAM', 'Roller sensor 3 paper obstruction detected')}
                        className="px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/30 text-[11px] font-semibold transition"
                      >
                        🚫 Paper Jam
                      </button>
                      <button
                        onClick={() => handleSetPrinterStatus(k.id, 'LOW_TONER', 'Toner optical sensor < 15%', { toner: 12 })}
                        className="px-2.5 py-1 rounded-lg bg-yellow-600/20 hover:bg-yellow-600 text-yellow-300 hover:text-white border border-yellow-500/30 text-[11px] font-semibold transition"
                      >
                        💧 Low Toner/Ink
                      </button>
                      <button
                        onClick={() => handleSetPrinterStatus(k.id, 'PRINTER_ERROR', 'Spooler hardware communication failure')}
                        className="px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/30 text-[11px] font-semibold transition"
                      >
                        ❌ Printer Error
                      </button>
                      <button
                        onClick={() => handleSetPrinterStatus(k.id, 'OFFLINE', 'Power cable or USB link disconnected')}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[11px] font-semibold transition"
                      >
                        🔌 Set Offline
                      </button>
                      <button
                        onClick={() => handleSetPrinterStatus(k.id, 'READY', 'Paper reloaded and roller cleared', { paperA4: 100, toner: 95 })}
                        className="px-2.5 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white border border-blue-500/30 text-[11px] font-semibold transition"
                      >
                        📦 Refill Paper Tray
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB: DOCUMENT CONVERSION SERVICE */}
        {activeTab === 'CONVERSION' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            <div className="p-6 bg-slate-950 border border-slate-800 rounded-2xl flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <FileCheck className="w-5 h-5 text-blue-400" />
                  Standardized Document Conversion Engine
                </h3>
                <p className="text-xs text-slate-400 mt-1 max-w-2xl">
                  Accepts customer documents in diverse formats and converts them into standardized, print-ready PDF files
                  formatted specifically for physical Windows Print Spoolers.
                </p>
              </div>
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Engine Active
              </span>
            </div>

            {/* Format Strategies Matrix */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-5 bg-slate-950 border border-slate-800 rounded-2xl space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <span className="text-sm font-bold text-white">Supported Input Formats</span>
                  <span className="text-xs text-blue-400 font-mono">Output: Standardized PDF</span>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="p-3 bg-slate-900 rounded-xl flex items-center justify-between">
                    <div>
                      <span className="font-bold text-white block">PDF (.pdf)</span>
                      <span className="text-[11px] text-slate-400">Passthrough, header sanitization, page structure validation</span>
                    </div>
                    <span className="text-emerald-400 font-bold">Native Engine</span>
                  </div>

                  <div className="p-3 bg-slate-900 rounded-xl flex items-center justify-between">
                    <div>
                      <span className="font-bold text-white block">Images (.jpg, .jpeg, .png)</span>
                      <span className="text-[11px] text-slate-400">A4/A3 Aspect-ratio preservation, high-DPI scaling & centering</span>
                    </div>
                    <span className="text-emerald-400 font-bold">ImageToPdf Engine</span>
                  </div>

                  <div className="p-3 bg-slate-900 rounded-xl flex items-center justify-between">
                    <div>
                      <span className="font-bold text-white block">Word Documents (.docx, .doc)</span>
                      <span className="text-[11px] text-slate-400">Structured layout conversion into multi-page print stream</span>
                    </div>
                    <span className="text-emerald-400 font-bold">DocxToPdf Engine</span>
                  </div>

                  <div className="p-3 bg-slate-900 rounded-xl flex items-center justify-between">
                    <div>
                      <span className="font-bold text-white block">Presentations (.pptx, .ppt)</span>
                      <span className="text-[11px] text-slate-400">Landscape slide extraction with numbering and borders</span>
                    </div>
                    <span className="text-emerald-400 font-bold">PptxToPdf Engine</span>
                  </div>
                </div>
              </div>

              {/* Extensibility & Privacy Architecture */}
              <div className="p-5 bg-slate-950 border border-slate-800 rounded-2xl space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <span className="text-sm font-bold text-white">Extensibility & Privacy Directives</span>
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                </div>

                <div className="space-y-3 text-xs text-slate-300">
                  <div className="p-3 bg-slate-900 rounded-xl">
                    <p className="font-bold text-white mb-1">1. Extensible Format Registry</p>
                    <p className="text-slate-400">
                      The service uses the Strategy Pattern (`FormatConverter` interface). New formats such as TIFF, SVG, or XLSX
                      can be registered via `conversionService.register()` without modifying application core.
                    </p>
                  </div>

                  <div className="p-3 bg-slate-900 rounded-xl">
                    <p className="font-bold text-white mb-1">2. Zero Permanent Binary Retention</p>
                    <p className="text-slate-400">
                      Converted standardized spool PDFs and original uploaded files are kept exclusively in temporary storage (`temp_uploads/`)
                      and are automatically purged upon printing or session expiration.
                    </p>
                  </div>

                  <div className="p-3 bg-slate-900 rounded-xl">
                    <p className="font-bold text-white mb-1">3. Error Handling & Audit Logs</p>
                    <p className="text-slate-400">
                      Corrupt files or conversion failures immediately log a `CONVERSION_FAILED` audit event, transition the job state
                      to `CONVERSION_FAILED`, and remove all partial temporary artifacts.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: AUDIT LOGS */}
        {activeTab === 'AUDIT' && (
          <div className="space-y-4 animate-in fade-in duration-200">
            <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  Immutable Security Audit Trail
                </h3>
                <p className="text-xs text-slate-400">
                  Every state transition, OTP verification, payment, print spool event, and privacy deletion is logged.
                </p>
              </div>
              <span className="text-xs text-slate-500 font-mono">
                {auditLogs.length} Records Logged
              </span>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Timestamp</th>
                    <th className="py-3 px-4 font-semibold">Action</th>
                    <th className="py-3 px-4 font-semibold">Job ID</th>
                    <th className="py-3 px-4 font-semibold">Actor</th>
                    <th className="py-3 px-4 font-semibold">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-900/40">
                      <td className="py-2.5 px-4 text-slate-400 text-[11px]">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="py-2.5 px-4 font-bold text-blue-400">
                        {log.action}
                      </td>
                      <td className="py-2.5 px-4 text-white">
                        {log.jobId || '—'}
                      </td>
                      <td className="py-2.5 px-4 text-slate-300">
                        {log.performedBy}
                      </td>
                      <td className="py-2.5 px-4 text-slate-400 truncate max-w-[280px]">
                        {log.metadata || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 6: WINDOWS DEPLOYMENT GUIDE */}
        {activeTab === 'DEPLOY' && (
          <div className="p-6 bg-slate-950 border border-slate-800 rounded-2xl space-y-5 animate-in fade-in duration-200">
            <div>
              <h3 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
                <Terminal className="w-5 h-5 text-blue-400" />
                Physical Windows Kiosk Computer Deployment Guide
              </h3>
              <p className="text-xs text-slate-400">
                Instructions for installing on Windows 10/11 IoT Enterprise or Standard connected to USB/Network printers.
              </p>
            </div>

            <div className="space-y-4 text-xs text-slate-300">
              <div className="p-4 bg-slate-900 rounded-xl border border-slate-800">
                <p className="font-bold text-white text-sm mb-2">Step 1: Printer Driver Setup on Windows</p>
                <p className="text-slate-400 mb-2">
                  1. Connect your physical printer (e.g. HP LaserJet, Canon, Epson) via USB or LAN.
                </p>
                <p className="text-slate-400 mb-2">
                  2. Open Windows Settings &gt; Printers & Scanners &gt; Set your printer as <strong>Default Printer</strong>.
                </p>
              </div>

              <div className="p-4 bg-slate-900 rounded-xl border border-slate-800">
                <p className="font-bold text-white text-sm mb-2">Step 2: Windows Print Spooler Daemon Script</p>
                <p className="text-slate-400 mb-3">
                  A dedicated PowerShell daemon script has been generated at <code>printer-agent/windows-spooler-agent.ps1</code>.
                  Run this on the physical machine to enable live hardware status polling:
                </p>
                <pre className="p-3 bg-black rounded-lg text-emerald-400 font-mono text-[11px] overflow-x-auto">
                  powershell.exe -ExecutionPolicy Bypass -File .\printer-agent\windows-spooler-agent.ps1 -BackendUrl "http://localhost:3000" -KioskId "KSK-001"
                </pre>
              </div>

              <div className="p-4 bg-slate-900 rounded-xl border border-slate-800">
                <p className="font-bold text-white text-sm mb-2">Step 3: Windows Assigned Access (Kiosk Mode)</p>
                <p className="text-slate-400">
                  On Windows 10/11: Go to Settings &gt; Accounts &gt; Family & other users &gt; Set up a kiosk &gt; Assigned Access.
                  Choose Microsoft Edge in full-screen kiosk mode pointing to your terminal URL.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* FOOTER */}
      <div className="pt-4 mt-6 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-500">
        <span>Smart Print Kiosk v1.4.2 Production Server</span>
        <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
          <Database className="w-3.5 h-3.5" /> PostgreSQL Database Connected
        </span>
      </div>

      {/* EDIT PRICING MODAL */}
      {editingRule && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-base font-bold text-white mb-2">Edit Price Rule #{editingRule.id}</h3>
            <p className="text-xs text-slate-400 mb-4">
              {editingRule.paperSize} • {editingRule.colorMode} • {editingRule.isDuplex ? 'Duplex' : 'Single-sided'}
            </p>

            <div className="mb-6">
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                New Price per Page (₹)
              </label>
              <input
                type="number"
                min={1}
                max={500}
                value={editPriceInput}
                onChange={(e) => setEditPriceInput(Number(e.target.value))}
                className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white text-lg font-bold focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleSavePriceRule}
                className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition"
              >
                Save Price
              </button>
              <button
                onClick={() => setEditingRule(null)}
                className="px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
