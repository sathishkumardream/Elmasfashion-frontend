import { useState, useEffect, useRef, useCallback } from "react";
import logo from "./Logo.png";
import "./App.css";

// ─────────────────────────────────────────────────────────────────────────────
// API CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const API_BASE = (process.env.REACT_APP_API_URL || "http://localhost:5000/api").replace(/\/+$/, "");

// ─────────────────────────────────────────────────────────────────────────────
// DATA NORMALISER
// Bridges gap between Prisma schema and UI needs.
// Backend:  { id, name, description, price, stock, image, categoryId, category:{id,name}, createdAt }
// UI needs: category string, originalPrice, rating, reviews, badge, colors[], sizes[], subcategory
// ─────────────────────────────────────────────────────────────────────────────
function normaliseProduct(p) {
  // category: backend returns object {id, name} — extract name string
  const categoryName =
    typeof p.category === "object" && p.category !== null
      ? p.category.name
      : typeof p.category === "string"
      ? p.category
      : "Unknown";

  // Map category name → nav key (lowercase, trimmed)
  const categoryKey = categoryName.toLowerCase().trim();

  // originalPrice: only show a "was" price if the admin actually set one (real MRP, not a fake markup)
  const originalPrice = p.originalPrice && p.originalPrice > p.price ? p.originalPrice : null;

  // rating & reviews: not in schema → use stock-seeded placeholder until you add reviews model
  const rating = p.rating ?? parseFloat((3.8 + (p.id % 12) * 0.1).toFixed(1));
  const reviews = p.reviews ?? (p.stock * 7 + p.id * 13) % 800 + 50;

  // badge: derive from stock level or name keywords
  const badge = p.badge ?? deriveBadge(p, rating);

  // colors[]: only shown if the admin actually entered some (comma-separated hex codes)
  const colors = typeof p.colors === "string" && p.colors.trim()
    ? p.colors.split(",").map(c => c.trim()).filter(Boolean)
    : [];

  // sizes[]: only shown if the admin actually entered some (comma-separated, e.g. "S,M,L,XL")
  const sizes = typeof p.sizes === "string" && p.sizes.trim()
    ? p.sizes.split(",").map(s => s.trim()).filter(Boolean)
    : [];

  // subcategory: not in schema → can be added as a field later; default to ""
  const subcategory = p.subcategory ?? "";

  // image: prefix with API base if it's a relative path
  const image = p.image
    ? p.image.startsWith("http")
      ? p.image
      : `${API_BASE.replace("/api", "")}${p.image}`
    : "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400&q=80";

  return {
    ...p,
    categoryName,       // "Men", "Women", etc.
    categoryKey,        // "men", "women", etc.
    category: categoryName, // keep backward compat — string for display
    originalPrice,
    rating,
    reviews,
    badge,
    colors,
    sizes,
    subcategory,
    image,
    inStock: p.stock > 0,
  };
}

function deriveBadge(p, rating) {
  if (p.stock === 0) return "Out of Stock";
  if (p.stock < 5) return "Almost Gone";
  const name = p.name.toLowerCase();
  if (name.includes("new") || name.includes("latest")) return "New";
  if (rating >= 4.7) return "Bestseller";
  if (p.stock > 100) return "Hot";
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// API HOOKS
// ─────────────────────────────────────────────────────────────────────────────
function useProducts() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [prodRes, catRes] = await Promise.all([
        fetch(`${API_BASE}/products`),
        fetch(`${API_BASE}/categories`),
      ]);

      if (!prodRes.ok) throw new Error(`Products API error: ${prodRes.status}`);
      if (!catRes.ok) throw new Error(`Categories API error: ${catRes.status}`);

      const [prodData, catData] = await Promise.all([
        prodRes.json(),
        catRes.json(),
      ]);

      // Handle both { products: [] } and [] shapes
      const rawProducts = Array.isArray(prodData)
        ? prodData
        : prodData.products ?? prodData.data ?? [];

      const rawCats = Array.isArray(catData)
        ? catData
        : catData.categories ?? catData.data ?? [];

      setProducts(rawProducts.map(normaliseProduct));
      setCategories(rawCats);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  return { products, categories, loading, error, refetch: fetchAll };
}

async function apiAddToCart(productId, qty, token) {
  const res = await fetch(`${API_BASE}/cart`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ productId, quantity: qty }),
  });
  if (!res.ok) throw new Error(`Cart error: ${res.status}`);
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// STATIC DATA
// ─────────────────────────────────────────────────────────────────────────────
const SUBCATEGORIES = {
  men:   [{ key:"tshirt",label:"T-Shirts"},{ key:"shirt",label:"Shirts"},{ key:"jeans",label:"Jeans"},{ key:"trousers",label:"Trousers"},{ key:"shorts",label:"Shorts"},{ key:"trackpants",label:"Track Pants"}],
  women: [{ key:"tops",label:"Tops"},{ key:"jeans",label:"Jeans"},{ key:"tshirt",label:"T-Shirts"},{ key:"skirts",label:"Skirts"},{ key:"kurtasets",label:"Kurta Sets"},{ key:"kurta",label:"Kurta"},{ key:"kurthi",label:"Kurthi"},{ key:"palazzos",label:"Palazzos"},{ key:"cottonsarees",label:"Cotton Sarees"},{ key:"cottonsilk",label:"Cotton Silk Sarees"},{ key:"designersarees",label:"Designer Sarees"},{ key:"softsilk",label:"Soft Silk Sarees"},{ key:"chiffon",label:"Chiffon Sarees"},{ key:"fancysatin",label:"Fancy Satin Sarees"},{ key:"coppersilk",label:"Copper Soft Silk Sarees"}],
  boys:  [{ key:"babyboyset",label:"Baby Boy Set"},{ key:"tshirt711",label:"T-Shirts (7–11 yrs)"},{ key:"tshirt1216",label:"T-Shirts (12–16 yrs)"},{ key:"jeans716",label:"Jeans (7–16 yrs)"},{ key:"kidsset510",label:"Kids Dress Set (5–10 yrs)"},{ key:"trouser",label:"Trousers"},{ key:"shorts",label:"Shorts"},{ key:"pants",label:"Pants"}],
  girls: [{ key:"babygirlset",label:"Baby Girls Set"},{ key:"westerndress",label:"Western Dress"},{ key:"frocks",label:"Frocks"},{ key:"tshirts",label:"T-Shirts"},{ key:"jeans",label:"Jeans"},{ key:"trousers",label:"Trousers"}],
};

const NAV_LINKS = [
  { key:"home",         label:"Home",          dropdown:false },
  { key:"collection",   label:"Collections",   dropdown:false },
  { key:"men",          label:"Men",           dropdown:true  },
  { key:"women",        label:"Women",         dropdown:true  },
  { key:"boys",         label:"Boys",          dropdown:true  },
  { key:"girls",        label:"Girls",         dropdown:true  },
  { key:"madejustforyou",label:"✦ Made For You",dropdown:false, special:true },
];

const PRICE_RANGES = [
  { label:"Under ₹500",    min:0,    max:500   },
  { label:"₹500 – ₹1000",  min:500,  max:1000  },
  { label:"₹1000 – ₹2000", min:1000, max:2000  },
  { label:"₹2000 – ₹3500", min:2000, max:3500  },
  { label:"Above ₹3500",   min:3500, max:Infinity },
];

const SORT_OPTIONS = [
  { value:"popular",   label:"Most Popular"       },
  { value:"price_asc", label:"Price: Low to High" },
  { value:"price_desc",label:"Price: High to Low" },
  { value:"rating",    label:"Top Rated"          },
  { value:"newest",    label:"Newest First"       },
];

const DESIGNS = [
  { id:"d1", name:"Royal Kanjivaram Set",  combo:"Mom & Daughter", image:"https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=500&q=80", tag:"Popular"   },
  { id:"d2", name:"Pastel Linen Coord",    combo:"Sisters Combo",  image:"https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=500&q=80", tag:"New"       },
  { id:"d3", name:"Brocade Blouse Design", combo:"Designer Blouse",image:"https://images.unsplash.com/photo-1585487000160-6ebcfceb0d03?w=500&q=80", tag:"Trending"  },
  { id:"d4", name:"Silk Bandhani Combo",   combo:"Mom & Daughter", image:"https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?w=500&q=80", tag:"Bestseller"},
  { id:"d5", name:"Chikankari Elegance",   combo:"Sisters Combo",  image:"https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?w=500&q=80", tag:"Popular"   },
  { id:"d6", name:"Zardosi Blouse Art",    combo:"Designer Blouse",image:"https://images.unsplash.com/photo-1591195853828-11db59a44f43?w=500&q=80", tag:"Premium"   },
];

const STANDARD_SIZES = ["XS (32)","S (34)","M (36)","L (38)","XL (40)","XXL (42)","XXXL (44)"];

// ─────────────────────────────────────────────────────────────────────────────
// SMALL COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
function Stars({ rating }) {
  return (
    <span className="stars">
      {[1,2,3,4,5].map(i => (
        <span key={i} style={{ color: i <= Math.round(rating) ? "#f5a623" : "#d0d0d0" }}>★</span>
      ))}
    </span>
  );
}

