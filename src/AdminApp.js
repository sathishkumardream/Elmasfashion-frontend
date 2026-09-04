import React, { useState, useEffect, useCallback } from "react";
import "./App.css";
import "./AdminApp.css";

const API_BASE = (process.env.REACT_APP_API_URL || "http://localhost:5000/api").replace(/\/+$/, "");

// Direct-to-Cloudinary browser upload — no backend involvement, so no server-side
// file storage or extra dependency is needed. If these aren't configured, the
// upload button is simply hidden and admins can still paste an image URL manually.
const CLOUDINARY_CLOUD_NAME = process.env.REACT_APP_CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_UPLOAD_PRESET = process.env.REACT_APP_CLOUDINARY_UPLOAD_PRESET;
const CLOUDINARY_CONFIGURED = Boolean(CLOUDINARY_CLOUD_NAME && CLOUDINARY_UPLOAD_PRESET);

async function uploadImageToCloudinary(file) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
    method: "POST",
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Image upload failed");
  return data.secure_url;
}

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
// ─────────────────────────────────────────────────────────────────────────────
// IMAGE UPLOADER — paste a URL (always works) or upload a file via Cloudinary
// (only shown if REACT_APP_CLOUDINARY_CLOUD_NAME / _UPLOAD_PRESET are configured).
// multi=true: manages an array of URLs (product gallery) with add/remove/reorder-by-drag omitted for simplicity.
// multi=false: manages a single URL (variant image).
// ─────────────────────────────────────────────────────────────────────────────
function ImageUploader({ multi = false, value, onChange, hint }) {
  const [urlInput, setUrlInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const urls = multi ? (Array.isArray(value) ? value : []) : (value ? [value] : []);

  const addUrl = (url) => {
    if (!url) return;
    if (multi) onChange([...urls, url]);
    else onChange(url);
  };

  const removeAt = (i) => {
    if (multi) onChange(urls.filter((_, idx) => idx !== i));
    else onChange("");
  };

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setError(""); setUploading(true);
    try {
      for (const file of files) {
        const url = await uploadImageToCloudinary(file);
        addUrl(url);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      e.target.value = ""; // allow re-selecting the same file later
    }
  };

  const handleAddUrlClick = () => {
    if (!urlInput.trim()) return;
    addUrl(urlInput.trim());
    setUrlInput("");
  };

  return (
    <div className="admin-image-uploader">
      {urls.length > 0 && (
        <div className="admin-image-thumbs">
          {urls.map((u, i) => (
            <div key={i} className="admin-image-thumb-wrap">
              <img src={u} alt="" onError={(e) => { e.target.style.opacity = 0.3; }} />
              <button type="button" className="admin-image-thumb-remove" onClick={() => removeAt(i)}>✕</button>
            </div>
          ))}
        </div>
      )}

      <div className="admin-image-add-row">
        <input
          placeholder="Paste an image URL…"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddUrlClick())}
        />
        <button type="button" className="admin-btn admin-btn-outline admin-btn-sm" onClick={handleAddUrlClick}>Add URL</button>

        {CLOUDINARY_CONFIGURED && (
          <label className="admin-btn admin-btn-outline admin-btn-sm admin-image-upload-btn">
            {uploading ? "Uploading…" : "⬆ Upload"}
            <input type="file" accept="image/*" multiple={multi} onChange={handleFileSelect} disabled={uploading} hidden />
          </label>
        )}
      </div>
      {error && <p className="admin-form-error" style={{ marginTop: 6 }}>⚠️ {error}</p>}
      {hint && <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 4 }}>{hint}</p>}
      {!CLOUDINARY_CONFIGURED && (
        <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 4 }}>
          File upload isn't set up yet — paste an image URL for now, or ask about enabling direct upload.
        </p>
      )}
    </div>
  );
}

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
function VariantManager({ productId, token, onStockChanged }) {
  const [variants, setVariants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [newVariant, setNewVariant] = useState({ size: "", color: "", price: "", stock: "", sku: "", image: "" });
  const [savingNew, setSavingNew] = useState(false);
  const [editingImageFor, setEditingImageFor] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch(`/products/${productId}`)
      .then((p) => setVariants(p.variants || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [productId]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!newVariant.size && !newVariant.color) {
      setError("Enter at least a size or a color for the variant.");
      return;
    }
    setSavingNew(true); setError("");
    try {
      await apiFetch(`/products/${productId}/variants`, {
        method: "POST",
        token,
        body: {
          ...newVariant,
          price: newVariant.price || undefined,
          stock: Number(newVariant.stock) || 0,
        },
      });
      setNewVariant({ size: "", color: "", price: "", stock: "", sku: "", image: "" });
      setAdding(false);
      load();
      onStockChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingNew(false);
    }
  };

  const handleUpdateStock = async (variant, stock) => {
    try {
      await apiFetch(`/products/variants/${variant.id}`, { method: "PUT", token, body: { stock: Number(stock) } });
      load();
      onStockChanged?.();
    } catch (e) {
      alert(e.message);
    }
  };

  const handleUpdateImage = async (variantId, image) => {
    try {
      await apiFetch(`/products/variants/${variantId}`, { method: "PUT", token, body: { image } });
      setEditingImageFor(null);
      load();
    } catch (e) {
      alert(e.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this variant?")) return;
    try {
      await apiFetch(`/products/variants/${id}`, { method: "DELETE", token });
      load();
      onStockChanged?.();
    } catch (e) {
      alert(e.message);
    }
  };

  return (
    <div className="admin-variant-manager">
      <div className="admin-panel-title" style={{ fontSize: "0.92rem", marginTop: 4 }}>
        Variants (size / color combinations)
        <button className="admin-btn admin-btn-outline admin-btn-sm" onClick={() => setAdding((a) => !a)}>
          {adding ? "Cancel" : "+ Add Variant"}
        </button>
      </div>

      {error && <div className="admin-form-error">⚠️ {error}</div>}

      {adding && (
        <div className="admin-variant-add-block">
          <div className="admin-variant-add-row">
            <input placeholder="Size (e.g. M)" value={newVariant.size} onChange={(e) => setNewVariant((v) => ({ ...v, size: e.target.value }))} />
            <input placeholder="Color (e.g. #2c3e50)" value={newVariant.color} onChange={(e) => setNewVariant((v) => ({ ...v, color: e.target.value }))} />
            <input type="number" placeholder="Price override" value={newVariant.price} onChange={(e) => setNewVariant((v) => ({ ...v, price: e.target.value }))} />
            <input type="number" placeholder="Stock" value={newVariant.stock} onChange={(e) => setNewVariant((v) => ({ ...v, stock: e.target.value }))} />
            <input placeholder="SKU (optional)" value={newVariant.sku} onChange={(e) => setNewVariant((v) => ({ ...v, sku: e.target.value }))} />
            <button className="admin-btn admin-btn-primary admin-btn-sm" disabled={savingNew} onClick={handleAdd}>
              {savingNew ? "Adding…" : "Add"}
            </button>
          </div>
          <div style={{ marginTop: 8 }}>
            <label style={{ fontSize: "0.78rem", fontWeight: 600 }}>Image for this variant (optional)</label>
            <ImageUploader value={newVariant.image} onChange={(v) => setNewVariant((cur) => ({ ...cur, image: v }))} />
          </div>
        </div>
      )}

      {loading ? <p className="admin-loading" style={{ padding: 12 }}>Loading variants…</p> : variants.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontSize: "0.82rem", padding: "8px 0" }}>
          No variants yet — this product uses its own single price/stock. Add a variant above if it comes in multiple sizes/colors.
        </p>
      ) : (
        <table className="admin-table" style={{ marginTop: 8 }}>
          <thead><tr><th></th><th>Size</th><th>Color</th><th>Price</th><th>Stock</th><th>SKU</th><th></th></tr></thead>
          <tbody>
            {variants.map((v) => (
              <React.Fragment key={v.id}>
                <tr>
                  <td>
                    {v.image
                      ? <img src={v.image} alt="" className="admin-thumb" />
                      : <span style={{ color: "var(--text-muted)", fontSize: "0.72rem" }}>—</span>}
                  </td>
                  <td>{v.size || "—"}</td>
                  <td>{v.color ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 14, height: 14, borderRadius: "50%", background: v.color, display: "inline-block", border: "1px solid #ddd" }} />{v.color}</span> : "—"}</td>
                  <td>{v.price ? `₹${v.price}` : <span style={{ color: "var(--text-muted)" }}>base price</span>}</td>
                  <td>
                    <input type="number" defaultValue={v.stock} style={{ width: 64 }}
                      onBlur={(e) => { if (Number(e.target.value) !== v.stock) handleUpdateStock(v, e.target.value); }} />
                  </td>
                  <td>{v.sku || "—"}</td>
                  <td>
                    <button className="admin-btn admin-btn-outline admin-btn-sm" style={{ marginRight: 6 }} onClick={() => setEditingImageFor(editingImageFor === v.id ? null : v.id)}>
                      {v.image ? "Change Image" : "Add Image"}
                    </button>
                    <button className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => handleDelete(v.id)}>Delete</button>
                  </td>
                </tr>
                {editingImageFor === v.id && (
                  <tr>
                    <td colSpan={7} style={{ background: "var(--surface2)" }}>
                      <ImageUploader value={v.image || ""} onChange={(img) => handleUpdateImage(v.id, img)} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// Mirrors the customer-facing nav dropdown exactly (App.js SUBCATEGORIES) — keeping this
// in sync ensures a product's sub-category always matches a real, browsable menu item.
const SUBCATEGORIES = {
  men:   [{ key:"tshirt",label:"T-Shirts"},{ key:"shirt",label:"Shirts"},{ key:"jeans",label:"Jeans"},{ key:"trousers",label:"Trousers"},{ key:"shorts",label:"Shorts"},{ key:"trackpants",label:"Track Pants"}],
  women: [{ key:"tops",label:"Tops"},{ key:"jeans",label:"Jeans"},{ key:"tshirt",label:"T-Shirts"},{ key:"skirts",label:"Skirts"},{ key:"kurtasets",label:"Kurta Sets"},{ key:"kurta",label:"Kurta"},{ key:"kurthi",label:"Kurthi"},{ key:"palazzos",label:"Palazzos"},{ key:"cottonsarees",label:"Cotton Sarees"},{ key:"cottonsilk",label:"Cotton Silk Sarees"},{ key:"designersarees",label:"Designer Sarees"},{ key:"softsilk",label:"Soft Silk Sarees"},{ key:"chiffon",label:"Chiffon Sarees"},{ key:"fancysatin",label:"Fancy Satin Sarees"},{ key:"coppersilk",label:"Copper Soft Silk Sarees"}],
  boys:  [{ key:"babyboyset",label:"Baby Boy Set"},{ key:"tshirt711",label:"T-Shirts (7–11 yrs)"},{ key:"tshirt1216",label:"T-Shirts (12–16 yrs)"},{ key:"jeans716",label:"Jeans (7–16 yrs)"},{ key:"kidsset510",label:"Kids Dress Set (5–10 yrs)"},{ key:"trouser",label:"Trousers"},{ key:"shorts",label:"Shorts"},{ key:"pants",label:"Pants"}],
  girls: [{ key:"babygirlset",label:"Baby Girls Set"},{ key:"westerndress",label:"Western Dress"},{ key:"frocks",label:"Frocks"},{ key:"tshirts",label:"T-Shirts"},{ key:"jeans",label:"Jeans"},{ key:"trousers",label:"Trousers"}],
};

function ProductForm({ initial, categories, onSave, onCancel, saving, error, token }) {
  const [form, setForm] = useState(
    initial
      ? { ...initial, originalPrice: initial.originalPrice ?? "", sizes: initial.sizes ?? "", colors: initial.colors ?? "", subcategory: initial.subcategory ?? "", images: initial.images ?? [] }
      : { name: "", description: "", price: "", originalPrice: "", stock: "", images: [], sizes: "", colors: "", subcategory: "", categoryId: categories[0]?.id || "" }
  );
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const selectedCategory = categories.find((c) => c.id === form.categoryId);
  const categoryKey = selectedCategory?.name?.toLowerCase().trim();
  const subcategoryOptions = SUBCATEGORIES[categoryKey] || [];

  const handleCategoryChange = (id) => {
    setForm((f) => ({ ...f, categoryId: id, subcategory: "" })); // reset — old sub-category may not apply to the new category
  };

  return (
    <div className="admin-modal-overlay" onClick={onCancel}>
      <div className="admin-modal-box admin-modal-box-wide" onClick={(e) => e.stopPropagation()}>
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
            <label>Original / MRP (₹, optional)</label>
            <input type="number" value={form.originalPrice} onChange={(e) => set("originalPrice", e.target.value)} placeholder="Leave blank if not on sale" />
          </div>
        </div>
        <div className="admin-form-row">
          <label>Stock {initial?.id ? "(used only if this product has no variants below)" : ""}</label>
          <input type="number" value={form.stock} onChange={(e) => set("stock", e.target.value)} />
        </div>
        <div className="admin-form-row">
          <label>Product Images {form.images.length > 0 && <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>(first image is the main thumbnail)</span>}</label>
          <ImageUploader multi value={form.images} onChange={(v) => set("images", v)} />
        </div>
        <div className="admin-two-col">
          <div className="admin-form-row">
            <label>Category</label>
            <select value={form.categoryId} onChange={(e) => handleCategoryChange(Number(e.target.value))}>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="admin-form-row">
            <label>Sub-category {subcategoryOptions.length === 0 && "(optional)"}</label>
            {subcategoryOptions.length > 0 ? (
              <select value={form.subcategory} onChange={(e) => set("subcategory", e.target.value)}>
                <option value="">— Select —</option>
                {subcategoryOptions.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            ) : (
              <input value={form.subcategory} onChange={(e) => set("subcategory", e.target.value)} placeholder="e.g. Bags, Accessories" />
            )}
          </div>
        </div>
        <div className="admin-two-col">
          <div className="admin-form-row">
            <label>Sizes hint (optional, legacy)</label>
            <input value={form.sizes} onChange={(e) => set("sizes", e.target.value)} placeholder="e.g. S,M,L,XL" />
          </div>
          <div className="admin-form-row">
            <label>Colors hint (optional, legacy)</label>
            <input value={form.colors} onChange={(e) => set("colors", e.target.value)} placeholder="e.g. #2c3e50,#c9184a" />
          </div>
        </div>
        <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: -8, marginBottom: 12 }}>
          For products with real per-size/color stock and pricing, use Variants below instead — it's more accurate for inventory and checkout.
        </p>

        {initial?.id ? (
          <VariantManager productId={initial.id} token={token} onStockChanged={() => {}} />
        ) : (
          <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", background: "var(--surface2)", padding: 10, borderRadius: 8 }}>
            Save this product first — you'll be able to add size/color variants right after.
          </p>
        )}

        <div className="admin-form-actions">
          <button className="admin-btn admin-btn-outline" onClick={onCancel}>Cancel</button>
          <button
            className="admin-btn admin-btn-primary"
            disabled={saving || form.images.length === 0}
            onClick={() => onSave({
              ...form,
              price: Number(form.price),
              originalPrice: form.originalPrice ? Number(form.originalPrice) : null,
              stock: Number(form.stock),
              categoryId: Number(form.categoryId),
              image: form.images[0] || "",
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
  const [bulkOpen, setBulkOpen] = useState(false);

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
        setEditing(null);
        load();
      } else {
        // Stay open after creating, switched into "edit" mode for the new product,
        // so the admin can immediately add size/color variants without re-opening it.
        const created = await apiFetch("/products", { method: "POST", body: form, token });
        setEditing(created);
        load();
      }
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Archive this product? It will be hidden from your storefront, but stays visible in past orders. You can bring it back anytime.")) return;
    try {
      await apiFetch(`/products/${id}`, { method: "DELETE", token });
      load();
    } catch (e) {
      alert(e.message);
    }
  };

  const handleReactivate = async (id) => {
    try {
      await apiFetch(`/products/${id}`, { method: "PUT", token, body: { active: true } });
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
        <div style={{ display: "flex", gap: 8 }}>
          <button className="admin-btn admin-btn-outline" onClick={() => setBulkOpen(true)}>⬆ Bulk Upload</button>
          <button className="admin-btn admin-btn-primary" onClick={() => setEditing({})}>+ Add Product</button>
        </div>
      </div>

      {loading ? <div className="admin-loading">Loading…</div> :
       error ? <div className="admin-form-error">⚠️ {error}</div> :
       filtered.length === 0 ? <div className="admin-empty-state">No products found.</div> : (
        <div className="admin-panel" style={{ padding: 0 }}>
          <table className="admin-table">
            <thead>
              <tr><th></th><th>Name</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} style={{ opacity: p.active === false ? 0.55 : 1 }}>
                  <td><img className="admin-thumb" src={p.image} alt="" onError={(e) => { e.target.style.visibility = "hidden"; }} /></td>
                  <td>{p.name}</td>
                  <td>{p.category?.name || "—"}</td>
                  <td>₹{p.price.toLocaleString()}</td>
                  <td>{p.stock <= 10 ? <span className="admin-badge low-stock">{p.stock}</span> : p.stock}</td>
                  <td><span className={`admin-badge ${p.active === false ? "active-no" : "active-yes"}`}>{p.active === false ? "Archived" : "Live"}</span></td>
                  <td>
                    <button className="admin-btn admin-btn-outline admin-btn-sm" style={{ marginRight: 6 }} onClick={() => setEditing(p)}>Edit</button>
                    {p.active === false ? (
                      <button className="admin-btn admin-btn-primary admin-btn-sm" onClick={() => handleReactivate(p.id)}>Reactivate</button>
                    ) : (
                      <button className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => handleDelete(p.id)}>Archive</button>
                    )}
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
          token={token}
          onCancel={() => { setEditing(null); setFormError(""); }}
          onSave={handleSave}
        />
      )}

      {bulkOpen && (
        <BulkUploadModal token={token} onClose={() => setBulkOpen(false)} onDone={() => { setBulkOpen(false); load(); }} />
      )}
    </div>
  );
}

function BulkUploadModal({ token, onClose, onDone }) {
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);

  const handleDownloadTemplate = async () => {
    setDownloadingTemplate(true);
    try {
      const res = await fetch(`${API_BASE}/products/bulk-upload/template`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to download template");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "product-upload-template.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    } finally {
      setDownloadingTemplate(false);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    setError(""); setResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => setCsvText(ev.target.result);
    reader.onerror = () => setError("Could not read that file.");
    reader.readAsText(file);
  };

  const handleUpload = async () => {
    if (!csvText) { setError("Choose a CSV file first."); return; }
    setUploading(true); setError(""); setResult(null);
    try {
      const data = await apiFetch("/products/bulk-upload", { method: "POST", token, body: { csvText } });
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal-box" onClick={(e) => e.stopPropagation()}>
        <h3>Bulk Upload Products</h3>

        <ol className="admin-bulk-steps">
          <li>
            Download the template, fill it in (one row per product, or multiple rows for
            products with several size/color variants).
            <button className="admin-btn admin-btn-outline admin-btn-sm" style={{ marginTop: 8 }} disabled={downloadingTemplate} onClick={handleDownloadTemplate}>
              {downloadingTemplate ? "Downloading…" : "⬇ Download Template (.csv)"}
            </button>
          </li>
          <li>
            Choose your completed CSV file:
            <input type="file" accept=".csv" onChange={handleFileSelect} style={{ display: "block", marginTop: 8 }} />
            {fileName && <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>Selected: {fileName}</p>}
          </li>
        </ol>

        {error && <div className="admin-form-error">⚠️ {error}</div>}

        {result && (
          <div className="admin-bulk-result">
            <p>✅ {result.productsCreated} product(s) created, {result.productsUpdated} updated, {result.variantsCreated} variant(s) added.</p>
            {result.errors.length > 0 && (
              <div>
                <p style={{ color: "#b91c1c", fontWeight: 600, marginTop: 8 }}>{result.errors.length} row group(s) had issues:</p>
                <ul style={{ fontSize: "0.8rem", color: "#b91c1c" }}>
                  {result.errors.map((err, i) => (
                    <li key={i}>{err.product} (row{err.rows.length > 1 ? "s" : ""} {err.rows.join(", ")}): {err.error}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="admin-form-actions">
          <button className="admin-btn admin-btn-outline" onClick={onClose}>{result ? "Close" : "Cancel"}</button>
          {!result && (
            <button className="admin-btn admin-btn-primary" disabled={uploading || !csvText} onClick={handleUpload}>
              {uploading ? "Uploading…" : "Upload"}
            </button>
          )}
          {result && (
            <button className="admin-btn admin-btn-primary" onClick={onDone}>Done</button>
          )}
        </div>
      </div>
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
const CUSTOM_ORDER_STATUSES = ["PENDING", "CONFIRMED", "IN_PROGRESS", "SHIPPED", "DELIVERED"];
const STANDARD_SIZES_ADMIN = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"];

function DesignForm({ initial, onSave, onCancel, saving, error }) {
  const [form, setForm] = useState(
    initial || { name: "", image: "", comboType: "Mom & Daughter", tag: "", basePrice: "", active: true }
  );
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="admin-modal-overlay" onClick={onCancel}>
      <div className="admin-modal-box" onClick={(e) => e.stopPropagation()}>
        <h3>{initial ? "Edit Design" : "New Design"}</h3>
        {error && <div className="admin-form-error">⚠️ {error}</div>}
        <div className="admin-form-row">
          <label>Name</label>
          <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Royal Peacock Silk Set" />
        </div>
        <div className="admin-form-row">
          <label>Design Image</label>
          <ImageUploader value={form.image} onChange={(v) => set("image", v)} />
        </div>
        <div className="admin-two-col">
          <div className="admin-form-row">
            <label>Combo Type</label>
            <select value={form.comboType} onChange={(e) => set("comboType", e.target.value)}>
              {["Mom & Daughter", "Sisters Combo", "Designer Blouse"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="admin-form-row">
            <label>Tag (optional)</label>
            <input value={form.tag} onChange={(e) => set("tag", e.target.value)} placeholder="e.g. New, Trending" />
          </div>
        </div>
        <div className="admin-form-row">
          <label>Fabric / Design Cost (₹)</label>
          <input type="number" value={form.basePrice} onChange={(e) => set("basePrice", e.target.value)} placeholder="e.g. 899" />
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 4 }}>
            This is the one-time fabric cost, charged once per combo request. Stitching labor is priced separately, per garment, under Stitching Fees.
          </p>
        </div>
        <div className="admin-form-actions">
          <button className="admin-btn admin-btn-outline" onClick={onCancel}>Cancel</button>
          <button
            className="admin-btn admin-btn-primary"
            disabled={saving || !form.image}
            onClick={() => onSave({ ...form, basePrice: Number(form.basePrice) })}
          >
            {saving ? "Saving…" : "Save Design"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DesignsManager({ token }) {
  const [designs, setDesigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    apiFetch("/custom-designs", { token })
      .then(setDesigns)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (form) => {
    setSaving(true); setFormError("");
    try {
      if (editing?.id) await apiFetch(`/custom-designs/${editing.id}`, { method: "PUT", body: form, token });
      else await apiFetch("/custom-designs", { method: "POST", body: form, token });
      setEditing(null);
      load();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (id) => {
    if (!window.confirm("Archive this design? It will no longer show in the customer gallery.")) return;
    try {
      await apiFetch(`/custom-designs/${id}`, { method: "DELETE", token });
      load();
    } catch (e) { alert(e.message); }
  };

  const handleReactivate = async (id) => {
    try {
      await apiFetch(`/custom-designs/${id}`, { method: "PUT", token, body: { active: true } });
      load();
    } catch (e) { alert(e.message); }
  };

  return (
    <div>
      <div className="admin-toolbar">
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>{designs.length} design(s)</p>
        <button className="admin-btn admin-btn-primary" onClick={() => setEditing({})}>+ New Design</button>
      </div>

      {loading ? <div className="admin-loading">Loading…</div> :
       error ? <div className="admin-form-error">⚠️ {error}</div> :
       designs.length === 0 ? <div className="admin-empty-state">No designs yet — add your first one.</div> : (
        <div className="admin-panel" style={{ padding: 0 }}>
          <table className="admin-table">
            <thead><tr><th></th><th>Name</th><th>Combo</th><th>Base Price</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {designs.map((d) => (
                <tr key={d.id} style={{ opacity: d.active === false ? 0.55 : 1 }}>
                  <td><img className="admin-thumb" src={d.image} alt="" onError={(e) => { e.target.style.visibility = "hidden"; }} /></td>
                  <td>{d.name}{d.tag && <span className="admin-badge active-yes" style={{ marginLeft: 6 }}>{d.tag}</span>}</td>
                  <td>{d.comboType}</td>
                  <td>₹{d.basePrice.toLocaleString()}</td>
                  <td><span className={`admin-badge ${d.active === false ? "active-no" : "active-yes"}`}>{d.active === false ? "Archived" : "Live"}</span></td>
                  <td>
                    <button className="admin-btn admin-btn-outline admin-btn-sm" style={{ marginRight: 6 }} onClick={() => setEditing(d)}>Edit</button>
                    {d.active === false
                      ? <button className="admin-btn admin-btn-primary admin-btn-sm" onClick={() => handleReactivate(d.id)}>Reactivate</button>
                      : <button className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => handleArchive(d.id)}>Archive</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing !== null && (
        <DesignForm initial={editing.id ? editing : null} saving={saving} error={formError}
          onCancel={() => { setEditing(null); setFormError(""); }} onSave={handleSave} />
      )}
    </div>
  );
}

function CustomOrderDetailsModal({ order, onClose }) {
  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal-box" onClick={(e) => e.stopPropagation()}>
        <h3>Custom Order #{order.id} — Tailoring Details</h3>

        <div className="admin-form-row">
          <label>Source</label>
          <p style={{ margin: 0 }}>
            {order.design ? `🎨 Design: ${order.design.name}` : order.sourceProduct ? `🛍️ Store Saree: ${order.sourceProduct.name}` : "🧵 Customer's own fabric"}
          </p>
        </div>

        <div className="admin-two-col">
          <div className="admin-form-row"><label>Combo Type</label><p style={{ margin: 0 }}>{order.comboType}</p></div>
          <div className="admin-form-row"><label>Fabric Cost</label><p style={{ margin: 0 }}>₹{order.fabricCost.toLocaleString()}</p></div>
        </div>

        <div className="admin-two-col">
          <div className="admin-form-row"><label>Blouse Type</label><p style={{ margin: 0 }}>{order.blouseType || "Not specified"}</p></div>
          <div className="admin-form-row"><label>Neck Pattern</label><p style={{ margin: 0 }}>{order.neckPattern || "Not specified"}</p></div>
        </div>
        <div className="admin-form-row"><label>Back Design</label><p style={{ margin: 0 }}>{order.backDesign || "Not specified"}</p></div>

        {order.referenceImage && (
          <div className="admin-form-row">
            <label>Reference Image</label>
            <img src={order.referenceImage} alt="Reference" style={{ maxWidth: "100%", borderRadius: 8, border: "1px solid var(--border)" }} />
          </div>
        )}

        <div className="admin-form-row">
          <label>Garments in This Combo ({order.recipients.length})</label>
          <table className="admin-table">
            <thead><tr><th>For</th><th>Size</th><th>Stitching Cost</th></tr></thead>
            <tbody>
              {order.recipients.map((r, i) => (
                <tr key={i}>
                  <td>{r.label}</td>
                  <td>{r.sizeMode === "standard" ? r.standardSize : (
                    <span title={JSON.stringify(r.measurements)}>Custom: {Object.entries(r.measurements || {}).map(([k, v]) => `${k}=${v}"`).join(", ")}</span>
                  )}</td>
                  <td>₹{r.stitchingCost.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {order.notes && (
          <div className="admin-form-row">
            <label>Customer Notes</label>
            <p style={{ margin: 0, background: "var(--surface2)", padding: 10, borderRadius: 8 }}>"{order.notes}"</p>
          </div>
        )}

        <div className="admin-form-actions">
          <button className="admin-btn admin-btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function CustomOrdersManager({ token }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updating, setUpdating] = useState(null);
  const [viewingOrder, setViewingOrder] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch("/custom-orders/admin/all", { token })
      .then(setOrders)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handleStatusChange = async (id, status) => {
    setUpdating(id);
    try {
      await apiFetch(`/custom-orders/${id}/status`, { method: "PUT", body: { status }, token });
      setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
    } catch (e) { alert(e.message); }
    finally { setUpdating(null); }
  };

  return (
    <div>
      {loading ? <div className="admin-loading">Loading…</div> :
       error ? <div className="admin-form-error">⚠️ {error}</div> :
       orders.length === 0 ? <div className="admin-empty-state">No custom stitch requests yet.</div> : (
        <div className="admin-panel" style={{ padding: 0 }}>
          <table className="admin-table">
            <thead><tr><th>#</th><th>Customer</th><th>Source</th><th>Combo</th><th>Garments</th><th>Price</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>#{o.id}</td>
                  <td>{o.user?.name}<br /><span style={{ color: "var(--text-muted)", fontSize: "0.78rem" }}>{o.user?.email}</span></td>
                  <td>
                    {o.design ? <span>🎨 {o.design.name}</span>
                      : o.sourceProduct ? <span>🛍️ {o.sourceProduct.name}</span>
                      : <span>🧵 Own fabric</span>}
                  </td>
                  <td>{o.comboType}</td>
                  <td>{o.recipients.map(r => r.label).join(", ")}</td>
                  <td>₹{o.price.toLocaleString()}</td>
                  <td>
                    <select className="admin-select" value={o.status} disabled={updating === o.id}
                      onChange={(e) => handleStatusChange(o.id, e.target.value)}>
                      {CUSTOM_ORDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td><button className="admin-btn admin-btn-outline admin-btn-sm" onClick={() => setViewingOrder(o)}>Details</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {viewingOrder && <CustomOrderDetailsModal order={viewingOrder} onClose={() => setViewingOrder(null)} />}
    </div>
  );
}

function StitchingFeesManager({ token }) {
  const [sizePricing, setSizePricing] = useState({});
  const [ownFabricFee, setOwnFabricFee] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiFetch("/stitching-settings")
      .then((s) => { setSizePricing(s.sizePricing || {}); setOwnFabricFee(s.ownFabricFee ?? 799); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const setFee = (size, val) => setSizePricing((p) => ({ ...p, [size]: val }));

  const handleSave = async () => {
    setSaving(true); setError(""); setSaved(false);
    try {
      const cleanPricing = {};
      Object.entries(sizePricing).forEach(([k, v]) => { if (v !== "" && v != null) cleanPricing[k] = Number(v); });
      await apiFetch("/stitching-settings", { method: "PUT", token, body: { sizePricing: cleanPricing, ownFabricFee: Number(ownFabricFee) } });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="admin-loading">Loading…</div>;

  return (
    <div className="admin-panel">
      <h3 className="admin-panel-title">Stitching Labor Cost by Size</h3>
      <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginBottom: 14 }}>
        This is charged once per garment/recipient in a combo request — on top of the one-time fabric cost.
        It applies the same way whether the fabric came from a design, a store saree, or the customer's own material.
      </p>
      {error && <div className="admin-form-error">⚠️ {error}</div>}
      <div className="admin-size-price-grid">
        {STANDARD_SIZES_ADMIN.map((s) => (
          <div key={s} className="admin-size-price-cell">
            <span>{s}</span>
            <input type="number" value={sizePricing[s] ?? ""} onChange={(e) => setFee(s, e.target.value)} placeholder="₹" />
          </div>
        ))}
      </div>
      <div className="admin-form-row" style={{ marginTop: 16, maxWidth: 280 }}>
        <label>Custom Measurement Fallback Fee (₹)</label>
        <input type="number" value={ownFabricFee} onChange={(e) => setOwnFabricFee(e.target.value)} />
        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 4 }}>
          Used when a recipient provides custom measurements instead of a standard size.
        </p>
      </div>
      <div className="admin-form-actions" style={{ justifyContent: "flex-start", marginTop: 18 }}>
        <button className="admin-btn admin-btn-primary" disabled={saving} onClick={handleSave}>
          {saving ? "Saving…" : saved ? "✓ Saved" : "Save Fees"}
        </button>
      </div>
    </div>
  );
}

function MadeForYouManager({ token }) {
  const [subTab, setSubTab] = useState("designs");
  return (
    <div>
      <h1 className="admin-page-title">Made For You</h1>
      <p className="admin-page-sub">Manage custom stitching designs and requests</p>
      <div className="admin-toolbar" style={{ marginBottom: 8 }}>
        <div className="admin-subtabs">
          <button className={`admin-subtab ${subTab === "designs" ? "active" : ""}`} onClick={() => setSubTab("designs")}>Designs</button>
          <button className={`admin-subtab ${subTab === "orders" ? "active" : ""}`} onClick={() => setSubTab("orders")}>Custom Orders</button>
          <button className={`admin-subtab ${subTab === "fees" ? "active" : ""}`} onClick={() => setSubTab("fees")}>Stitching Fees</button>
        </div>
      </div>
      {subTab === "designs" && <DesignsManager token={token} />}
      {subTab === "orders" && <CustomOrdersManager token={token} />}
      {subTab === "fees" && <StitchingFeesManager token={token} />}
    </div>
  );
}

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", icon: "📊" },
  { key: "products", label: "Products", icon: "🛍️" },
  { key: "orders", label: "Orders", icon: "📦" },
  { key: "promotions", label: "Promotions", icon: "🏷️" },
  { key: "madeforyou", label: "Made For You", icon: "🧵" },
  { key: "herobanner", label: "Hero Banner", icon: "🖼️" },
  { key: "promobanner", label: "Announcement Banner", icon: "📣" },
  { key: "categoryimages", label: "Category Images", icon: "🗂️" },
];

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY IMAGES MANAGER — lets admin swap the "Shop by Category" cards'
// default gradient+emoji design for a real photo, per category. Clearing a
// category's image reverts that one card back to the default design.
// ─────────────────────────────────────────────────────────────────────────────
const CATEGORY_DEFS = [
  { key: "men", label: "Men's Fashion", emoji: "👔" },
  { key: "women", label: "Women's Fashion", emoji: "👗" },
  { key: "boys", label: "Boys", emoji: "🧒" },
  { key: "girls", label: "Girls", emoji: "👧" },
];

function CategoryImagesManager({ token }) {
  const [images, setImages] = useState({});
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(null);
  const [savedKey, setSavedKey] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch("/category-images")
      .then((map) => { setImages(map); setDrafts(map); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (key) => {
    setSavingKey(key); setError(""); setSavedKey(null);
    try {
      const updated = await apiFetch(`/category-images/${key}`, { method: "PUT", token, body: { imageUrl: drafts[key] || null } });
      setImages((prev) => ({ ...prev, [key]: updated.imageUrl }));
      setSavedKey(key);
      setTimeout(() => setSavedKey((k) => (k === key ? null : k)), 2000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) return <div className="admin-loading">Loading…</div>;

  return (
    <div>
      <h1 className="admin-page-title">Category Images</h1>
      <p className="admin-page-sub">
        Upload a real lifestyle photo for each "Shop by Category" card. Leave one blank to keep its default gradient design.
      </p>
      {error && <div className="admin-form-error">⚠️ {error}</div>}

      {CATEGORY_DEFS.map((cat) => {
        const draft = drafts[cat.key];
        const live = images[cat.key];
        const dirty = draft !== live;
        return (
          <div className="admin-panel" key={cat.key} style={{ marginBottom: 18 }}>
            <h3 className="admin-panel-title">{cat.emoji} {cat.label}</h3>

            <div className="admin-form-row">
              <label>Category Image</label>
              <ImageUploader value={draft || ""} onChange={(url) => setDrafts((prev) => ({ ...prev, [cat.key]: url }))} />
            </div>

            <div className="admin-form-row">
              <label>Preview</label>
              <div
                style={{
                  background: draft ? `url("${draft}") center/cover no-repeat` : "linear-gradient(135deg,#1a1a2e,#16213e,#0f3460)",
                  borderRadius: 12,
                  minHeight: 140,
                  color: "#fff",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-end",
                  padding: 20,
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)" }} />
                <h4 style={{ position: "relative", margin: 0, fontFamily: "'Playfair Display', serif" }}>{cat.label}</h4>
              </div>
            </div>

            <div className="admin-form-actions" style={{ justifyContent: "flex-start", marginTop: 10, display: "flex", gap: 10 }}>
              <button className="admin-btn admin-btn-primary" disabled={savingKey === cat.key || !dirty} onClick={() => handleSave(cat.key)}>
                {savingKey === cat.key ? "Saving…" : savedKey === cat.key ? "✓ Saved" : "Save"}
              </button>
              {draft && (
                <button className="admin-btn admin-btn-outline" disabled={savingKey === cat.key} onClick={() => setDrafts((prev) => ({ ...prev, [cat.key]: null }))}>
                  Clear (use default)
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BACKGROUND EDITOR CARD — reusable background-only editor (default/image/color
// + live preview + save), shared by the hero slides manager and the promo
// banner manager below. Text/headline content is passed in as previewContent
// and is never editable here — only the background.
// ─────────────────────────────────────────────────────────────────────────────
function BackgroundEditorCard({ title, subtitle, initial, onSave, previewContent, useOverlay = true, imageHint, previewAspectRatio }) {
  const [backgroundType, setBackgroundType] = useState(initial.backgroundType || "default");
  const [backgroundImage, setBackgroundImage] = useState(initial.backgroundImage || "");
  const [backgroundColor, setBackgroundColor] = useState(initial.backgroundColor || "#1a1a2e");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    setSaving(true); setError(""); setSaved(false);
    try {
      const body = { backgroundType };
      if (backgroundType === "image") body.backgroundImage = backgroundImage;
      if (backgroundType === "color") body.backgroundColor = backgroundColor;
      await onSave(body);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const previewBg =
    backgroundType === "image" && backgroundImage
      ? `${useOverlay ? "linear-gradient(rgba(10,14,30,0.55),rgba(10,14,30,0.55)), " : ""}url("${backgroundImage}") center/cover no-repeat`
      : backgroundType === "color" && backgroundColor
      ? backgroundColor
      : initial.defaultPreviewBg;

  const canSave = backgroundType === "default"
    || (backgroundType === "image" && backgroundImage.trim())
    || (backgroundType === "color" && backgroundColor.trim());

  return (
    <div className="admin-panel" style={{ marginBottom: 18 }}>
      <h3 className="admin-panel-title">{title}</h3>
      {subtitle && <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginBottom: 14 }}>{subtitle}</p>}
      {error && <div className="admin-form-error">⚠️ {error}</div>}

      <div className="admin-form-row">
        <label>Background Source</label>
        <select value={backgroundType} onChange={(e) => setBackgroundType(e.target.value)}>
          <option value="default">Default (built-in gradient)</option>
          <option value="image">Image</option>
          <option value="color">Solid color / gradient</option>
        </select>
      </div>

      {backgroundType === "image" && (
        <div className="admin-form-row">
          <label>Image</label>
          <ImageUploader value={backgroundImage} onChange={setBackgroundImage} hint={imageHint} />
        </div>
      )}

      {backgroundType === "color" && (
        <div className="admin-form-row" style={{ maxWidth: 320 }}>
          <label>Color or CSS gradient</label>
          <input
            type="text"
            value={backgroundColor}
            onChange={(e) => setBackgroundColor(e.target.value)}
            placeholder="#1a1a2e or linear-gradient(...)"
          />
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 4 }}>
            Accepts any CSS color (e.g. <code>#c9184a</code>) or a full gradient (e.g. <code>linear-gradient(135deg,#1a1a2e,#0f3460)</code>).
          </p>
        </div>
      )}

      <div className="admin-form-row">
        <label>Preview</label>
        <div
          style={{
            background: previewBg,
            borderRadius: 12,
            padding: "32px 28px",
            color: "#fff",
            minHeight: previewAspectRatio ? undefined : 130,
            aspectRatio: previewAspectRatio || undefined,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {previewContent}
        </div>
      </div>

      <div className="admin-form-actions" style={{ justifyContent: "flex-start", marginTop: 18 }}>
        <button className="admin-btn admin-btn-primary" disabled={saving || !canSave} onClick={handleSave}>
          {saving ? "Saving…" : saved ? "✓ Saved" : "Save"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HERO SLIDES MANAGER — overrides only the background of each of the storefront's
// 3 rotating hero slides. Headline/subtext/CTA are not editable here; they stay
// hardcoded in the storefront so this can't accidentally break their wording.
// ─────────────────────────────────────────────────────────────────────────────
const HERO_SLIDE_ADMIN_DEFS = [
  { key: "slide1", label: "Slide 1 — New Season Arrivals", defaultPreviewBg: "linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%)", eyebrow: "✦ SEASON'S BEST ✦", headline: "New Season Arrivals", sub: "Discover the latest in fashion — curated just for you" },
  { key: "slide2", label: "Slide 2 — Women's Exclusive Edit", defaultPreviewBg: "linear-gradient(135deg,#2d1b4e 0%,#6b2fa0 50%,#a855f7 100%)", eyebrow: null, headline: "Women's Exclusive Edit", sub: "Elevate your style with our premium women's collection" },
  { key: "slide3", label: "Slide 3 — Men's Essentials", defaultPreviewBg: "linear-gradient(135deg,#0d2137 0%,#1a4b6e 50%,#2980b9 100%)", eyebrow: null, headline: "Men's Essentials", sub: "Smart, sharp, and effortlessly styled" },
];

function HeroSlidesManager({ token }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch("/hero-banner")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="admin-form-error">⚠️ {error}</div>;
  if (!data) return <div className="admin-loading">Loading…</div>;

  return (
    <div>
      <h1 className="admin-page-title">Hero Banner</h1>
      <p className="admin-page-sub">
        Customize the background of each homepage carousel slide individually — headline, subtext, and buttons stay the same for all three.
      </p>

      {HERO_SLIDE_ADMIN_DEFS.map((slide) => (
        <BackgroundEditorCard
          key={slide.key}
          title={slide.label}
          initial={{ ...data[slide.key], defaultPreviewBg: slide.defaultPreviewBg }}
          onSave={(body) => apiFetch(`/hero-banner/${slide.key}`, { method: "PUT", token, body })}
          previewContent={
            <>
              {slide.eyebrow && (
                <p style={{ color: "#f5a623", fontWeight: 700, fontSize: "0.75rem", letterSpacing: "0.08em", margin: "0 0 8px" }}>
                  {slide.eyebrow}
                </p>
              )}
              <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: "1.6rem", margin: "0 0 8px" }}>{slide.headline}</h2>
              <p style={{ fontSize: "0.85rem", opacity: 0.85, margin: 0 }}>{slide.sub}</p>
            </>
          }
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMO BANNER MANAGER — overrides only the background of the "End of Season
// Sale" style announcement banner. Text/badges/CTA stay hardcoded.
// ─────────────────────────────────────────────────────────────────────────────
function PromoBannerManager({ token }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch("/promo-banner")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="admin-form-error">⚠️ {error}</div>;
  if (!data) return <div className="admin-loading">Loading…</div>;

  return (
    <div>
      <h1 className="admin-page-title">Announcement Banner</h1>
      <p className="admin-page-sub">
        Customize the background of the homepage announcement banner. There's no headline or badge text here anymore —
        design that directly into your image. Only the "Shop Sale" button is rendered on top.
      </p>

      <BackgroundEditorCard
        title="Background"
        useOverlay={false}
        previewAspectRatio="4 / 1"
        imageHint="Recommended image ratio: 4:1 (e.g. 1600×400px) — the banner is wide and short, so tall or square photos will get heavily cropped."
        initial={{ ...data, defaultPreviewBg: "linear-gradient(135deg, #0d0d14 0%, #1a1a2e 50%, #2d1b4e 100%)" }}
        onSave={(body) => apiFetch("/promo-banner", { method: "PUT", token, body })}
        previewContent={
          <button
            style={{
              background: "var(--brand, #c9184a)",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "12px 28px",
              fontWeight: 700,
              fontSize: "0.9rem",
              cursor: "default",
            }}
          >
            Shop Sale
          </button>
        }
      />
    </div>
  );
}

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
          {tab === "madeforyou" && <MadeForYouManager token={admin.token} />}
          {tab === "herobanner" && <HeroSlidesManager token={admin.token} />}
          {tab === "promobanner" && <PromoBannerManager token={admin.token} />}
          {tab === "categoryimages" && <CategoryImagesManager token={admin.token} />}
        </main>
      </div>
    </div>
  );
}
