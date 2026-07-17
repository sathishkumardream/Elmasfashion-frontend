import { useState, useEffect, useCallback } from "react";
import "./App.css";
import "./AdminApp.css";

const API_BASE = (process.env.REACT_APP_API_URL || "http://localhost:5000/api").replace(/\/+$/, "");

// ─────────────────────────────────────────────────────────────────────────────
// API HELPER
// ─────────────────────────────────────────────────────────────────────────────
async function apiFetch(path, { method = "GET", body, token } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `Request failed (${res.status})`);
  }
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────────────────────────────────────
function AdminLogin({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await apiFetch("/auth/login", { method: "POST", body: { email, password } });
      // Decode the JWT payload (no verification needed client-side — server enforces it)
      const payload = JSON.parse(atob(data.token.split(".")[1]));
      if (payload.role !== "ADMIN") {
        throw new Error("This account does not have admin access.");
      }
      const adminUser = { email, token: data.token };
      localStorage.setItem("adminUser", JSON.stringify(adminUser));
      localStorage.setItem("token", data.token);
      onLogin(adminUser);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-login-wrap">
      <form className="admin-login-box" onSubmit={handleSubmit}>
        <h2>Admin Panel</h2>
        <p className="sub">Sign in to manage your store</p>
        {error && <div className="admin-login-error">⚠️ {error}</div>}
        <input type="email" placeholder="Admin email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button type="submit" disabled={loading}>{loading ? "Signing in…" : "Sign In"}</button>
        <a className="admin-back-link" href="/">← Back to store</a>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SIMPLE SVG BAR CHART (no charting library available offline)
// ─────────────────────────────────────────────────────────────────────────────
function BarChart({ data, xKey, yKey, height = 180, barColor = "var(--brand)" }) {
  if (!data || data.length === 0) return <p style={{ color: "var(--text-muted)" }}>No data yet.</p>;
  const max = Math.max(...data.map((d) => d[yKey]), 1);
  const width = Math.max(data.length * 26, 320);
  const barWidth = Math.max((width / data.length) - 6, 4);

  return (
    <div className="admin-chart-wrap">
      <svg width={width} height={height + 24} viewBox={`0 0 ${width} ${height + 24}`}>
        {data.map((d, i) => {
          const barHeight = (d[yKey] / max) * height;
          const x = i * (width / data.length) + 3;
          const y = height - barHeight;
          return (
            <g key={i}>
              <title>{`${d[xKey]}: ${d[yKey]}`}</title>
              <rect className="admin-bar" x={x} y={y} width={barWidth} height={barHeight} rx="2" fill={barColor} />
              {i % Math.ceil(data.length / 10 || 1) === 0 && (
                <text className="admin-chart-axis-label" x={x} y={height + 14} textAnchor="middle">
                  {String(d[xKey]).slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
function Dashboard({ token }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch("/dashboard/overview", { token })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div className="admin-loading">Loading dashboard…</div>;
  if (error) return <div className="admin-form-error">⚠️ {error}</div>;
  if (!data) return null;

  const statusColors = { PENDING: "#f59e0b", PAID: "#3b82f6", SHIPPED: "#6366f1", DELIVERED: "#22c55e" };

  return (
    <div>
      <h1 className="admin-page-title">Dashboard</h1>
      <p className="admin-page-sub">Store performance at a glance</p>

      <div className="admin-stats-grid">
        <div className="admin-stat-card">
          <p className="admin-stat-label">💰 Total Revenue</p>
          <p className="admin-stat-value">₹{data.totalRevenue.toLocaleString()}</p>
        </div>
        <div className="admin-stat-card">
          <p className="admin-stat-label">📦 Total Orders</p>
          <p className="admin-stat-value">{data.totalOrders}</p>
        </div>
        <div className="admin-stat-card">
          <p className="admin-stat-label">🛍️ Total Products</p>
          <p className="admin-stat-value">{data.totalProducts}</p>
        </div>
        <div className="admin-stat-card">
          <p className="admin-stat-label">👥 Customers</p>
          <p className="admin-stat-value">{data.totalUsers}</p>
        </div>
        <div className="admin-stat-card">
          <p className="admin-stat-label">⏳ Pending Orders</p>
          <p className="admin-stat-value">{data.pendingOrders}</p>
        </div>
      </div>

      <div className="admin-panel">
        <h3 className="admin-panel-title">Revenue — Last 30 Days</h3>
        <BarChart data={data.revenueByDay} xKey="date" yKey="revenue" />
      </div>

      <div className="admin-two-col">
        <div className="admin-panel">
          <h3 className="admin-panel-title">Top Selling Products</h3>
          {data.topProducts.length === 0 ? (
            <p className="admin-empty-state">No sales yet.</p>
          ) : (
            <table className="admin-table">
              <thead><tr><th>Product</th><th>Units Sold</th><th>Revenue</th></tr></thead>
              <tbody>
                {data.topProducts.map((p) => (
                  <tr key={p.productId}>
                    <td>{p.name}</td>
                    <td>{p.unitsSold}</td>
                    <td>₹{p.revenue.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="admin-panel">
          <h3 className="admin-panel-title">Low Stock Alert</h3>
          {data.lowStockProducts.length === 0 ? (
            <p className="admin-empty-state">All products well stocked. 🎉</p>
          ) : (
            <table className="admin-table">
              <thead><tr><th>Product</th><th>Stock Left</th></tr></thead>
              <tbody>
                {data.lowStockProducts.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td><span className="admin-badge low-stock">{p.stock} left</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="admin-panel">
        <h3 className="admin-panel-title">
          Orders by Status
          <span style={{ fontSize: "0.78rem", fontWeight: 400, color: "var(--text-muted)" }}>
            {data.ordersByStatus.map((s) => `${s.status}: ${s.count}`).join("  •  ")}
          </span>
        </h3>
        <div style={{ display: "flex", height: 24, borderRadius: 8, overflow: "hidden" }}>
          {data.ordersByStatus.map((s) => (
            <div
              key={s.status}
              title={`${s.status}: ${s.count}`}
              style={{
                flex: s.count || 0.01,
                background: statusColors[s.status] || "#ccc",
              }}
            />
          ))}
        </div>
      </div>

      <div className="admin-panel">
        <h3 className="admin-panel-title">Recent Orders</h3>
        {data.recentOrders.length === 0 ? (
          <p className="admin-empty-state">No orders yet.</p>
        ) : (
          <table className="admin-table">
            <thead><tr><th>#</th><th>Customer</th><th>Total</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>
              {data.recentOrders.map((o) => (
                <tr key={o.id}>
                  <td>#{o.id}</td>
                  <td>{o.user?.name || o.user?.email}</td>
                  <td>₹{o.total.toLocaleString()}</td>
                  <td><span className={`admin-badge ${o.status}`}>{o.status}</span></td>
                  <td>{new Date(o.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTS MANAGER
// ─────────────────────────────────────────────────────────────────────────────
function ProductForm({ initial, categories, onSave, onCancel, saving, error }) {
  const [form, setForm] = useState(
    initial || { name: "", description: "", price: "", stock: "", image: "", categoryId: categories[0]?.id || "" }
  );
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="admin-modal-overlay" onClick={onCancel}>
      <div className="admin-modal-box" onClick={(e) => e.stopPropagation()}>
        <h3>{initial ? "Edit Product" : "Add Product"}</h3>
        {error && <div className="admin-form-error">⚠️ {error}</div>}
        <div className="admin-form-row">
          <label>Name</label>
          <input value={form.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="admin-form-row">
          <label>Description</label>
          <textarea rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} />
        </div>
        <div className="admin-two-col">
          <div className="admin-form-row">
            <label>Price (₹)</label>
            <input type="number" value={form.price} onChange={(e) => set("price", e.target.value)} />
          </div>
          <div className="admin-form-row">
            <label>Stock</label>
            <input type="number" value={form.stock} onChange={(e) => set("stock", e.target.value)} />
          </div>
        </div>
        <div className="admin-form-row">
          <label>Image URL</label>
          <input value={form.image} onChange={(e) => set("image", e.target.value)} placeholder="https://..." />
        </div>
        <div className="admin-form-row">
          <label>Category</label>
          <select value={form.categoryId} onChange={(e) => set("categoryId", Number(e.target.value))}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="admin-form-actions">
          <button className="admin-btn admin-btn-outline" onClick={onCancel}>Cancel</button>
          <button
            className="admin-btn admin-btn-primary"
            disabled={saving}
            onClick={() => onSave({
              ...form,
              price: Number(form.price),
              stock: Number(form.stock),
              categoryId: Number(form.categoryId),
            })}
          >
            {saving ? "Saving…" : "Save Product"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProductsManager({ token }) {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // product being edited, or {} for new
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [search, setSearch] = useState("");
  const [newCategory, setNewCategory] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([apiFetch("/products"), apiFetch("/categories")])
      .then(([p, c]) => { setProducts(p); setCategories(c); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (form) => {
    setSaving(true); setFormError("");
    try {
      if (editing?.id) {
        await apiFetch(`/products/${editing.id}`, { method: "PUT", body: form, token });
      } else {
        await apiFetch("/products", { method: "POST", body: form, token });
      }
      setEditing(null);
      load();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this product? This cannot be undone.")) return;
    try {
      await apiFetch(`/products/${id}`, { method: "DELETE", token });
      load();
    } catch (e) {
      alert(e.message);
    }
  };

  const handleAddCategory = async () => {
    if (!newCategory.trim()) return;
    try {
      await apiFetch("/categories", { method: "POST", body: { name: newCategory.trim() }, token });
      setNewCategory("");
      load();
    } catch (e) {
      alert(e.message);
    }
  };

  const filtered = products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <h1 className="admin-page-title">Products</h1>
      <p className="admin-page-sub">Manage your product catalog</p>

      <div className="admin-panel">
        <h3 className="admin-panel-title">Categories</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {categories.map((c) => (
            <span key={c.id} className="admin-badge active-yes">{c.name}</span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="admin-search-input" placeholder="New category name"
            value={newCategory} onChange={(e) => setNewCategory(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddCategory()} />
          <button className="admin-btn admin-btn-outline" onClick={handleAddCategory}>+ Add Category</button>
        </div>
      </div>

      <div className="admin-toolbar">
        <input className="admin-search-input" placeholder="🔍 Search products…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 260 }} />
        <button className="admin-btn admin-btn-primary" onClick={() => setEditing({})}>+ Add Product</button>
      </div>

      {loading ? <div className="admin-loading">Loading…</div> :
       error ? <div className="admin-form-error">⚠️ {error}</div> :
       filtered.length === 0 ? <div className="admin-empty-state">No products found.</div> : (
        <div className="admin-panel" style={{ padding: 0 }}>
          <table className="admin-table">
            <thead>
              <tr><th></th><th>Name</th><th>Category</th><th>Price</th><th>Stock</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td><img className="admin-thumb" src={p.image} alt="" onError={(e) => { e.target.style.visibility = "hidden"; }} /></td>
                  <td>{p.name}</td>
                  <td>{p.category?.name || "—"}</td>
                  <td>₹{p.price.toLocaleString()}</td>
                  <td>{p.stock <= 10 ? <span className="admin-badge low-stock">{p.stock}</span> : p.stock}</td>
                  <td>
                    <button className="admin-btn admin-btn-outline admin-btn-sm" style={{ marginRight: 6 }} onClick={() => setEditing(p)}>Edit</button>
                    <button className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => handleDelete(p.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing !== null && (
        <ProductForm
          initial={editing.id ? editing : null}
          categories={categories}
          saving={saving}
          error={formError}
          onCancel={() => { setEditing(null); setFormError(""); }}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ORDERS MANAGER (Fulfillment)
// ─────────────────────────────────────────────────────────────────────────────
const ORDER_STATUSES = ["PENDING", "PAID", "SHIPPED", "DELIVERED"];

function OrdersManager({ token }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [updating, setUpdating] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch("/orders/admin/all", { token })
      .then(setOrders)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handleStatusChange = async (orderId, status) => {
    setUpdating(orderId);
    try {
      await apiFetch(`/orders/${orderId}/status`, { method: "PUT", body: { status }, token });
      setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status } : o)));
    } catch (e) {
      alert(e.message);
    } finally {
      setUpdating(null);
    }
  };

  const filtered = statusFilter === "ALL" ? orders : orders.filter((o) => o.status === statusFilter);

  return (
    <div>
      <h1 className="admin-page-title">Orders</h1>
      <p className="admin-page-sub">Fulfill and track customer orders</p>

      <div className="admin-toolbar">
        <select className="admin-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="ALL">All Statuses</option>
          {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>{filtered.length} orders</p>
      </div>

      {loading ? <div className="admin-loading">Loading…</div> :
       error ? <div className="admin-form-error">⚠️ {error}</div> :
       filtered.length === 0 ? <div className="admin-empty-state">No orders found.</div> : (
        <div className="admin-panel" style={{ padding: 0 }}>
          <table className="admin-table">
            <thead>
              <tr><th>#</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th><th>Placed</th></tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <tr key={o.id}>
                  <td>#{o.id}</td>
                  <td>{o.user?.name}<br /><span style={{ color: "var(--text-muted)", fontSize: "0.78rem" }}>{o.user?.email}</span></td>
                  <td>{o.orderItems.length} item{o.orderItems.length !== 1 ? "s" : ""}</td>
                  <td>₹{o.total.toLocaleString()}</td>
                  <td>{o.paymentMethod}</td>
                  <td>
                    <select
                      className="admin-select"
                      value={o.status}
                      disabled={updating === o.id}
                      onChange={(e) => handleStatusChange(o.id, e.target.value)}
                    >
                      {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td>{new Date(o.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMOTIONS MANAGER (Pricing & Promotions)
// ─────────────────────────────────────────────────────────────────────────────
function PromotionForm({ initial, onSave, onCancel, saving, error }) {
  const [form, setForm] = useState(
    initial || { code: "", type: "PERCENT", value: "", minOrderValue: "", active: true, expiresAt: "", usageLimit: "" }
  );
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="admin-modal-overlay" onClick={onCancel}>
      <div className="admin-modal-box" onClick={(e) => e.stopPropagation()}>
        <h3>{initial ? "Edit Promotion" : "New Promotion"}</h3>
        {error && <div className="admin-form-error">⚠️ {error}</div>}
        <div className="admin-form-row">
          <label>Coupon Code</label>
          <input value={form.code} onChange={(e) => set("code", e.target.value.toUpperCase())} placeholder="e.g. SUMMER25" />
        </div>
        <div className="admin-two-col">
          <div className="admin-form-row">
            <label>Type</label>
            <select value={form.type} onChange={(e) => set("type", e.target.value)}>
              <option value="PERCENT">Percentage Off</option>
              <option value="FLAT">Flat Amount Off</option>
              <option value="SHIPPING">Free Shipping</option>
            </select>
          </div>
          <div className="admin-form-row">
            <label>Value {form.type === "PERCENT" ? "(%)" : form.type === "FLAT" ? "(₹)" : ""}</label>
            <input type="number" value={form.value} disabled={form.type === "SHIPPING"}
              onChange={(e) => set("value", e.target.value)} />
          </div>
        </div>
        <div className="admin-two-col">
          <div className="admin-form-row">
            <label>Minimum Order Value (₹)</label>
            <input type="number" value={form.minOrderValue} onChange={(e) => set("minOrderValue", e.target.value)} />
          </div>
          <div className="admin-form-row">
            <label>Usage Limit (optional)</label>
            <input type="number" value={form.usageLimit} onChange={(e) => set("usageLimit", e.target.value)} placeholder="Unlimited" />
          </div>
        </div>
        <div className="admin-form-row">
          <label>Expires On (optional)</label>
          <input type="date" value={form.expiresAt ? form.expiresAt.slice(0, 10) : ""} onChange={(e) => set("expiresAt", e.target.value)} />
        </div>
        <div className="admin-form-row admin-checkbox-row">
          <input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} id="active-cb" />
          <label htmlFor="active-cb" style={{ marginBottom: 0 }}>Active</label>
        </div>
        <div className="admin-form-actions">
          <button className="admin-btn admin-btn-outline" onClick={onCancel}>Cancel</button>
          <button
            className="admin-btn admin-btn-primary"
            disabled={saving}
            onClick={() => onSave({
              ...form,
              value: form.type === "SHIPPING" ? 0 : Number(form.value),
              minOrderValue: Number(form.minOrderValue) || 0,
              usageLimit: form.usageLimit ? Number(form.usageLimit) : null,
              expiresAt: form.expiresAt || null,
            })}
          >
            {saving ? "Saving…" : "Save Promotion"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PromotionsManager({ token }) {
  const [promotions, setPromotions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    apiFetch("/promotions", { token })
      .then(setPromotions)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (form) => {
    setSaving(true); setFormError("");
    try {
      if (editing?.id) {
        await apiFetch(`/promotions/${editing.id}`, { method: "PUT", body: form, token });
      } else {
        await apiFetch("/promotions", { method: "POST", body: form, token });
      }
      setEditing(null);
      load();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this promotion?")) return;
    try {
      await apiFetch(`/promotions/${id}`, { method: "DELETE", token });
      load();
    } catch (e) {
      alert(e.message);
    }
  };

  return (
    <div>
      <h1 className="admin-page-title">Pricing & Promotions</h1>
      <p className="admin-page-sub">Create and manage discount coupons</p>

      <div className="admin-toolbar">
        <div />
        <button className="admin-btn admin-btn-primary" onClick={() => setEditing({})}>+ New Promotion</button>
      </div>

      {loading ? <div className="admin-loading">Loading…</div> :
       error ? <div className="admin-form-error">⚠️ {error}</div> :
       promotions.length === 0 ? <div className="admin-empty-state">No promotions yet. Create your first coupon!</div> : (
        <div className="admin-panel" style={{ padding: 0 }}>
          <table className="admin-table">
            <thead>
              <tr><th>Code</th><th>Type</th><th>Value</th><th>Min. Order</th><th>Used</th><th>Status</th><th>Expires</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {promotions.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.code}</strong></td>
                  <td>{p.type}</td>
                  <td>{p.type === "PERCENT" ? `${p.value}%` : p.type === "FLAT" ? `₹${p.value}` : "Free Ship"}</td>
                  <td>₹{p.minOrderValue}</td>
                  <td>{p.usedCount}{p.usageLimit ? ` / ${p.usageLimit}` : ""}</td>
                  <td><span className={`admin-badge ${p.active ? "active-yes" : "active-no"}`}>{p.active ? "Active" : "Inactive"}</span></td>
                  <td>{p.expiresAt ? new Date(p.expiresAt).toLocaleDateString() : "—"}</td>
                  <td>
                    <button className="admin-btn admin-btn-outline admin-btn-sm" style={{ marginRight: 6 }} onClick={() => setEditing(p)}>Edit</button>
                    <button className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => handleDelete(p.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing !== null && (
        <PromotionForm
          initial={editing.id ? editing : null}
          saving={saving}
          error={formError}
          onCancel={() => { setEditing(null); setFormError(""); }}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT + MAIN
// ─────────────────────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", icon: "📊" },
  { key: "products", label: "Products", icon: "🛍️" },
  { key: "orders", label: "Orders", icon: "📦" },
  { key: "promotions", label: "Promotions", icon: "🏷️" },
];

export default function AdminApp() {
  const [admin, setAdmin] = useState(null);
  const [tab, setTab] = useState("dashboard");

  useEffect(() => {
    const saved = localStorage.getItem("adminUser");
    if (saved) setAdmin(JSON.parse(saved));
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("adminUser");
    localStorage.removeItem("token");
    setAdmin(null);
  };

  if (!admin) return <AdminLogin onLogin={setAdmin} />;

  return (
    <div className="admin-root">
      <div className="admin-layout">
        <aside className="admin-sidebar">
          <div className="admin-brand">ELMA'S <span>ADMIN</span></div>
          <nav className="admin-nav">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.key}
                className={`admin-nav-item ${tab === item.key ? "active" : ""}`}
                onClick={() => setTab(item.key)}
              >
                <span>{item.icon}</span> {item.label}
              </button>
            ))}
          </nav>
          <div className="admin-sidebar-footer">
            <p className="admin-user-email">{admin.email}</p>
            <button className="admin-logout-btn" onClick={handleLogout}>Sign Out</button>
          </div>
        </aside>
        <main className="admin-main">
          {tab === "dashboard" && <Dashboard token={admin.token} />}
          {tab === "products" && <ProductsManager token={admin.token} />}
          {tab === "orders" && <OrdersManager token={admin.token} />}
          {tab === "promotions" && <PromotionsManager token={admin.token} />}
        </main>
      </div>
    </div>
  );
}