function LoadingGrid() {
  return (
    <div className="products-grid">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="product-card skeleton-card">
          <div className="skeleton skeleton-img" />
          <div className="card-body">
            <div className="skeleton skeleton-line short" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line medium" />
            <div className="skeleton skeleton-line short" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ErrorBanner({ message, onRetry }) {
  return (
    <div className="error-banner">
      <span>⚠️</span>
      <div>
        <p className="error-title">Could not load products</p>
        <p className="error-msg">{message}</p>
      </div>
      <button className="error-retry" onClick={onRetry}>↻ Retry</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCT CARD
// Safely reads normalised product — no field will be undefined.
// ─────────────────────────────────────────────────────────────────────────────
function ProductCard({ product, onView, onWishlist, wishlist, onAddToCart }) {
  const isWished = wishlist.includes(product.id);
  const hasDiscount = product.originalPrice > product.price;
  const discount = hasDiscount
    ? Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)
    : 0;

  // Safe category display
  const catDisplay = typeof product.category === "string"
    ? product.category
    : product.category?.name ?? "—";

  return (
    <div className={`product-card ${!product.inStock ? "out-of-stock" : ""}`}
      onClick={() => onView(product)}>
      <div className="card-image-wrap">
        <img
          src={product.image}
          alt={product.name}
          className="card-img"
          loading="lazy"
          onError={e => {
            e.target.onerror = null;
            e.target.src = "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400&q=80";
          }}
        />
        {product.badge && (
          <span className={`card-badge ${product.badge === "Out of Stock" ? "badge-oos" : ""}`}>
            {product.badge}
          </span>
        )}
        {hasDiscount && discount > 0 && (
          <span className="card-discount">-{discount}%</span>
        )}
        <button
          className={`wishlist-btn ${isWished ? "wished" : ""}`}
          onClick={e => { e.stopPropagation(); onWishlist(product.id); }}
          aria-label="Wishlist"
        >
          {isWished ? "♥" : "♡"}
        </button>
        {!product.inStock && <div className="oos-overlay">Out of Stock</div>}
      </div>

      <div className="card-body">
        <p className="card-category">{catDisplay.toUpperCase()}</p>
        <h3 className="card-name">{product.name}</h3>

        {/* Description snippet — comes from real backend */}
        {product.description && (
          <p className="card-desc">{product.description.slice(0, 60)}{product.description.length > 60 ? "…" : ""}</p>
        )}

        <div className="card-rating">
          <Stars rating={product.rating} />
          <span className="review-count">({product.reviews})</span>
        </div>

        <div className="card-pricing">
          <span className="card-price">₹{product.price.toLocaleString()}</span>
          {hasDiscount && (
            <span className="card-original">₹{product.originalPrice.toLocaleString()}</span>
          )}
        </div>

        <div className="card-stock-info">
          {product.stock > 0 && product.stock <= 10 && (
            <span className="low-stock">Only {product.stock} left!</span>
          )}
        </div>

        {product.colors.length > 0 && (
          <div className="card-colors">
            {product.colors.slice(0, 4).map((c, i) => (
              <span key={i} className="color-dot"
                style={{ background: c, border: c === "#fff" ? "1px solid #ccc" : "none" }} />
            ))}
          </div>
        )}

        <button
          className="add-cart-btn"
          disabled={!product.inStock}
          onClick={e => { e.stopPropagation(); onAddToCart(product, 1); }}
        >
          {product.inStock ? "Add to Cart" : "Out of Stock"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCT MODAL
// Fixed to handle real backend shape safely.
// ─────────────────────────────────────────────────────────────────────────────
function ProductModal({ product, onClose, onWishlist, wishlist, onAddToCart, onBuyNow }) {
  const [selSize, setSelSize] = useState(null);
  const [selColor, setSelColor] = useState(0);
  const [qty, setQty] = useState(1);
  const [cartMsg, setCartMsg] = useState(null); // success/error feedback

  const isWished = wishlist.includes(product.id);

  // ── Safe field reads (backend may not have these) ──
  const catDisplay = typeof product.category === "string"
    ? product.category
    : product.category?.name ?? "—";

  const hasDiscount = product.originalPrice > product.price;
  const discount = hasDiscount
    ? Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)
    : 0;

  const colors  = Array.isArray(product.colors) ? product.colors : [];
  const sizes   = Array.isArray(product.sizes)  ? product.sizes  : [];

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const handleAddToCart = async () => {
    setCartMsg(null);
    try {
      await onAddToCart(product, qty);
      setCartMsg({ type: "success", text: "✓ Added to cart!" });
    } catch (err) {
      setCartMsg({ type: "error", text: err.message || "Failed to add to cart" });
    }
    setTimeout(() => setCartMsg(null), 2500);
  };

  const handleBuyNow = async () => {
    setCartMsg(null);
    try {
      await onAddToCart(product, qty);
      onBuyNow();
    } catch (err) {
      setCartMsg({ type: "error", text: err.message || "Failed to add to cart" });
      setTimeout(() => setCartMsg(null), 2500);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>

        <div className="modal-content">
          {/* Left — Image */}
          <div className="modal-img-wrap">
            <img
              src={product.image}
              alt={product.name}
              className="modal-img"
              onError={e => {
                e.target.onerror = null;
                e.target.src = "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400&q=80";
              }}
            />
            {product.badge && (
              <span className={`card-badge ${product.badge === "Out of Stock" ? "badge-oos" : ""}`}>
                {product.badge}
              </span>
            )}
            {/* Stock pill */}
            {product.stock > 0 && product.stock <= 10 && (
              <span className="modal-stock-pill">🔥 Only {product.stock} left!</span>
            )}
          </div>

          {/* Right — Details */}
          <div className="modal-details">
            {/* Category breadcrumb */}
            <p className="modal-cat">{catDisplay.toUpperCase()}</p>

            <h2 className="modal-title">{product.name}</h2>

            {/* Description — real backend field */}
            {product.description && (
              <p className="modal-description">{product.description}</p>
            )}

            {/* Rating */}
            <div className="modal-rating">
              <Stars rating={product.rating} />
              <span className="review-count">{product.reviews} reviews</span>
            </div>

            {/* Pricing */}
            <div className="modal-pricing">
              <span className="modal-price">₹{product.price.toLocaleString()}</span>
              {hasDiscount && (
                <>
                  <span className="modal-original">₹{product.originalPrice.toLocaleString()}</span>
                  <span className="modal-saved">
                    You save ₹{(product.originalPrice - product.price).toLocaleString()} ({discount}%)
                  </span>
                </>
              )}
            </div>

            {/* Colors — UI field (not in schema yet) */}
            {colors.length > 0 && (
              <div className="modal-section">
                <p className="option-label">Color</p>
                <div className="color-options">
                  {colors.map((c, i) => (
                    <span
                      key={i}
                      className={`color-dot lg ${selColor === i ? "selected" : ""}`}
                      style={{ background: c, border: c === "#fff" ? "1px solid #ccc" : "none" }}
                      onClick={() => setSelColor(i)}
                      title={`Color ${i + 1}`}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Sizes — UI field (not in schema yet) */}
            {sizes.length > 0 && (
              <div className="modal-section">
                <p className="option-label">
                  Size&nbsp;
                  <button type="button" className="size-guide" onClick={e => e.preventDefault()}>Size Guide</button>
                </p>
                <div className="size-options">
                  {sizes.map(s => (
                    <button
                      key={s}
                      className={`size-btn ${selSize === s ? "selected" : ""}`}
                      onClick={() => setSelSize(s)}
                    >{s}</button>
                  ))}
                </div>
                {sizes.length > 0 && !selSize && (
                  <p className="size-hint">Please select a size</p>
                )}
              </div>
            )}

            {/* Quantity */}
            <div className="modal-section qty-row">
              <p className="option-label">Quantity</p>
              <div className="qty-control">
                <button onClick={() => setQty(q => Math.max(1, q - 1))}>−</button>
                <span>{qty}</span>
                <button onClick={() => setQty(q => Math.min(product.stock || 99, q + 1))}>+</button>
              </div>
              {/* Live stock info from backend */}
              <span className="stock-count">
                {product.stock > 0
                  ? `${product.stock} in stock`
                  : <span style={{ color:"#ef4444" }}>Out of stock</span>}
              </span>
            </div>

            {/* Cart message feedback */}
            {cartMsg && (
              <div className={`cart-feedback ${cartMsg.type}`}>{cartMsg.text}</div>
            )}

            {/* Actions */}
            <div className="modal-actions">
              <button
                className="btn-cart"
                onClick={handleAddToCart}
                disabled={!product.inStock}
              >
                🛒 Add to Cart
              </button>
              <button
                className="btn-buy"
                disabled={!product.inStock}
                onClick={handleBuyNow}
              >
                ⚡ Buy Now
              </button>
              <button
                className={`btn-wish ${isWished ? "wished" : ""}`}
                onClick={() => onWishlist(product.id)}
              >
                {isWished ? "♥" : "♡"}
              </button>
            </div>

            {/* Perks */}
            <div className="modal-perks">
              <span>🚚 Free Delivery above ₹999</span>
              <span>↩️ 7-Day Returns</span>
              <span>✅ 100% Genuine</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NAV DROPDOWN
// ─────────────────────────────────────────────────────────────────────────────
function NavDropdown({ category, onSelect }) {
  const subs = SUBCATEGORIES[category] || [];
  const half = Math.ceil(subs.length / 2);
  return (
    <div className="nav-dropdown">
      <div className="nav-dropdown-inner">
        <p className="dropdown-heading">{category.charAt(0).toUpperCase() + category.slice(1)}'s Categories</p>
        <div className="dropdown-cols">
          <ul className="dropdown-list">
            {subs.slice(0, half).map(s => (
              <li key={s.key}>
                <button className="dropdown-item" onClick={() => onSelect(category, s.key)}>
                  <span className="dropdown-dot" />{s.label}
                </button>
              </li>
            ))}
          </ul>
          {subs.slice(half).length > 0 && (
            <ul className="dropdown-list">
              {subs.slice(half).map(s => (
                <li key={s.key}>
                  <button className="dropdown-item" onClick={() => onSelect(category, s.key)}>
                    <span className="dropdown-dot" />{s.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button className="dropdown-view-all" onClick={() => onSelect(category, null)}>
          View All {category.charAt(0).toUpperCase() + category.slice(1)} →
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MADE JUST FOR YOU
// ─────────────────────────────────────────────────────────────────────────────
function MadeJustForYou({ onAddCustom }) {
  const [selectedDesign, setSelectedDesign] = useState(null);
  const [comboType, setComboType] = useState("Mom & Daughter");
  const [fabricType, setFabricType] = useState("select");
  const [fabricChoice, setFabricChoice] = useState("");
  const [sizeMode, setSizeMode] = useState("standard");
  const [stdSize, setStdSize] = useState("");
  const [measurements, setMeasurements] = useState({ chest:"", waist:"", hip:"", length:"", shoulder:"" });
  const [notes, setNotes] = useState("");
  const [cartAdded, setCartAdded] = useState(false);
  const panelRef = useRef(null);
  const setM = (k, v) => setMeasurements(m => ({ ...m, [k]: v }));

  const handleCustomize = (design) => {
    setSelectedDesign(design);
    setComboType(design.combo);
    setCartAdded(false);
    setTimeout(() => panelRef.current?.scrollIntoView({ behavior:"smooth", block:"start" }), 100);
  };

  return (
    <div className="mjfy-page">
      <div className="mjfy-hero">
        <div className="mjfy-hero-content">
          <p className="mjfy-eyebrow">✦ Exclusive Service ✦</p>
          <h1 className="mjfy-title">Made Just for You</h1>
          <p className="mjfy-sub">Create beautiful matching outfits from sarees for your loved ones.<br />Choose a design, customize it, and we'll stitch it just for you.</p>
          <div className="mjfy-badges">
            <span>🪡 Expert Stitching</span>
            <span>📏 Custom Measurements</span>
            <span>🚚 10–15 Days Delivery</span>
          </div>
        </div>
        <div className="mjfy-hero-deco">
          <div className="mjfy-deco-circle c1"/><div className="mjfy-deco-circle c2"/>
          <span className="mjfy-deco-icon">🧵</span>
        </div>
      </div>

      <section className="mjfy-section">
        <div className="section-header">
          <div><h2 className="section-title">Choose Your Combo</h2><p className="section-sub">Select the type of custom outfit set</p></div>
        </div>
        <div className="combo-cards">
          {[
            { key:"Mom & Daughter", icon:"👩‍👧", desc:"Matching saree & frock/lehenga set", color:"linear-gradient(135deg,#4a0e4e,#c9184a)" },
            { key:"Sisters Combo",  icon:"👭",   desc:"Coordinated outfits from same saree",color:"linear-gradient(135deg,#0d2137,#2980b9)" },
            { key:"Designer Blouse",icon:"✂️",   desc:"Custom-stitched designer blouse",    color:"linear-gradient(135deg,#1a1a0a,#8B6914)" },
          ].map(c => (
            <div key={c.key} className={`combo-card ${comboType===c.key?"selected":""}`}
              style={{ background:c.color }} onClick={() => setComboType(c.key)}>
              <span className="combo-icon">{c.icon}</span>
              <h3>{c.key}</h3><p>{c.desc}</p>
              {comboType===c.key && <span className="combo-check">✓</span>}
            </div>
          ))}
        </div>
      </section>

      <section className="mjfy-section alt-bg">
        <div className="section-header">
          <div><h2 className="section-title">Design Gallery</h2><p className="section-sub">Pick a design to customize</p></div>
        </div>
        <div className="design-grid">
          {DESIGNS.map(d => (
            <div key={d.id} className={`design-card ${selectedDesign?.id===d.id?"selected":""}`}>
              <div className="design-img-wrap">
                <img src={d.image} alt={d.name} className="design-img" loading="lazy"/>
                <span className="design-tag">{d.tag}</span>
                <span className="design-combo-badge">{d.combo}</span>
              </div>
              <div className="design-body">
                <h4 className="design-name">{d.name}</h4>
                <button className="customize-btn" onClick={() => handleCustomize(d)}>
                  {selectedDesign?.id===d.id ? "✓ Selected" : "Customize This →"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mjfy-section" ref={panelRef}>
        <div className="section-header">
          <div>
            <h2 className="section-title">Customization Panel</h2>
            <p className="section-sub">{selectedDesign ? `Customizing: ${selectedDesign.name}` : "Select a design above to begin"}</p>
          </div>
        </div>
        <div className={`custom-panel ${!selectedDesign?"panel-disabled":""}`}>
          {!selectedDesign && (
            <div className="panel-overlay-hint">
              <span>👆</span><p>Select a design from the gallery above to unlock customization</p>
            </div>
          )}
          {selectedDesign && (
            <div className="custom-preview-bar">
              <img src={selectedDesign.image} alt="" className="preview-thumb"/>
              <div>
                <p className="preview-label">Selected Design</p>
                <p className="preview-name">{selectedDesign.name}</p>
                <span className="preview-combo">{comboType}</span>
              </div>
              <button className="preview-change" onClick={() => setSelectedDesign(null)}>✕ Change</button>
            </div>
          )}
          <div className="custom-grid">
            <div className="custom-block">
              <h4 className="custom-block-title">🧶 Choose Fabric</h4>
              <div className="fabric-options">
                {[{key:"select",label:"Select from Store",desc:"Browse our curated fabric collection"},{key:"own",label:"Use My Own Saree",desc:"We'll stitch from your provided fabric"}].map(f=>(
                  <div key={f.key} className={`fabric-option ${fabricType===f.key?"selected":""}`} onClick={()=>setFabricType(f.key)}>
                    <span className={`fabric-radio ${fabricType===f.key?"active":""}`}/>
                    <div><p className="fabric-label">{f.label}</p><p className="fabric-desc">{f.desc}</p></div>
                  </div>
                ))}
              </div>
              {fabricType==="select"&&(
                <select className="fabric-store-select" value={fabricChoice} onChange={e=>setFabricChoice(e.target.value)}>
                  <option value="">— Choose fabric type —</option>
                  {["Cotton Silk","Pure Silk (Kanjivaram)","Georgette","Chiffon","Linen","Net","Brocade"].map(f=><option key={f}>{f}</option>)}
                </select>
              )}
            </div>
            <div className="custom-block">
              <h4 className="custom-block-title">📏 Select Sizes</h4>
              <div className="size-mode-tabs">
                <button className={`size-mode-tab ${sizeMode==="standard"?"active":""}`} onClick={()=>setSizeMode("standard")}>Standard Size</button>
                <button className={`size-mode-tab ${sizeMode==="custom"?"active":""}`} onClick={()=>setSizeMode("custom")}>Custom Measurement</button>
              </div>
              {sizeMode==="standard"?(
                <select className="fabric-store-select" value={stdSize} onChange={e=>setStdSize(e.target.value)}>
                  <option value="">— Select standard size —</option>
                  {STANDARD_SIZES.map(s=><option key={s}>{s}</option>)}
                </select>
              ):(
                <div className="measurement-form">
                  {[{key:"chest",label:"Chest (in)"},{key:"waist",label:"Waist (in)"},{key:"hip",label:"Hip (in)"},{key:"length",label:"Length (in)"},{key:"shoulder",label:"Shoulder (in)"}].map(f=>(
                    <div key={f.key} className="measurement-field">
                      <label>{f.label}</label>
                      <input type="number" placeholder="e.g. 36" value={measurements[f.key]} onChange={e=>setM(f.key,e.target.value)} className="measurement-input"/>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="custom-block full-width">
            <h4 className="custom-block-title">📝 Add Notes <span className="optional-tag">Optional</span></h4>
            <textarea className="notes-textarea" rows={3} placeholder="Special instructions, design preferences, colour requests..." value={notes} onChange={e=>setNotes(e.target.value)}/>
          </div>
          <div className="custom-cta-row">
            <div className="custom-cta-info">
              <p>🚚 Estimated Delivery: <strong>10–15 working days</strong></p>
              <p>✂️ Crafted by expert tailors — guaranteed satisfaction</p>
            </div>
            <button className={`custom-cta-btn ${!selectedDesign?"btn-disabled":""} ${cartAdded?"btn-added":""}`}
              onClick={()=>{ if(!selectedDesign)return; setCartAdded(true); onAddCustom&&onAddCustom(); }}
              disabled={!selectedDesign}>
              {cartAdded?"✓ Added to Cart!":"🛒 Add to Cart & Customize"}
            </button>
          </div>
        </div>
      </section>

      {cartAdded && selectedDesign && (
        <section className="mjfy-section">
          <div className="custom-cart-summary">
            <h3 className="cart-summary-title">🛍️ Your Custom Order Summary</h3>
            <div className="cart-summary-grid">
              {[
                { icon:<img src={selectedDesign.image} alt="" className="cart-thumb"/>, label:"Selected Design", value:selectedDesign.name },
                { icon:<span className="cart-summary-icon">👗</span>, label:"Combo Type", value:comboType },
                { icon:<span className="cart-summary-icon">📏</span>, label:"Measurement", value:sizeMode==="standard"?(stdSize||"Standard — not selected"):"Custom measurements provided" },
                { icon:<span className="cart-summary-icon">🚚</span>, label:"Delivery Estimate", value:"10–15 working days after confirmation" },
              ].map((row,i)=>(
                <div key={i} className="cart-summary-row">
                  {row.icon}
                  <div className="cart-info"><p className="cart-info-label">{row.label}</p><p className="cart-info-value">{row.value}</p></div>
                </div>
              ))}
            </div>
            {notes&&<div className="cart-notes"><p className="cart-info-label">Your Notes:</p><p className="cart-notes-text">"{notes}"</p></div>}
            <p className="cart-confirmation">✅ Our team will contact you within 24 hours to confirm details and pricing.</p>
          </div>
        </section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH MODAL
// ─────────────────────────────────────────────────────────────────────────────
function AuthField({ id, label, type = "text", icon, rightEl, error, value, onChange, onEnter }) {
  return (
    <div className="auth-field">
      <label className="auth-label">{label}</label>
      <div className={`auth-input-wrap ${error?"error":""}`}>
        <span className="auth-field-icon">{icon}</span>
        <input type={type} value={value} onChange={e=>onChange(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&onEnter&&onEnter()} placeholder={label}
          className="auth-input" autoComplete={id==="password"||id==="confirm"?"new-password":id}/>
        {rightEl}
      </div>
      {error&&<p className="auth-error">{error}</p>}
    </div>
  );
}

function AuthModal({ mode: initialMode, onClose, onAuth }) {
  const [mode, setMode] = useState(initialMode);
  const [form, setForm] = useState({ name:"", email:"", phone:"", password:"", confirm:"" });
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  useEffect(()=>{ document.body.style.overflow="hidden"; return ()=>{ document.body.style.overflow=""; }; },[]);
  useEffect(()=>{ setErrors({}); setForgotSent(false); },[mode]);
  const set=(k,v)=>{ setForm(f=>({...f,[k]:v})); setErrors(e=>({...e,[k]:""})); };
  const validate=()=>{
    const e={};
    if(mode==="register"&&!form.name.trim()) e.name="Full name is required";
    if(!form.email.trim()||!/\S+@\S+\.\S+/.test(form.email)) e.email="Enter a valid email";
    if(mode==="register"&&form.phone&&!/^\d{10}$/.test(form.phone)) e.phone="Enter a valid 10-digit mobile";
    if(mode!=="forgot"){
      if(!form.password) e.password="Password is required";
      else if(mode==="register"&&form.password.length<8) e.password="Minimum 8 characters";
    }
    if(mode==="register"&&form.password!==form.confirm) e.confirm="Passwords do not match";
    setErrors(e); return Object.keys(e).length===0;
  };
  const handleSubmit=async()=>{
    if(!validate()) return; setLoading(true);
    try {
      if(mode==="login"){
        const res=await fetch(`${API_BASE}/auth/login`,{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({email:form.email,password:form.password}) });
        const data=await res.json();
        if(!res.ok) throw new Error(data.message||data.error||"Login failed");
        onAuth({ name:data.user?.name||form.email.split("@")[0], email:form.email, token:data.token }); onClose();
      } else if(mode==="register"){
        const res=await fetch(`${API_BASE}/auth/register`,{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({name:form.name,email:form.email,phone:form.phone,password:form.password}) });
        const data=await res.json();
        if(!res.ok) throw new Error(data.message||data.error||"Registration failed");
        onAuth({ name:form.name, email:form.email, token:data.token }); onClose();
      } else {
        const res=await fetch(`${API_BASE}/auth/forgot-password`,{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({email:form.email}) });
        const data=await res.json();
        if(!res.ok) throw new Error(data.message||data.error||"Failed to send reset link");
        setForgotSent(true);
      }
    } catch(err){
      setErrors(e=>({...e, _general: err.message }));
    } finally { setLoading(false); }
  };
  const eyeBtn=(show,toggle)=><button type="button" className="eye-btn" onClick={toggle}>{show?"🙈":"👁️"}</button>;
  return (
    <div className="modal-overlay auth-overlay" onClick={onClose}>
      <div className="auth-box" onClick={e=>e.stopPropagation()}>
        <div className="auth-panel-left">
          <div className="auth-brand"><span className="auth-brand-icon">✦</span><h2>ELMA'S FASHION</h2></div>
          <p className="auth-tagline">Your style, your story.</p>
          <ul className="auth-perks">
            {["Exclusive member discounts","Early access to new arrivals","Easy order tracking","Personalised recommendations"].map(p=>(
              <li key={p}><span>✓</span>{p}</li>
            ))}
          </ul>
          <div className="auth-decoration"><div className="auth-circle c1"/><div className="auth-circle c2"/></div>
        </div>
        <div className="auth-panel-right">
          <button className="modal-close" onClick={onClose}>✕</button>
          {mode!=="forgot"&&(
            <div className="auth-tabs">
              <button className={`auth-tab ${mode==="login"?"active":""}`} onClick={()=>setMode("login")}>Sign In</button>
              <button className={`auth-tab ${mode==="register"?"active":""}`} onClick={()=>setMode("register")}>Register</button>
            </div>
          )}
          {errors._general&&<div className="auth-general-error">⚠️ {errors._general}</div>}
          {mode==="login"&&(
            <div className="auth-form">
              <h3 className="auth-form-title">Welcome back 👋</h3>
              <p className="auth-form-sub">Sign in to continue shopping</p>
              <AuthField id="email" label="Email Address" icon="📧" error={errors.email} value={form.email} onChange={v=>set("email",v)} onEnter={handleSubmit}/>
              <AuthField id="password" label="Password" type={showPass?"text":"password"} icon="🔒" rightEl={eyeBtn(showPass,()=>setShowPass(s=>!s))} error={errors.password} value={form.password} onChange={v=>set("password",v)} onEnter={handleSubmit}/>
              <div className="auth-row">
                <label className="auth-check"><input type="checkbox"/> Remember me</label>
                <button className="auth-link" onClick={()=>setMode("forgot")}>Forgot Password?</button>
              </div>
              <button className={`auth-submit-btn ${loading?"loading":""}`} onClick={handleSubmit} disabled={loading}>
                {loading?<span className="auth-spinner"/>:"Sign In →"}
              </button>
              <div className="auth-divider"><span>or continue with</span></div>
              <div className="social-auth">
                <button className="social-auth-btn">🇬 Google</button>
                <button className="social-auth-btn">📘 Facebook</button>
              </div>
              <p className="auth-switch">Don't have an account? <button className="auth-link bold" onClick={()=>setMode("register")}>Register now</button></p>
            </div>
          )}
          {mode==="register"&&(
            <div className="auth-form">
              <h3 className="auth-form-title">Create account ✨</h3>
              <p className="auth-form-sub">Join Elma's Fashion for exclusive benefits</p>
              <AuthField id="name" label="Full Name" icon="👤" error={errors.name} value={form.name} onChange={v=>set("name",v)} onEnter={handleSubmit}/>
              <AuthField id="email" label="Email Address" icon="📧" error={errors.email} value={form.email} onChange={v=>set("email",v)} onEnter={handleSubmit}/>
              <AuthField id="phone" label="Mobile Number (optional)" icon="📱" error={errors.phone} value={form.phone} onChange={v=>set("phone",v)} onEnter={handleSubmit}/>
              <AuthField id="password" label="Password" type={showPass?"text":"password"} icon="🔒" rightEl={eyeBtn(showPass,()=>setShowPass(s=>!s))} error={errors.password} value={form.password} onChange={v=>set("password",v)} onEnter={handleSubmit}/>
              <AuthField id="confirm" label="Confirm Password" type={showConfirm?"text":"password"} icon="🔒" rightEl={eyeBtn(showConfirm,()=>setShowConfirm(s=>!s))} error={errors.confirm} value={form.confirm} onChange={v=>set("confirm",v)} onEnter={handleSubmit}/>
              {form.password&&(
                <div className="pass-strength">
                  {["w","f","s","vs"].map((l,i)=>{
                    const str=form.password.length<6?0:form.password.length<8?1:/[A-Z]/.test(form.password)&&/\d/.test(form.password)?3:2;
                    return <div key={l} className={`strength-bar ${i<=str?`s${str}`:""}`}/>;
                  })}
                  <span className="strength-label">{["Weak","Fair","Strong","Very Strong"][Math.min(3,form.password.length<6?0:form.password.length<8?1:/[A-Z]/.test(form.password)&&/\d/.test(form.password)?3:2)]}</span>
                </div>
              )}
              <p className="auth-terms">By registering you agree to our <span className="auth-link bold">Terms</span> and <span className="auth-link bold">Privacy Policy</span>.</p>
              <button className={`auth-submit-btn ${loading?"loading":""}`} onClick={handleSubmit} disabled={loading}>
                {loading?<span className="auth-spinner"/>:"Create Account →"}
              </button>
              <p className="auth-switch">Already have an account? <button className="auth-link bold" onClick={()=>setMode("login")}>Sign in</button></p>
            </div>
          )}
          {mode==="forgot"&&(
            <div className="auth-form">
              <button className="back-btn" onClick={()=>setMode("login")}>← Back to Sign In</button>
              {!forgotSent?(
                <>
                  <h3 className="auth-form-title">Reset Password 🔑</h3>
                  <p className="auth-form-sub">Enter your registered email and we'll send a reset link.</p>
                  <AuthField id="email" label="Email Address" icon="📧" error={errors.email} value={form.email} onChange={v=>set("email",v)} onEnter={handleSubmit}/>
                  <button className={`auth-submit-btn ${loading?"loading":""}`} onClick={handleSubmit} disabled={loading}>
                    {loading?<span className="auth-spinner"/>:"Send Reset Link →"}
                  </button>
                </>
              ):(
                <div className="forgot-success">
                  <div className="success-icon">✉️</div>
                  <h3>Check your email!</h3>
                  <p>Reset link sent to <strong>{form.email}</strong>.</p>
                  <p className="auth-form-sub">Didn't get it? <button className="auth-link bold" onClick={()=>setForgotSent(false)}>Try again</button>.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// USER DROPDOWN
// ─────────────────────────────────────────────────────────────────────────────
function UserDropdown({ user, onLogout, onClose, onNavigate }) {
  useEffect(()=>{ const h=()=>onClose(); document.addEventListener("click",h); return()=>document.removeEventListener("click",h); },[onClose]);
  return (
    <div className="user-dropdown" onClick={e=>e.stopPropagation()}>
      <div className="user-dropdown-header">
        <div className="user-avatar-lg">{user.name[0].toUpperCase()}</div>
        <div><p className="user-dropdown-name">{user.name}</p><p className="user-dropdown-email">{user.email}</p></div>
      </div>
      <div className="user-dropdown-divider"/>
      {[{icon:"📦",label:"My Orders",tab:"myorders"},{icon:"🧵",label:"My Custom Orders"},{icon:"♥",label:"Wishlist",tab:"wishlist"},{icon:"📍",label:"Saved Addresses"},{icon:"💳",label:"Payment Methods"},{icon:"⚙️",label:"Account Settings"}].map(item=>(
        <button key={item.label} className="user-dropdown-item" onClick={item.tab ? ()=>{ onNavigate(item.tab); onClose(); } : undefined}>
          <span>{item.icon}</span>{item.label}
        </button>
      ))}
      <div className="user-dropdown-divider"/>
      <button className="user-dropdown-item logout" onClick={onLogout}><span>🚪</span>Sign Out</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CART PAGE
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// MY ORDERS (order history)
// ─────────────────────────────────────────────────────────────────────────────
const ORDER_STATUS_STEPS = ["PENDING", "PAID", "SHIPPED", "DELIVERED"];

function MyOrdersPage({ user, onBrowse }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const load = useCallback(() => {
    if (!user?.token) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/orders`, { headers: { Authorization: `Bearer ${user.token}` } })
      .then(async res => {
        const data = await res.json().catch(() => ([]));
        if (!res.ok) throw new Error(data.error || data.message || "Failed to load orders");
        return data;
      })
      .then(setOrders)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [user?.token]);

  useEffect(() => { load(); }, [load]);

  if (!user) {
    return (
      <div className="no-results">
        <p>🔒</p><h3>Please sign in</h3>
        <p>Sign in to view your order history.</p>
      </div>
    );
  }

  if (loading) return <LoadingGrid/>;
  if (error) return <ErrorBanner message={error} onRetry={load}/>;

  if (orders.length === 0) {
    return (
      <div className="no-results">
        <p>📦</p><h3>No orders yet</h3>
        <p>Once you place an order, it'll show up here.</p>
        <button className="cta-primary" onClick={onBrowse}>Start Shopping</button>
      </div>
    );
  }

  return (
    <div className="my-orders-page">
      <div className="wishlist-header">
        <h2>My Orders</h2>
        <p>{orders.length} order{orders.length !== 1 ? "s" : ""}</p>
      </div>
      <div className="orders-list">
        {orders.map(order => {
          const isOpen = expandedId === order.id;
          const stepIndex = ORDER_STATUS_STEPS.indexOf(order.status);
          return (
            <div key={order.id} className="order-card">
              <button className="order-card-header" onClick={() => setExpandedId(isOpen ? null : order.id)}>
                <div className="order-card-main">
                  <span className="order-id">Order #ELM{String(order.id).padStart(6, "0")}</span>
                  <span className="order-date">{new Date(order.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</span>
                </div>
                <div className="order-card-meta">
                  <span className={`order-status-badge ${order.status}`}>{order.status}</span>
                  <span className="order-total">₹{order.total.toLocaleString()}</span>
                  <span className="order-expand-icon">{isOpen ? "▲" : "▼"}</span>
                </div>
              </button>

              {isOpen && (
                <div className="order-card-body">
                  <div className="order-progress">
                    {ORDER_STATUS_STEPS.map((step, i) => (
                      <div key={step} className={`order-progress-step ${i <= stepIndex ? "done" : ""}`}>
                        <span className="order-progress-dot"/>
                        <span className="order-progress-label">{step}</span>
                      </div>
                    ))}
                  </div>

                  <div className="order-items-list">
                    {order.orderItems.map(item => (
                      <div key={item.id} className="order-item-row">
                        <img src={item.product?.image} alt="" onError={e => { e.target.style.visibility = "hidden"; }}/>
                        <div className="order-item-info">
                          <span className="order-item-name">{item.product?.name || "Product no longer available"}</span>
                          <span className="order-item-qty">Qty: {item.quantity} × ₹{item.price.toLocaleString()}</span>
                        </div>
                        <span className="order-item-total">₹{(item.quantity * item.price).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>

                  <div className="order-summary-box">
                    <div className="order-summary-row"><span>Subtotal</span><span>₹{order.subtotal.toLocaleString()}</span></div>
                    {order.discount > 0 && <div className="order-summary-row discount"><span>Discount</span><span>-₹{order.discount.toLocaleString()}</span></div>}
                    <div className="order-summary-row"><span>Shipping</span><span>{order.shippingFee > 0 ? `₹${order.shippingFee}` : "Free"}</span></div>
                    <div className="order-summary-row total"><span>Total</span><span>₹{order.total.toLocaleString()}</span></div>
                  </div>

                  {order.shippingLine1 && (
                    <div className="order-shipping-box">
                      <h4>Shipping Address</h4>
                      <p>{order.shippingName} · {order.shippingPhone}</p>
                      <p>{order.shippingLine1}{order.shippingLine2 ? `, ${order.shippingLine2}` : ""}</p>
                      <p>{order.shippingCity}, {order.shippingState} {order.shippingPincode}</p>
                    </div>
                  )}

                  <p className="order-payment-method">Payment: {order.paymentMethod}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CartPage({ cartItems, onUpdateQty, onRemove, onClearCart, onContinue, onCheckout, onGoToOrders, user }) {
  const cartCount = cartItems.reduce((sum, item) => sum + item.qty, 0);
  const [couponCode, setCouponCode] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState(null); // { code, type, value, discount, waiveShipping }
  const [couponError, setCouponError] = useState("");
  const [couponSuccess, setCouponSuccess] = useState("");
  const [couponChecking, setCouponChecking] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState("cart"); // cart | address | payment | success
  const [address, setAddress] = useState({ name:"", phone:"", line1:"", line2:"", city:"", state:"", pincode:"" });
  const [payMethod, setPayMethod] = useState("cod");
  const [placing, setPlacing] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [placedOrder, setPlacedOrder] = useState(null);

  const FREE_SHIP_THRESHOLD = 999;

  // ── Totals ──
  const subtotal     = cartItems.reduce((s, i) => s + i.product.price * i.qty, 0);
  const totalSavings = cartItems.reduce((s, i) => s + ((i.product.originalPrice || i.product.price) - i.product.price) * i.qty, 0);
  const shippingFee  = (appliedCoupon?.waiveShipping || subtotal >= FREE_SHIP_THRESHOLD) ? 0 : 60;
  const discount = appliedCoupon?.discount || 0;
  const total = Math.max(subtotal - discount, 0) + shippingFee;

  const applyCoupon = async () => {
    setCouponError(""); setCouponSuccess("");
    const code = couponCode.trim().toUpperCase();
    if (!code) { setCouponError("Please enter a coupon code."); return; }
    setCouponChecking(true);
    try {
      const res = await fetch(`${API_BASE}/promotions/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, subtotal }),
      });
      const data = await res.json();
      if (!res.ok) { setCouponError(data.error || "Invalid coupon code."); return; }
      setAppliedCoupon({
        code: data.promotion.code,
        type: data.promotion.type,
        value: data.promotion.value,
        discount: data.discount,
        waiveShipping: data.waiveShipping,
      });
      setCouponSuccess(`Coupon applied! You saved ₹${data.discount || 0}${data.waiveShipping ? " + free shipping" : ""}.`);
      setCouponCode("");
    } catch (err) {
      setCouponError("Could not validate coupon. Please try again.");
    } finally {
      setCouponChecking(false);
    }
  };

  const removeCoupon = () => {
    setAppliedCoupon(null); setCouponSuccess(""); setCouponError("");
  };

  const setA = (k, v) => setAddress(a => ({ ...a, [k]: v }));

  const handlePlaceOrder = async () => {
    setPlacing(true);
    setOrderError("");
    try {
      if (!user?.token) {
        throw new Error("Please sign in to place an order.");
      }
      const res = await fetch(`${API_BASE}/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${user.token}`,
        },
        body: JSON.stringify({
          couponCode: appliedCoupon?.code || undefined,
          paymentMethod: payMethod.toUpperCase(),
          address,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Failed to place order");
      setPlacedOrder(data.order);
      setCheckoutStep("success");
      onClearCart();
    } catch (err) {
      setOrderError(err.message || "Something went wrong placing your order.");
    } finally {
      setPlacing(false);
    }
  };

  // ── Empty cart ──
  if (cartItems.length === 0 && checkoutStep !== "success") {
    return (
      <div className="cart-page">
        <div className="cart-empty">
          <div className="cart-empty-icon">🛒</div>
          <h2>Your cart is empty</h2>
          <p>Looks like you haven't added anything yet.</p>
          <button className="cta-primary" onClick={onContinue}>Continue Shopping →</button>
          <div className="cart-empty-suggestions">
            <p className="suggestion-heading">You might like</p>
            <div className="suggestion-chips">
              {["Men's Fashion","Women's Sarees","Kids Wear","Made For You"].map(s=>(
                <button key={s} className="suggestion-chip" onClick={onContinue}>{s}</button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Order Success ──
  if (checkoutStep === "success") {
    const orderId = placedOrder?.id ? `ELM${String(placedOrder.id).padStart(6, "0")}` : "—";
    return (
      <div className="cart-page">
        <div className="order-success">
          <div className="success-ring">
            <div className="success-ring-inner">✓</div>
          </div>
          <h2>Order Placed Successfully!</h2>
          <p className="success-sub">Thank you for shopping with Elma's Fashion 🎉</p>
          <div className="success-order-id">Order ID: <strong>#{orderId}</strong></div>
          <div className="success-details">
            <div className="success-detail-row">
              <span>📧</span>
              <span>Confirmation sent to <strong>{user?.email || "your email"}</strong></span>
            </div>
            <div className="success-detail-row">
              <span>🚚</span>
              <span>Estimated delivery in <strong>3–5 working days</strong></span>
            </div>
            <div className="success-detail-row">
              <span>📦</span>
              <span>You can track your order in <strong>My Orders</strong></span>
            </div>
          </div>
          <div className="success-actions">
            <button className="cta-primary" onClick={onContinue}>Continue Shopping</button>
            <button className="btn-cart" style={{padding:"13px 24px",borderRadius:10,background:"var(--surface2)",color:"var(--text)"}} onClick={onGoToOrders}>Track Order</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cart-page">
      {/* Breadcrumb steps */}
      <div className="checkout-steps">
        {[
          { key:"cart",    label:"Cart",    icon:"🛒" },
          { key:"address", label:"Address", icon:"📍" },
          { key:"payment", label:"Payment", icon:"💳" },
        ].map((step, i, arr) => (
          <div key={step.key} className="checkout-step-wrap">
            <div className={`checkout-step ${checkoutStep === step.key ? "active" : ""} ${["cart","address","payment","success"].indexOf(checkoutStep) > i ? "done" : ""}`}>
              <span className="step-icon">{step.icon}</span>
              <span className="step-label">{step.label}</span>
            </div>
            {i < arr.length - 1 && <div className={`step-connector ${["cart","address","payment","success"].indexOf(checkoutStep) > i ? "done" : ""}`}/>}
          </div>
        ))}
      </div>

      <div className="cart-layout">

        {/* ── LEFT: Cart items / Address / Payment ── */}
        <div className="cart-left">

          {/* ── STEP 1: Cart Items ── */}
          {checkoutStep === "cart" && (
            <>
              <div className="cart-section-header">
                <h2 className="cart-section-title">My Cart <span className="cart-item-count">({cartItems.length} {cartItems.length === 1 ? "item" : "items"})</span></h2>
                <button className="clear-cart-btn" onClick={onClearCart}>🗑 Clear All</button>
              </div>

              <div className="cart-items-list">
                {cartItems.map(item => {
                  const hasDiscount = item.product.originalPrice > item.product.price;
                  const saving = hasDiscount ? (item.product.originalPrice - item.product.price) * item.qty : 0;
                  return (
                    <div key={item.key} className={`cart-item-card ${item.isCustom ? "cart-item-custom" : ""}`}>
                      <div className="cart-item-img-wrap">
                        <img
                          src={item.product.image}
                          alt={item.product.name}
                          className="cart-item-img"
                          onError={e => { e.target.onerror=null; e.target.src="https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=200&q=80"; }}
                        />
                        {item.isCustom && <span className="custom-badge">✂️ Custom</span>}
                      </div>

                      <div className="cart-item-details">
                        <div className="cart-item-top">
                          <div>
                            <p className="cart-item-cat">
                              {typeof item.product.category === "object"
                                ? item.product.category?.name
                                : item.product.category}
                            </p>
                            <h3 className="cart-item-name">{item.product.name}</h3>
                            <div className="cart-item-meta">
                              {item.size && <span className="meta-tag">Size: {item.size}</span>}
                              {item.color !== undefined && item.product.colors?.[item.color] && (
                                <span className="meta-tag color-meta">
                                  <span className="meta-color-dot" style={{ background: item.product.colors[item.color] }}/>
                                  Color {item.color + 1}
                                </span>
                              )}
                              {item.isCustom && <span className="meta-tag custom-meta">Custom Stitch • 10–15 days</span>}
                            </div>
                          </div>
                          <button className="cart-remove-btn" onClick={() => onRemove(item.key)} title="Remove">✕</button>
                        </div>

                        <div className="cart-item-bottom">
                          <div className="cart-item-pricing">
                            <span className="cart-item-price">₹{(item.product.price * item.qty).toLocaleString()}</span>
                            {hasDiscount && <span className="cart-item-original">₹{(item.product.originalPrice * item.qty).toLocaleString()}</span>}
                            {saving > 0 && <span className="cart-item-saving">Save ₹{saving.toLocaleString()}</span>}
                          </div>

                          <div className="cart-qty-control">
                            <button onClick={() => onUpdateQty(item.key, item.qty - 1)}>−</button>
                            <span>{item.qty}</span>
                            <button onClick={() => onUpdateQty(item.key, item.qty + 1)}
                              disabled={item.qty >= (item.product.stock || 99)}>+</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Free shipping progress */}
              {subtotal < FREE_SHIP_THRESHOLD && (
                <div className="freeship-progress-bar">
                  <div className="freeship-text">
                    <span>🚚</span>
                    <span>Add <strong>₹{(FREE_SHIP_THRESHOLD - subtotal).toLocaleString()}</strong> more for FREE shipping!</span>
                  </div>
                  <div className="freeship-track">
                    <div className="freeship-fill" style={{ width: `${Math.min(100, (subtotal / FREE_SHIP_THRESHOLD) * 100)}%` }}/>
                  </div>
                </div>
              )}
              {subtotal >= FREE_SHIP_THRESHOLD && (
                <div className="freeship-achieved">🎉 You've unlocked <strong>Free Shipping!</strong></div>
              )}

              <button className="cart-continue-btn" onClick={() => setCheckoutStep("address")}>
                Proceed to Address →
              </button>
            </>
          )}

          {/* ── STEP 2: Address ── */}
          {checkoutStep === "address" && (
            <>
              <div className="cart-section-header">
                <button className="back-step-btn" onClick={() => setCheckoutStep("cart")}>← Back to Cart</button>
                <h2 className="cart-section-title">Delivery Address</h2>
              </div>

              <div className="address-form">
                <div className="addr-row two-col">
                  {[{k:"name",l:"Full Name",p:"Your full name"},{k:"phone",l:"Mobile Number",p:"10-digit number"}].map(f=>(
                    <div key={f.k} className="addr-field">
                      <label>{f.l}</label>
                      <input type="text" placeholder={f.p} value={address[f.k]} onChange={e=>setA(f.k,e.target.value)} className="addr-input"/>
                    </div>
                  ))}
                </div>
                <div className="addr-field">
                  <label>Address Line 1</label>
                  <input type="text" placeholder="Flat, House no., Building, Street" value={address.line1} onChange={e=>setA("line1",e.target.value)} className="addr-input"/>
                </div>
                <div className="addr-field">
                  <label>Address Line 2 <span className="optional-tag">Optional</span></label>
                  <input type="text" placeholder="Area, Colony, Locality" value={address.line2} onChange={e=>setA("line2",e.target.value)} className="addr-input"/>
                </div>
                <div className="addr-row three-col">
                  {[{k:"city",l:"City",p:"City"},{k:"state",l:"State",p:"State"},{k:"pincode",l:"Pincode",p:"6-digit pincode"}].map(f=>(
                    <div key={f.k} className="addr-field">
                      <label>{f.l}</label>
                      <input type="text" placeholder={f.p} value={address[f.k]} onChange={e=>setA(f.k,e.target.value)} className="addr-input"/>
                    </div>
                  ))}
                </div>

                <div className="saved-address-hint">
                  <span>📍</span>
                  <span>Use a <button className="auth-link bold">saved address</button> from your account</span>
                </div>
              </div>

              <button
                className="cart-continue-btn"
                onClick={() => {
                  if (!address.name || !address.phone || !address.line1 || !address.city || !address.pincode) {
                    alert("Please fill all required address fields.");
                    return;
                  }
                  setCheckoutStep("payment");
                }}
              >
                Proceed to Payment →
              </button>
            </>
          )}

          {/* ── STEP 3: Payment ── */}
          {checkoutStep === "payment" && (
            <>
              <div className="cart-section-header">
                <button className="back-step-btn" onClick={() => setCheckoutStep("address")}>← Back to Address</button>
                <h2 className="cart-section-title">Payment Method</h2>
              </div>

              <div className="payment-methods">
                {[
                  { key:"cod",     icon:"💵", label:"Cash on Delivery",       desc:"Pay when your order arrives" },
                  { key:"upi",     icon:"📱", label:"UPI / GPay / PhonePe",   desc:"Instant payment via UPI" },
                  { key:"card",    icon:"💳", label:"Credit / Debit Card",     desc:"Visa, Mastercard, RuPay" },
                  { key:"netbank", icon:"🏦", label:"Net Banking",             desc:"All major banks supported" },
                  { key:"wallet",  icon:"👜", label:"Wallets",                  desc:"Paytm, Amazon Pay & more" },
                ].map(m => (
                  <label key={m.key} className={`payment-option ${payMethod===m.key?"selected":""}`}>
                    <input type="radio" name="payment" checked={payMethod===m.key} onChange={()=>setPayMethod(m.key)}/>
                    <span className="pay-icon">{m.icon}</span>
                    <div className="pay-info">
                      <p className="pay-label">{m.label}</p>
                      <p className="pay-desc">{m.desc}</p>
                    </div>
                    <span className={`pay-radio ${payMethod===m.key?"active":""}`}/>
                  </label>
                ))}
              </div>

              {/* Delivery address summary */}
              <div className="address-summary-card">
                <div className="addr-summary-header">
                  <p className="addr-summary-title">📍 Delivering to</p>
                  <button className="auth-link bold" onClick={()=>setCheckoutStep("address")}>Change</button>
                </div>
                <p className="addr-summary-name">{address.name}</p>
                <p className="addr-summary-line">{address.line1}{address.line2 ? `, ${address.line2}` : ""}</p>
                <p className="addr-summary-line">{address.city}, {address.state} — {address.pincode}</p>
                <p className="addr-summary-phone">📞 {address.phone}</p>
              </div>

              {orderError && <div className="auth-general-error" style={{marginBottom:12}}>⚠️ {orderError}</div>}

              <button
                className={`place-order-btn ${placing?"placing":""}`}
                onClick={handlePlaceOrder}
                disabled={placing}
              >
                {placing
                  ? <><span className="auth-spinner"/> Placing Order…</>
                  : `✅ Place Order — ₹${total.toLocaleString()}`
                }
              </button>

              <p className="payment-note">🔒 Your payment information is 100% secure & encrypted</p>
            </>
          )}
        </div>

        {/* ── RIGHT: Order Summary ── */}
        <aside className="cart-summary-aside">
          <div className="cart-summary-box">
            <h3 className="summary-title">Order Summary</h3>

            {/* Mini item list */}
            <div className="summary-items">
              {cartItems.map(item => (
                <div key={item.key} className="summary-item-row">
                  <img src={item.product.image} alt="" className="summary-item-img"
                    onError={e=>{e.target.onerror=null;e.target.src="https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=60&q=80";}}/>
                  <span className="summary-item-name">{item.product.name}</span>
                  <span className="summary-item-qty">×{item.qty}</span>
                  <span className="summary-item-price">₹{(item.product.price * item.qty).toLocaleString()}</span>
                </div>
              ))}
            </div>

            <div className="summary-divider"/>

            {/* Coupon */}
            {!appliedCoupon ? (
              <div className="coupon-section">
                <p className="coupon-label">🏷️ Have a coupon?</p>
                <div className="coupon-input-row">
                  <input
                    type="text"
                    placeholder="Enter code (e.g. ELMA20)"
                    value={couponCode}
                    onChange={e => { setCouponCode(e.target.value.toUpperCase()); setCouponError(""); }}
                    onKeyDown={e => e.key === "Enter" && applyCoupon()}
                    className="coupon-input"
                  />
                  <button className="coupon-apply-btn" onClick={applyCoupon} disabled={couponChecking}>
                    {couponChecking ? "Checking…" : "Apply"}
                  </button>
                </div>
                {couponError && <p className="coupon-error">⚠️ {couponError}</p>}
              </div>
            ) : (
              <div className="coupon-applied">
                <span>🎉 <strong>{appliedCoupon.code}</strong> applied</span>
                <button className="coupon-remove" onClick={removeCoupon}>✕</button>
              </div>
            )}
            {couponSuccess && <p className="coupon-success">✓ {couponSuccess}</p>}

            <div className="summary-divider"/>

            {/* Breakdown */}
            <div className="price-breakdown">
              <div className="price-row">
                <span>Subtotal ({cartCount} items)</span>
                <span>₹{subtotal.toLocaleString()}</span>
              </div>
              {totalSavings > 0 && (
                <div className="price-row saving">
                  <span>Product Savings</span>
                  <span>−₹{totalSavings.toLocaleString()}</span>
                </div>
              )}
              {discount > 0 && (
                <div className="price-row saving">
                  <span>Coupon Discount</span>
                  <span>−₹{discount.toLocaleString()}</span>
                </div>
              )}
              <div className="price-row">
                <span>Shipping</span>
                <span className={shippingFee === 0 ? "free-ship-label" : ""}>
                  {shippingFee === 0 ? "FREE" : `₹${shippingFee}`}
                </span>
              </div>
            </div>

            <div className="summary-divider"/>

            <div className="price-row total-row">
              <span>Total</span>
              <span>₹{total.toLocaleString()}</span>
            </div>

            {(totalSavings + discount) > 0 && (
              <div className="total-savings-banner">
                🎉 You're saving <strong>₹{(totalSavings + discount).toLocaleString()}</strong> on this order!
              </div>
            )}

            {checkoutStep === "cart" && (
              <button className="summary-checkout-btn" onClick={() => setCheckoutStep("address")}>
                Proceed to Checkout →
              </button>
            )}

            <div className="summary-perks">
              <div className="summary-perk"><span>🔒</span><span>Secure Payments</span></div>
              <div className="summary-perk"><span>↩️</span><span>7-Day Returns</span></div>
              <div className="summary-perk"><span>✅</span><span>100% Genuine</span></div>
            </div>
          </div>
        </aside>

      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// RESET PASSWORD PAGE (reached via the link emailed by /forgot-password)
// ─────────────────────────────────────────────────────────────────────────────
export function ResetPasswordPage() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!token) { setError("This reset link is missing its token. Please request a new one."); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Failed to reset password");
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="reset-password-page">
      <div className="reset-password-box">
        <div className="auth-brand" style={{ justifyContent: "center", marginBottom: 24 }}>
          <span className="auth-brand-icon">✦</span><h2>ELMA'S FASHION</h2>
        </div>

        {done ? (
          <div className="forgot-success">
            <div className="success-icon">✅</div>
            <h3>Password reset!</h3>
            <p>You can now sign in with your new password.</p>
            <a className="cta-primary" href="/" style={{ display: "inline-block", marginTop: 16, textDecoration: "none" }}>
              Go to Homepage
            </a>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <h3 className="auth-form-title">Set a new password 🔑</h3>
            <p className="auth-form-sub">Choose a new password for your account.</p>
            {error && <div className="auth-general-error">⚠️ {error}</div>}

            <div className="auth-field">
              <label className="auth-label">New Password</label>
              <div className="auth-input-wrap">
                <span className="auth-field-icon">🔒</span>
                <input type={showPass ? "text" : "password"} value={password}
                  onChange={e => setPassword(e.target.value)} placeholder="New Password"
                  className="auth-input" autoComplete="new-password" />
                <button type="button" className="eye-btn" onClick={() => setShowPass(s => !s)}>{showPass ? "🙈" : "👁️"}</button>
              </div>
            </div>

            <div className="auth-field">
              <label className="auth-label">Confirm Password</label>
              <div className="auth-input-wrap">
                <span className="auth-field-icon">🔒</span>
                <input type={showPass ? "text" : "password"} value={confirm}
                  onChange={e => setConfirm(e.target.value)} placeholder="Confirm Password"
                  className="auth-input" autoComplete="new-password" />
              </div>
            </div>

            <button type="submit" className={`auth-submit-btn ${loading ? "loading" : ""}`} disabled={loading}>
              {loading ? <span className="auth-spinner" /> : "Reset Password →"}
            </button>
          </form>
        )}

        {!done && <a className="auth-back-link" href="/" style={{ display: "block", textAlign: "center", marginTop: 16, color: "var(--text-muted)", textDecoration: "none" }}>← Back to homepage</a>}
      </div>
    </div>
  );
}

export default function App() {
  // ── Navigation ──
  const [activeTab, setActiveTab] = useState("home");
  const [openDropdown, setOpenDropdown] = useState(null);

  // ── Search ──
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);

  // ── Filters ──
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterSubcategory, setFilterSubcategory] = useState(null);
  const [filterPrice, setFilterPrice] = useState(null);
  const [filterRating, setFilterRating] = useState(null);
  const [sortBy, setSortBy] = useState("popular");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ── Product state ──
  const [viewProduct, setViewProduct] = useState(null);
  const [wishlist, setWishlist] = useState([]);

  // ── Cart state: [{ product, qty, size, color }] ──
  const [cartItems, setCartItems] = useState([]);
  const cartCount = cartItems.reduce((s, i) => s + i.qty, 0);

  const addToCart = (product, qty = 1, size = null, color = 0) => {
    setCartItems(prev => {
      const key = `${product.id}-${size}-${color}`;
      const existing = prev.find(i => i.key === key);
      if (existing) {
        return prev.map(i => i.key === key ? { ...i, qty: Math.min(i.qty + qty, product.stock || 99) } : i);
      }
      return [...prev, { key, product, qty, size, color }];
    });
  };

  const removeFromCart = (key) => setCartItems(prev => prev.filter(i => i.key !== key));

  const updateQty = (key, qty) => {
    if (qty < 1) { removeFromCart(key); return; }
    setCartItems(prev => prev.map(i => i.key === key ? { ...i, qty } : i));
  };

  const clearCart = () => setCartItems([]);

  // ── Hero ──
  const [heroSlide, setHeroSlide] = useState(0);

  // ── Auth ──
  const [authModal, setAuthModal] = useState(null);
  const [user, setUser] = useState(null); // { name, email, token }
  useEffect(() => {
  const savedUser = localStorage.getItem("user");

  if (savedUser) {
    setUser(JSON.parse(savedUser));
  }
}, []);
  const [userDropOpen, setUserDropOpen] = useState(false);

  // ── API data ──
  const { products, loading, error, refetch } = useProducts();

  const heroSlides = [
    { bg:"linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%)", headline:"New Season Arrivals", sub:"Discover the latest in fashion — curated just for you", cta:"Shop Now" },
    { bg:"linear-gradient(135deg,#2d1b4e 0%,#6b2fa0 50%,#a855f7 100%)", headline:"Women's Exclusive Edit", sub:"Elevate your style with our premium women's collection", cta:"Explore Women's" },
    { bg:"linear-gradient(135deg,#0d2137 0%,#1a4b6e 50%,#2980b9 100%)", headline:"Men's Essentials", sub:"Smart, sharp, and effortlessly styled", cta:"Shop Men's" },
  ];

  useEffect(()=>{ const t=setInterval(()=>setHeroSlide(s=>(s+1)%heroSlides.length),4500); return()=>clearInterval(t); },[heroSlides.length]);
  useEffect(()=>{ const h=()=>{ setOpenDropdown(null); setUserDropOpen(false); }; document.addEventListener("click",h); return()=>document.removeEventListener("click",h); },[]);

  const toggleWishlist = id => setWishlist(w => w.includes(id) ? w.filter(x=>x!==id) : [...w,id]);

  // ── Add to cart (real API + local state) ──
  const handleAddToCart = async (product, qty, size = null, color = 0) => {
    try {
      if (user?.token) {
        await apiAddToCart(product.id, qty, user.token);
      }
      addToCart(product, qty, size, color);
    } catch (err) {
      throw err;
    }
  };

  const navigateTo = (tab, category=null, subcategory=null) => {
    setActiveTab(tab);
    if (category) setFilterCategory(category); else if (tab==="collection") setFilterCategory("all");
    setFilterSubcategory(subcategory);
    setOpenDropdown(null);
  };

  const handleDropdownSelect = (category, subcategory) => {
    setActiveTab("collection"); setFilterCategory(category); setFilterSubcategory(subcategory); setOpenDropdown(null);
  };

  // ── Filter + Sort ──
  const filteredProducts = products
    .filter(p => {
      // Category filter — match against normalised categoryKey
      const catMatch = filterCategory === "all" || p.categoryKey === filterCategory;
      const subMatch = !filterSubcategory || p.subcategory === filterSubcategory;
      const priceMatch = !filterPrice || (p.price >= filterPrice.min && p.price <= filterPrice.max);
      const ratingMatch = !filterRating || p.rating >= filterRating;
      const searchMatch = !searchQuery ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.description || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.categoryKey.includes(searchQuery.toLowerCase());
      return catMatch && subMatch && priceMatch && ratingMatch && searchMatch;
    })
    .sort((a,b) => {
      if (sortBy==="price_asc")  return a.price - b.price;
      if (sortBy==="price_desc") return b.price - a.price;
      if (sortBy==="rating")     return b.rating - a.rating;
      if (sortBy==="newest")     return new Date(b.createdAt) - new Date(a.createdAt);
      return b.reviews - a.reviews;
    });

  // ── Suggestions ──
  const suggestions = searchQuery.length > 1
    ? products.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase())).slice(0,5)
    : [];

  // ── Build dynamic category counts ──
  const CATEGORIES_DYNAMIC = [
    { key:"all", label:"All" },
    ...["men","women","boys","girls"].map(k => ({
      key: k, label: k.charAt(0).toUpperCase() + k.slice(1),
    })),
  ];
  return (
    <div className="app" onClick={()=>{ setOpenDropdown(null); setUserDropOpen(false); }}>

      {/* Topbar */}
      <div className="topbar">
        <span>🚚 Free Shipping above ₹999 &nbsp;|&nbsp; Code <strong>ELMA20</strong> for 20% OFF &nbsp;|&nbsp;
          <button className="topbar-link" onClick={()=>setActiveTab("madejustforyou")}>✦ Made Just for You — Custom Stitch</button>
        </span>
      </div>

      {/* Navbar */}
      <nav className="navbar" onClick={e=>e.stopPropagation()}>
        <div className="nav-brand" onClick={()=>setActiveTab("home")}>
          <img src={logo} alt="logo" className="nav-logo" onError={e=>e.target.style.display="none"}/>
          <span className="brand-text">ELMA'S FASHION</span>
        </div>

        <ul className="nav-links">
          {NAV_LINKS.map(link=>(
            <li key={link.key} className="nav-item"
              onMouseEnter={()=>link.dropdown&&setOpenDropdown(link.key)}
              onMouseLeave={()=>link.dropdown&&setOpenDropdown(null)}>
              <button
                className={`nav-link ${(activeTab===link.key||((["men","women","boys","girls"].includes(link.key))&&activeTab==="collection"&&filterCategory===link.key))?"active":""} ${link.special?"nav-link-special":""}`}
                onClick={()=>{
                  if(link.key==="home"||link.key==="collection"||link.key==="madejustforyou") navigateTo(link.key);
                  else navigateTo("collection",link.key);
                }}>
                {link.label} {link.dropdown&&<span className="nav-caret">▾</span>}
              </button>
              {link.dropdown&&openDropdown===link.key&&(
                <NavDropdown category={link.key} onSelect={handleDropdownSelect}/>
              )}
            </li>
          ))}
        </ul>

        <div className="nav-actions">
          {/* Search */}
          <div className={`search-wrap ${searchFocused?"focused":""}`}>
            <span className="search-icon">🔍</span>
            <input type="text" placeholder="Search products..." value={searchQuery}
              onChange={e=>setSearchQuery(e.target.value)}
              onFocus={()=>setSearchFocused(true)}
              onBlur={()=>setTimeout(()=>setSearchFocused(false),200)}
              onKeyDown={e=>{ if(e.key==="Enter"&&searchQuery){ navigateTo("collection","all"); } }}
              className="search-input"/>
            {searchQuery&&<button className="search-clear" onClick={()=>setSearchQuery("")}>✕</button>}
            {suggestions.length>0&&searchFocused&&(
              <div className="search-suggestions">
                {suggestions.map(p=>(
                  <div key={p.id} className="suggestion-item" onMouseDown={()=>{ setViewProduct(p); setSearchQuery(""); }}>
                    <img src={p.image} alt="" onError={e=>e.target.style.display="none"}/>
                    <div>
                      <p>{p.name}</p>
                      <span>₹{p.price.toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button className="nav-icon-btn" title="Wishlist" onClick={()=>setActiveTab("wishlist")}>
            ♥ <span className="badge-count">{wishlist.length}</span>
          </button>
          <button className="nav-icon-btn cart-btn" title="Cart" onClick={()=>setActiveTab("cart")}>
            🛒 <span className="badge-count">{cartCount}</span>
          </button>

          {user ? (
            <div className="user-menu-wrap">
              <button className="user-avatar-btn" onClick={e=>{e.stopPropagation();setUserDropOpen(o=>!o);}}>
                <span className="user-avatar">{user.name[0].toUpperCase()}</span>
                <span className="user-name-short">{user.name.split(" ")[0]}</span>
                <span className="drop-caret">{userDropOpen?"▲":"▼"}</span>
              </button>
              {userDropOpen&&<UserDropdown user={user} onNavigate={(tab)=>setActiveTab(tab)} onLogout={() => { localStorage.removeItem("user"); localStorage.removeItem("token"); setUser(null);
  clearCart(); setWishlist([]);
  setUserDropOpen(false);
}} onClose={()=>setUserDropOpen(false)}/>}
            </div>
          ) : (
            <div className="auth-nav-btns">
              <button className="nav-login-btn" onClick={()=>setAuthModal("login")}>Sign In</button>
              <button className="nav-register-btn" onClick={()=>setAuthModal("register")}>Register</button>
            </div>
          )}
        </div>
      </nav>

      {/* ══ HOME ══ */}
      {activeTab==="home" && (
        <>
          <section className="hero" style={{ background:heroSlides[heroSlide].bg }}>
            <div className="hero-content">
              <p className="hero-eyebrow">✦ Season's Best ✦</p>
              <h1 className="hero-headline">{heroSlides[heroSlide].headline}</h1>
              <p className="hero-sub">{heroSlides[heroSlide].sub}</p>
              <div className="hero-ctas">
                <button className="cta-primary" onClick={()=>navigateTo("collection")}>{heroSlides[heroSlide].cta}</button>
                <button className="cta-secondary" onClick={()=>setActiveTab("madejustforyou")}>✦ Made Just For You</button>
              </div>
            </div>
            <div className="hero-dots">
              {heroSlides.map((_,i)=>(
                <span key={i} className={`hero-dot ${heroSlide===i?"active":""}`} onClick={()=>setHeroSlide(i)}/>
              ))}
            </div>
          </section>

          <section className="vouchers">
            {[
              {icon:"🎯",title:"FLAT 20% OFF",sub:"On Men's Wear",code:"MEN20"},
              {icon:"👗",title:"BUY 1 GET 1",sub:"Women's Collection",code:"BOGO"},
              {icon:"💰",title:"₹500 OFF",sub:"Orders above ₹1999",code:"SAVE500"},
              {icon:"🧵",title:"CUSTOM STITCH",sub:"Made Just For You",code:"STITCH10"},
            ].map((v,i)=>(
              <div key={i} className="voucher-card">
                <span className="voucher-icon">{v.icon}</span>
                <h4>{v.title}</h4><p>{v.sub}</p>
                <span className="voucher-code">{v.code}</span>
              </div>
            ))}
          </section>

          <section className="section">
            <div className="section-header">
              <h2 className="section-title">Shop by Category</h2>
              <p className="section-sub">Find what fits your style</p>
            </div>
            <div className="category-grid">
              {[
                {key:"men",label:"Men's Fashion",emoji:"👔",items:"120+ Styles",gradient:"linear-gradient(135deg,#1a1a2e,#16213e,#0f3460)"},
                {key:"women",label:"Women's Fashion",emoji:"👗",items:"200+ Styles",gradient:"linear-gradient(135deg,#4a0e4e,#81267d,#e91e8c)"},
                {key:"boys",label:"Boys",emoji:"🧒",items:"80+ Styles",gradient:"linear-gradient(135deg,#003049,#0077b6,#00b4d8)"},
                {key:"girls",label:"Girls",emoji:"👧",items:"90+ Styles",gradient:"linear-gradient(135deg,#7b0038,#c9184a,#ff4d6d)"},
              ].map(cat=>(
                <div key={cat.key} className="cat-card" style={{background:cat.gradient}} onClick={()=>navigateTo("collection",cat.key)}>
                  <span className="cat-emoji">{cat.emoji}</span>
                  <h3>{cat.label}</h3><p>{cat.items}</p>
                  <span className="cat-arrow">→</span>
                </div>
              ))}
            </div>
          </section>

          {/* Made Just For You Teaser */}
          <section className="mjfy-teaser" onClick={()=>setActiveTab("madejustforyou")}>
            <div className="mjfy-teaser-content">
              <p className="mjfy-teaser-eyebrow">✦ Exclusive Custom Stitch Service ✦</p>
              <h2>Made Just for You</h2>
              <p>Create beautiful matching outfits from sarees for your loved ones — Mom & Daughter, Sisters Combo, Designer Blouse. Custom stitched, delivered in 10–15 days.</p>
              <button className="cta-primary" onClick={e=>{e.stopPropagation();setActiveTab("madejustforyou");}}>Explore & Customize →</button>
            </div>
            <div className="mjfy-teaser-icons">
              <div className="teaser-icon-bubble">👩‍👧<span>Mom &amp; Daughter</span></div>
              <div className="teaser-icon-bubble">👭<span>Sisters</span></div>
              <div className="teaser-icon-bubble">✂️<span>Designer Blouse</span></div>
            </div>
          </section>

          {/* Trending Now */}
          <section className="section">
            <div className="section-header">
              <h2 className="section-title">Trending Now</h2>
              <button className="view-all-btn" onClick={()=>navigateTo("collection")}>View All →</button>
            </div>
            {loading ? <LoadingGrid/> : error ? <ErrorBanner message={error} onRetry={refetch}/> : (
              <div className="products-grid">
                {products.filter(p=>p.badge&&p.badge!=="Out of Stock").slice(0,8).map(p=>(
                  <ProductCard key={p.id} product={p} onView={setViewProduct} onWishlist={toggleWishlist} wishlist={wishlist} onAddToCart={handleAddToCart}/>
                ))}
              </div>
            )}
          </section>

          <section className="promo-banner">
            <div className="promo-text">
              <p className="promo-eyebrow">Limited Time</p>
              <h2>End of Season Sale</h2>
              <p>Up to 50% OFF on selected items across all categories</p>
              <button className="cta-primary" onClick={()=>navigateTo("collection")}>Shop Sale</button>
            </div>
            <div className="promo-badges">
              <div className="promo-badge">50%<br/><small>OFF</small></div>
              <div className="promo-badge sm">Free<br/>Ship</div>
            </div>
          </section>

          {/* New Arrivals */}
          <section className="section">
            <div className="section-header">
              <h2 className="section-title">New Arrivals</h2>
              <button className="view-all-btn" onClick={()=>{ navigateTo("collection"); setSortBy("newest"); }}>View All →</button>
            </div>
            {loading ? <LoadingGrid/> : error ? null : (
              <div className="products-grid">
                {[...products].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,8).map(p=>(
                  <ProductCard key={p.id} product={p} onView={setViewProduct} onWishlist={toggleWishlist} wishlist={wishlist} onAddToCart={handleAddToCart}/>
                ))}
              </div>
            )}
          </section>

          <footer className="footer">
            <div className="footer-grid">
              <div>
                <h4>ELMA'S FASHION</h4>
                <p>Your destination for the latest trends in men's, women's, and kids' fashion — plus custom stitch services.</p>
              </div>
              <div>
                <h4>Quick Links</h4>
                <ul>{["Men","Women","Boys","Girls","Made For You","Sale"].map(l=><li key={l}><span className="footer-link">{l}</span></li>)}</ul>
              </div>
              <div>
                <h4>Customer Care</h4>
                <ul>{["My Orders","Custom Orders","Returns","Track Order","Size Guide","Contact Us"].map(l=><li key={l}><span className="footer-link">{l}</span></li>)}</ul>
              </div>
              <div>
                <h4>Connect</h4>
                <p>📧 hello@elmasfashion.in</p><p>📞 1800-XXX-XXXX</p>
                <div className="social-links">
                  {["📘","📷","🐦","▶️"].map((s,i)=><span key={i} className="social-icon">{s}</span>)}
                </div>
              </div>
            </div>
            <div className="footer-bottom">
              <p>© 2025 Elma's Fashion. All rights reserved.</p>
              <p>Secure Payments: 💳 🏦 📱</p>
            </div>
          </footer>
        </>
      )}

      {/* ══ COLLECTION ══ */}
      {activeTab==="collection" && (
        <div className="collection-page">
          <aside className={`filter-sidebar ${sidebarOpen?"open":""}`}>
            <div className="sidebar-header">
              <h3>Filters</h3>
              <button className="clear-filters" onClick={()=>{ setFilterCategory("all"); setFilterSubcategory(null); setFilterPrice(null); setFilterRating(null); }}>Clear All</button>
            </div>
            <div className="filter-section">
              <h4>Category</h4>
              {CATEGORIES_DYNAMIC.map(c=>(
                <label key={c.key} className={`filter-option ${filterCategory===c.key&&!filterSubcategory?"active":""}`}>
                  <input type="radio" name="category" checked={filterCategory===c.key&&!filterSubcategory}
                    onChange={()=>{ setFilterCategory(c.key); setFilterSubcategory(null); }}/>
                  {c.label}
                  <span className="filter-count">
                    {c.key==="all" ? products.length : products.filter(p=>p.categoryKey===c.key).length}
                  </span>
                </label>
              ))}
            </div>

            {filterCategory!=="all" && SUBCATEGORIES[filterCategory] && (
              <div className="filter-section subcategory-filter">
                <h4>Subcategory</h4>
                {SUBCATEGORIES[filterCategory].map(s=>(
                  <label key={s.key} className={`filter-option ${filterSubcategory===s.key?"active":""}`}>
                    <input type="radio" name="subcategory" checked={filterSubcategory===s.key}
                      onChange={()=>setFilterSubcategory(filterSubcategory===s.key?null:s.key)}/>
                    {s.label}
                    <span className="filter-count">{products.filter(p=>p.categoryKey===filterCategory&&p.subcategory===s.key).length}</span>
                  </label>
                ))}
              </div>
            )}

            <div className="filter-section">
              <h4>Price Range</h4>
              {PRICE_RANGES.map((pr,i)=>(
                <label key={i} className={`filter-option ${filterPrice===pr?"active":""}`}>
                  <input type="radio" name="price" checked={filterPrice===pr}
                    onChange={()=>setFilterPrice(filterPrice===pr?null:pr)}/>
                  {pr.label}
                </label>
              ))}
            </div>

            <div className="filter-section">
              <h4>Minimum Rating</h4>
              {[4.5,4.0,3.5].map(r=>(
                <label key={r} className={`filter-option ${filterRating===r?"active":""}`}>
                  <input type="radio" name="rating" checked={filterRating===r}
                    onChange={()=>setFilterRating(filterRating===r?null:r)}/>
                  <Stars rating={r}/> & above
                </label>
              ))}
            </div>

            {/* In Stock only toggle */}
            <div className="filter-section">
              <h4>Availability</h4>
              <label className="filter-option">
                <input type="checkbox" onChange={e => {
                  // Simple in-stock filter — you can add state for this
                }}/>
                In Stock Only
              </label>
            </div>
          </aside>

          <main className="products-main">
            <div className="products-toolbar">
              <button className="filter-toggle-btn" onClick={()=>setSidebarOpen(s=>!s)}>☰ Filters {sidebarOpen?"▲":"▼"}</button>
              <p className="results-count"><strong>{filteredProducts.length}</strong> products found</p>
              <div className="sort-wrap">
                <label>Sort by:</label>
                <select value={sortBy} onChange={e=>setSortBy(e.target.value)} className="sort-select">
                  {SORT_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>

            <div className="active-filters">
              {filterCategory!=="all"&&<span className="filter-chip">{filterCategory}<button onClick={()=>{ setFilterCategory("all"); setFilterSubcategory(null); }}>✕</button></span>}
              {filterSubcategory&&<span className="filter-chip">{SUBCATEGORIES[filterCategory]?.find(s=>s.key===filterSubcategory)?.label||filterSubcategory}<button onClick={()=>setFilterSubcategory(null)}>✕</button></span>}
              {filterPrice&&<span className="filter-chip">{filterPrice.label}<button onClick={()=>setFilterPrice(null)}>✕</button></span>}
              {filterRating&&<span className="filter-chip">★ {filterRating}+<button onClick={()=>setFilterRating(null)}>✕</button></span>}
              {searchQuery&&<span className="filter-chip">"{searchQuery}"<button onClick={()=>setSearchQuery("")}>✕</button></span>}
            </div>

            {loading ? <LoadingGrid/> :
             error   ? <ErrorBanner message={error} onRetry={refetch}/> :
             filteredProducts.length===0 ? (
               <div className="no-results">
                 <p>😕</p><h3>No products found</h3>
                 <p>Try changing your filters or search query.</p>
                 <button className="cta-primary" onClick={()=>{ setFilterCategory("all"); setFilterSubcategory(null); setFilterPrice(null); setFilterRating(null); setSearchQuery(""); }}>Reset Filters</button>
               </div>
             ) : (
               <div className="products-grid">
                 {filteredProducts.map(p=>(
                   <ProductCard key={p.id} product={p} onView={setViewProduct} onWishlist={toggleWishlist} wishlist={wishlist} onAddToCart={handleAddToCart}/>
                 ))}
               </div>
             )
            }
          </main>
        </div>
      )}

      {/* ══ MY ORDERS ══ */}
      {activeTab==="myorders" && (
        <MyOrdersPage user={user} onBrowse={()=>setActiveTab("collection")}/>
      )}

      {/* ══ WISHLIST ══ */}
      {activeTab==="wishlist" && (
        <div className="wishlist-page">
          <div className="wishlist-header">
            <h2>My Wishlist</h2>
            <p>{wishlist.length} {wishlist.length === 1 ? "item" : "items"} saved</p>
          </div>
          {products.filter(p => wishlist.includes(p.id)).length === 0 ? (
            <div className="no-results">
              <p>♡</p><h3>Your wishlist is empty</h3>
              <p>Tap the heart icon on any product to save it here.</p>
              <button className="cta-primary" onClick={() => setActiveTab("collection")}>Browse Products</button>
            </div>
          ) : (
            <div className="products-grid">
              {products.filter(p => wishlist.includes(p.id)).map(p => (
                <ProductCard key={p.id} product={p} onView={setViewProduct} onWishlist={toggleWishlist} wishlist={wishlist} onAddToCart={handleAddToCart}/>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══ MADE JUST FOR YOU ══ */}
      {activeTab==="madejustforyou" && (
        <MadeJustForYou onAddCustom={()=>setCartItems(prev=>[...prev,{ key:`custom-${Date.now()}`, product:{ id:`custom-${Date.now()}`, name:"Custom Stitched Outfit", price:0, image:"https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=400&q=80", category:"Custom", inStock:true, stock:1, description:"Custom stitch order" }, qty:1, size:null, color:0, isCustom:true }])}/>
      )}

      {/* ══ CART ══ */}
      {activeTab==="cart" && (
        <CartPage
          cartItems={cartItems}
          onUpdateQty={updateQty}
          onRemove={removeFromCart}
          onClearCart={clearCart}
          onContinue={() => setActiveTab("collection")}
          onCheckout={() => setActiveTab("cart")}
          onGoToOrders={() => setActiveTab("myorders")}
          user={user}
        />
      )}

      {/* Modals */}
      {viewProduct && (
        <ProductModal
          product={viewProduct}
          onClose={()=>setViewProduct(null)}
          onWishlist={toggleWishlist}
          wishlist={wishlist}
          onAddToCart={handleAddToCart}
          onBuyNow={()=>{ setViewProduct(null); setActiveTab("cart"); }}
        />
      )}
      {authModal && (
        <AuthModal mode={authModal}
  onClose={() => setAuthModal(null)}
  onAuth={(u) => {
    setUser(u);
    localStorage.setItem("user", JSON.stringify(u));
    if (u?.token) localStorage.setItem("token", u.token);
  }}
/>
      )}
    </div>
  );
}
