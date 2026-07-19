"use client";

import { useState, useEffect, useRef } from "react";

// Point to the Express backend
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

type ReceiptItem = {
  description: string;
  quantity: number;
  price: number;
};

type Receipt = {
  id: number;
  status: "processing" | "completed" | "failed";
  store_name: string | null;
  receipt_date: string | null;
  total_amount: string | null;
  taxes: string | null;
  items: ReceiptItem[] | null;
  category: string | null;
  error_message: string | null;
  created_at: string;
};

type ExpenseSummary = {
  filter: string;
  expenses: Record<string, number>;
  totalExpenses: number;
};

const CATEGORIES = [
  "Medical & Pharmacy",
  "Grocery",
  "Food & Dining",
  "Shopping",
  "Fuel",
  "Bills",
  "Other",
];

const FILTER_LABELS: Record<string, string> = {
  today: "Today",
  yesterday: "Yesterday",
  this_week: "This Week",
  this_month: "This Month",
  this_year: "This Year",
};

export default function Home() {
  // Auth state
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [isRegistering, setIsRegistering] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(false);

  // App dashboard state
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<string>("this_month");
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadLoading, setUploadLoading] = useState<boolean>(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 1. Initial Auth Check on Mount
  useEffect(() => {
    const savedToken = localStorage.getItem("auth_token");
    const savedEmail = localStorage.getItem("user_email");
    if (savedToken) {
      setToken(savedToken);
      if (savedEmail) setEmail(savedEmail);
    }
  }, []);

  // 2. Fetch Dashboard Data
  const fetchDashboardData = async (activeToken = token) => {
    if (!activeToken) return;
    try {
      setDashboardError(null);
      
      // Fetch receipts list
      const receiptsRes = await fetch(`${API_BASE_URL}/api/receipts`, {
        headers: { Authorization: `Bearer ${activeToken}` },
      });
      if (!receiptsRes.ok) throw new Error("Failed to load receipts list.");
      const receiptsData = await receiptsRes.json();
      setReceipts(receiptsData.receipts);

      // Fetch summary
      const summaryRes = await fetch(
        `${API_BASE_URL}/api/receipts/summary?filter=${selectedFilter}`,
        {
          headers: { Authorization: `Bearer ${activeToken}` },
        }
      );
      if (!summaryRes.ok) throw new Error("Failed to load expense summary.");
      const summaryData = await summaryRes.json();
      setSummary(summaryData);
    } catch (err: any) {
      console.error(err);
      setDashboardError(err.message || "An error occurred while loading dashboard data.");
    }
  };

  // Fetch data on token or date filter change
  useEffect(() => {
    if (token) {
      fetchDashboardData();
    }
  }, [token, selectedFilter]);

  // 3. Status Auto-Polling
  // If any receipt in the list is currently in 'processing' status, poll the backend every 3 seconds
  useEffect(() => {
    if (!token) return;
    const hasProcessing = receipts.some((r) => r.status === "processing");
    if (!hasProcessing) return;

    console.log("[Polling] Processing receipts detected. Starting background status polling...");
    const interval = setInterval(() => {
      fetchDashboardData();
    }, 3000);

    return () => clearInterval(interval);
  }, [receipts, token]);

  // 4. Handle Authenticated Register / Login
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);

    try {
      const endpoint = isRegistering ? "/api/auth/register" : "/api/auth/login";
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Authentication request failed.");
      }

      if (isRegistering) {
        setIsRegistering(false);
        setAuthError(null);
        alert("Registration successful! Please login with your credentials.");
      } else {
        localStorage.setItem("auth_token", data.token);
        localStorage.setItem("user_email", email);
        setToken(data.token);
      }
    } catch (err: any) {
      setAuthError(err.message || "Server connection failed.");
    } finally {
      setAuthLoading(false);
    }
  };

  // Logout
  const handleLogout = () => {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("user_email");
    setToken(null);
    setEmail("");
    setPassword("");
    setReceipts([]);
    setSummary(null);
  };

  // 5. Handle File Upload
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) return;

    setUploadLoading(true);
    setUploadError(null);

    const formData = new FormData();
    formData.append("receipt", uploadFile);

    try {
      const response = await fetch(`${API_BASE_URL}/api/receipts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "File upload failed.");
      }

      // Reset file upload inputs
      setUploadFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";

      // Refresh list to show 'processing' row immediately
      fetchDashboardData();
    } catch (err: any) {
      setUploadError(err.message || "An error occurred during upload.");
    } finally {
      setUploadLoading(false);
    }
  };

  // Formatted date helper
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    try {
      const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };
      return new Date(dateStr).toLocaleDateString(undefined, options);
    } catch {
      return dateStr;
    }
  };

  // Auth Screen Render
  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100 font-sans p-6">
        <div className="w-full max-w-md bg-slate-900/60 backdrop-blur border border-slate-800/80 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-violet-600"></div>
          
          <div className="mb-8 text-center">
            <h2 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-200 to-slate-200 bg-clip-text text-transparent">
              {isRegistering ? "Create Account" : "Receipt Parser"}
            </h2>
            <p className="text-sm text-slate-400 mt-2">
              {isRegistering
                ? "Sign up to extract metadata and track expenses"
                : "Sign in to manage and parse your receipts"}
            </p>
          </div>

          <form onSubmit={handleAuthSubmit} className="space-y-6">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition"
              />
            </div>

            {authError && (
              <div className="p-4 bg-red-950/40 border border-red-800/80 rounded-xl text-red-300 text-sm leading-relaxed">
                {authError}
              </div>
            )}

            <button
              type="submit"
              disabled={authLoading}
              className="w-full py-3.5 rounded-xl text-white font-semibold bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:opacity-50 transition shadow-lg shadow-indigo-500/10 cursor-pointer"
            >
              {authLoading ? "Please wait..." : isRegistering ? "Register Account" : "Sign In"}
            </button>
          </form>

          <div className="mt-8 text-center border-t border-slate-800/80 pt-6">
            <button
              onClick={() => {
                setIsRegistering(!isRegistering);
                setAuthError(null);
              }}
              className="text-indigo-400 hover:text-indigo-300 text-sm font-medium transition cursor-pointer"
            >
              {isRegistering ? "Already have an account? Sign In" : "Need an account? Create one"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Dashboard Screen Render
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans pb-24">
      {/* Header bar */}
      <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur border-b border-slate-800/80 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 14l2-2 4 4m0-3V3m0 0h-3m3 0H9" />
              </svg>
            </div>
            <span className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-indigo-200 to-slate-200 bg-clip-text text-transparent">
              Receipt Parser
            </span>
          </div>

          <div className="flex items-center gap-4">
            <span className="hidden sm:inline text-sm text-slate-400 font-medium">
              {localStorage.getItem("user_email")}
            </span>
            <button
              onClick={handleLogout}
              className="px-4 py-2 border border-slate-800 hover:bg-slate-900 rounded-xl text-sm font-semibold text-slate-300 hover:text-white transition cursor-pointer"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main dashboard core */}
      <main className="max-w-6xl mx-auto px-6 mt-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left col: Summary and uploader */}
        <div className="lg:col-span-1 space-y-8">
          
          {/* Uploader Card */}
          <section className="bg-slate-900/40 border border-slate-800/60 rounded-2xl p-6 shadow-xl">
            <h3 className="font-bold text-lg text-slate-200 mb-4">Upload Receipt</h3>
            <form onSubmit={handleUploadSubmit} className="space-y-4">
              <div className="border-2 border-dashed border-slate-800 hover:border-indigo-500/60 rounded-xl p-6 text-center cursor-pointer transition relative bg-slate-950/20 group">
                <input
                  type="file"
                  ref={fileInputRef}
                  required
                  accept="image/*"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <svg className="w-10 h-10 text-slate-500 group-hover:text-indigo-400 mx-auto mb-3 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {uploadFile ? (
                  <div className="text-sm font-semibold text-slate-200 truncate">
                    {uploadFile.name}
                  </div>
                ) : (
                  <div className="text-sm text-slate-400 group-hover:text-slate-300 transition">
                    Drag receipt image or click to select
                  </div>
                )}
              </div>

              {uploadError && (
                <div className="p-3 bg-red-950/40 border border-red-800/80 rounded-xl text-red-300 text-xs">
                  {uploadError}
                </div>
              )}

              <button
                type="submit"
                disabled={uploadLoading || !uploadFile}
                className="w-full py-3 rounded-xl text-white font-semibold bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
              >
                {uploadLoading ? "Uploading & Enqueuing..." : "Process Receipt"}
              </button>
            </form>
          </section>

          {/* Expense Summary aggregates */}
          <section className="bg-slate-900/40 border border-slate-800/60 rounded-2xl p-6 shadow-xl space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-slate-200">Expense Summary</h3>
              <select
                value={selectedFilter}
                onChange={(e) => setSelectedFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
              >
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="this_week">This Week</option>
                <option value="this_month">This Month</option>
                <option value="this_year">This Year</option>
              </select>
            </div>

            {summary ? (
              <div className="space-y-6">
                {/* Grand total callout */}
                <div className="bg-gradient-to-r from-slate-950 to-slate-900 border border-slate-800/80 rounded-xl p-5 text-center">
                  <div className="text-xs uppercase tracking-widest font-semibold text-slate-400 mb-1">
                    Total Spent ({FILTER_LABELS[selectedFilter]})
                  </div>
                  <div className="text-3xl font-extrabold text-white">
                    ₹{summary.totalExpenses.toFixed(2)}
                  </div>
                </div>

                {/* Categories progress */}
                <div className="space-y-3.5">
                  {CATEGORIES.map((cat) => {
                    const amount = summary.expenses[cat] || 0.00;
                    const percentage = summary.totalExpenses > 0 ? (amount / summary.totalExpenses) * 100 : 0;
                    return (
                      <div key={cat} className="space-y-1.5">
                        <div className="flex justify-between text-xs font-semibold">
                          <span className="text-slate-400">{cat}</span>
                          <span className="text-slate-200">₹{amount.toFixed(2)}</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden">
                          <div
                            style={{ width: `${percentage}%` }}
                            className="h-full bg-indigo-500 rounded-full"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-slate-500 text-sm">
                No summary metrics loaded
              </div>
            )}
          </section>

        </div>

        {/* Right col: Receipts lists */}
        <div className="lg:col-span-2 space-y-8">
          
          <section className="bg-slate-900/40 border border-slate-800/60 rounded-2xl p-6 shadow-xl min-h-[500px] flex flex-col">
            <h3 className="font-bold text-lg text-slate-200 mb-6">Recent Uploads</h3>

            {dashboardError && (
              <div className="p-4 bg-red-950/40 border border-red-800/80 rounded-xl text-red-300 text-sm mb-6">
                {dashboardError}
              </div>
            )}

            {receipts.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
                <svg className="w-12 h-12 text-slate-600 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <div className="text-slate-400 text-sm font-semibold">No receipts found</div>
                <div className="text-slate-600 text-xs mt-1">Upload a receipt image to get started</div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800/80 text-slate-400 text-xs font-bold uppercase tracking-wider">
                      <th className="pb-3.5 font-bold">Store</th>
                      <th className="pb-3.5 font-bold">Date</th>
                      <th className="pb-3.5 font-bold">Category</th>
                      <th className="pb-3.5 font-bold text-right">Amount</th>
                      <th className="pb-3.5 font-bold text-center">Status</th>
                      <th className="pb-3.5 font-bold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/40">
                    {receipts.map((rec) => (
                      <tr key={rec.id} className="hover:bg-slate-900/20 transition group">
                        <td className="py-4 pr-3 font-semibold text-slate-100">
                          {rec.status === "completed" ? rec.store_name || "Unknown Merchant" : "-"}
                        </td>
                        <td className="py-4 text-slate-400">
                          {rec.status === "completed" ? formatDate(rec.receipt_date) : "-"}
                        </td>
                        <td className="py-4">
                          {rec.status === "completed" ? (
                            <span className="inline-block bg-slate-950 border border-slate-800 text-slate-300 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                              {rec.category || "Other"}
                            </span>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="py-4 text-right font-bold text-slate-200">
                          {rec.status === "completed" ? `₹${parseFloat(rec.total_amount || "0").toFixed(2)}` : "-"}
                        </td>
                        <td className="py-4 text-center">
                          {rec.status === "processing" && (
                            <span className="inline-flex items-center gap-1.5 text-yellow-500 font-semibold text-xs bg-yellow-500/10 border border-yellow-500/20 px-2.5 py-1 rounded-lg animate-pulse">
                              <svg className="animate-spin h-3.5 w-3.5 text-yellow-500" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                              </svg>
                              Processing
                            </span>
                          )}
                          {rec.status === "completed" && (
                            <span className="inline-flex items-center text-green-500 font-semibold text-xs bg-green-500/10 border border-green-500/20 px-2.5 py-1 rounded-lg">
                              Success
                            </span>
                          )}
                          {rec.status === "failed" && (
                            <div className="inline-flex items-center justify-center gap-1.5">
                              <span className="inline-flex items-center text-red-500 font-semibold text-xs bg-red-500/10 border border-red-500/20 px-2.5 py-1 rounded-lg">
                                Failed
                              </span>
                              <button
                                onClick={() => alert(rec.error_message || "Unknown error")}
                                className="inline-flex items-center text-red-400 hover:text-red-300 transition cursor-pointer"
                                title="Click to view error details"
                              >
                                <svg
                                  className="w-4 h-4"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  strokeWidth={2}
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                  />
                                </svg>
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="py-4 text-right">
                          <button
                            disabled={rec.status !== "completed"}
                            onClick={() => setSelectedReceipt(rec)}
                            className="text-indigo-400 hover:text-indigo-300 font-semibold text-xs disabled:opacity-30 disabled:hover:text-indigo-400 transition cursor-pointer"
                          >
                            View Items
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

        </div>
      </main>

      {/* Modal for Details View */}
      {selectedReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6 relative">
            
            {/* Modal header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h4 className="font-extrabold text-xl text-slate-100">{selectedReceipt.store_name || "Receipt Details"}</h4>
                <p className="text-xs text-slate-400 mt-1">Uploaded {formatDate(selectedReceipt.created_at)}</p>
              </div>
              <button
                onClick={() => setSelectedReceipt(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Receipt details */}
            <div className="grid grid-cols-2 gap-4 bg-slate-950/40 border border-slate-800/80 rounded-2xl p-4 text-sm">
              <div>
                <span className="block text-xs text-slate-500 font-semibold uppercase">Category</span>
                <span className="inline-block bg-slate-950 border border-slate-800 text-slate-300 text-[10px] font-bold px-2 py-0.5 rounded-full mt-1">
                  {selectedReceipt.category || "Other"}
                </span>
              </div>
              <div>
                <span className="block text-xs text-slate-500 font-semibold uppercase">Transaction Date</span>
                <span className="text-slate-300 font-semibold block mt-1">{formatDate(selectedReceipt.receipt_date)}</span>
              </div>
            </div>

            {/* Line items checklist */}
            <div className="space-y-3">
              <h5 className="font-bold text-xs text-slate-400 uppercase tracking-widest">Line Items</h5>
              <div className="border border-slate-800/80 rounded-2xl divide-y divide-slate-800/40 bg-slate-950/10 max-h-56 overflow-y-auto">
                {selectedReceipt.items && selectedReceipt.items.length > 0 ? (
                  selectedReceipt.items.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between px-4 py-3 text-sm">
                      <div>
                        <div className="font-semibold text-slate-200">{item.description}</div>
                        <div className="text-slate-500 text-xs">Qty: {item.quantity}</div>
                      </div>
                      <div className="font-bold text-slate-300">
                        ₹{parseFloat((item.price * item.quantity).toString()).toFixed(2)}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-6 text-slate-600 text-sm">No items itemized on receipt.</div>
                )}
              </div>
            </div>

            {/* Totals aggregates */}
            <div className="border-t border-slate-800 pt-4 space-y-2 text-sm font-semibold">
              <div className="flex justify-between text-slate-400">
                <span>Taxes</span>
                <span>₹{parseFloat(selectedReceipt.taxes || "0").toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-base font-extrabold text-white">
                <span>Total Amount</span>
                <span>₹{parseFloat(selectedReceipt.total_amount || "0").toFixed(2)}</span>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
