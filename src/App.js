import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import logo from "./Logo.png";
import "./App.css";

// ─────────────────────────────────────────────────────────────────────────────
// API CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const API_BASE = (process.env.REACT_APP_API_URL || "http://localhost:5000/api").replace(/\/+$/, "");

// We currently only ship within India. A valid Indian PIN code is exactly 6 digits,
// and the first digit is never 0 (used to catch most non-Indian postal codes too,
// e.g. US ZIPs commonly start differently, UK postcodes contain letters, etc.)
const isValidIndianPincode = (pincode) => /^[1-9][0-9]{5}$/.test((pincode || "").trim());

// Same direct-to-Cloudinary pattern used in the admin panel — lets customers attach a
// reference photo to their custom stitch request. Falls back to nothing if not configured;
// customers simply won't see the upload option (no crash, no broken UI).
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
        fetch(`${API_BASE}/products?activeOnly=true`),
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

async function apiAddToCart(productId, qty, token, variantId = null) {
  const res = await fetch(`${API_BASE}/cart`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ productId, quantity: qty, variantId: variantId || undefined }),
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

// Promotion records only store type/value/minOrderValue — the storefront derives
// a human-readable title/sub/icon from those so the voucher cards stay readable
// no matter what an admin creates.
const VOUCHER_ICONS = { PERCENT: "🎯", FLAT: "💰", SHIPPING: "🚚" };
const voucherDisplay = (p) => {
  const icon = VOUCHER_ICONS[p.type] || "🏷️";
  const orderNote = p.minOrderValue > 0 ? `Orders above ₹${p.minOrderValue}` : "On your order";
  if (p.type === "PERCENT") return { icon, title: `FLAT ${p.value}% OFF`, sub: orderNote };
  if (p.type === "FLAT") return { icon, title: `₹${p.value} OFF`, sub: orderNote };
  if (p.type === "SHIPPING") return { icon, title: "FREE SHIPPING", sub: orderNote };
  return { icon, title: p.code, sub: "Limited time offer" };
};

// Starter copy for the Size Guide / Returns Policy footer popups — plain,
// standard content so the links aren't dead ends. Store owner should review
// and adjust the specifics (measurements, exact policy terms) before launch.
const SIZE_CHART_ROWS = [
  { size: "XS",  chest: "34", waist: "28", hip: "36" },
  { size: "S",   chest: "36", waist: "30", hip: "38" },
  { size: "M",   chest: "38", waist: "32", hip: "40" },
  { size: "L",   chest: "40", waist: "34", hip: "42" },
  { size: "XL",  chest: "42", waist: "36", hip: "44" },
  { size: "XXL", chest: "44", waist: "38", hip: "46" },
  { size: "XXXL",chest: "46", waist: "40", hip: "48" },
];

function SizeGuideContent() {
  return (
    <>
      <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: 14 }}>
        All measurements are in inches. For the best fit, measure a similar garment you already own and compare it to the chart below.
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--border)" }}>
            <th style={{ textAlign: "left", padding: "8px 6px" }}>Size</th>
            <th style={{ textAlign: "left", padding: "8px 6px" }}>Chest</th>
            <th style={{ textAlign: "left", padding: "8px 6px" }}>Waist</th>
            <th style={{ textAlign: "left", padding: "8px 6px" }}>Hip</th>
          </tr>
        </thead>
        <tbody>
          {SIZE_CHART_ROWS.map(r => (
            <tr key={r.size} style={{ borderBottom: "1px solid var(--border)" }}>
              <td style={{ padding: "8px 6px", fontWeight: 700 }}>{r.size}</td>
              <td style={{ padding: "8px 6px" }}>{r.chest}"</td>
              <td style={{ padding: "8px 6px" }}>{r.waist}"</td>
              <td style={{ padding: "8px 6px" }}>{r.hip}"</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ color: "var(--text-muted)", fontSize: "0.82rem", marginTop: 14 }}>
        Ordering a Custom Stitch item? We'll confirm your exact measurements with you directly before stitching begins.
      </p>
    </>
  );
}

function ReturnsPolicyContent() {
  return (
    <div style={{ color: "var(--text-muted)", fontSize: "0.9rem", lineHeight: 1.7 }}>
      <p>We want you to love what you ordered. If something isn't right, you can request a return or exchange within <strong>7 days</strong> of delivery.</p>
      <ul style={{ paddingLeft: 20, margin: "10px 0" }}>
        <li>Items must be unused, unwashed, and with original tags attached.</li>
        <li>Once we receive and inspect the item, refunds are issued to your original payment method.</li>
        <li>Custom Stitch orders are made specifically for you and aren't eligible for return or exchange, except in the case of a manufacturing defect.</li>
      </ul>
      <p>To start a return, go to <strong>My Orders</strong> and select the order you'd like to return, or reach out via Contact Us and our team will help.</p>
    </div>
  );
}

// PRICE_RANGES + VOUCHER_ICONS below are pre-existing storefront constants
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
function ProductCard({ product, onView, onWishlist, wishlist, onAddToCart, pickMode, onPick }) {
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
      onClick={() => pickMode ? onPick(product) : onView(product)}>
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
          onClick={e => {
            e.stopPropagation();
            if (pickMode) {
              onPick(product);
            } else if (Array.isArray(product.variants) && product.variants.length > 0) {
              onView(product); // needs a size/color pick — open the modal instead of guessing
            } else {
              onAddToCart(product, 1);
            }
          }}
        >
          {!product.inStock ? "Out of Stock" : pickMode ? "Select This Saree" : (Array.isArray(product.variants) && product.variants.length > 0) ? "Select Options" : "Add to Cart"}
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
  const [selColor, setSelColor] = useState(null);
  const [qty, setQty] = useState(1);
  const [cartMsg, setCartMsg] = useState(null); // success/error feedback
  const [showSizeGuide, setShowSizeGuide] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [descOverflows, setDescOverflows] = useState(false);
  const descRef = useRef(null);

  // Measured once per product, while the paragraph is still in its clamped
  // (2-line) state — tells us whether "Show more" is actually needed, rather
  // than guessing from a character count that breaks at different widths.
  useLayoutEffect(() => {
    if (descRef.current) {
      setDescOverflows(descRef.current.scrollHeight > descRef.current.clientHeight + 1);
    }
    setDescExpanded(false);
  }, [product.description]);

  const isWished = wishlist.includes(product.id);

  // ── Safe field reads (backend may not have these) ──
  const catDisplay = typeof product.category === "string"
    ? product.category
    : product.category?.name ?? "—";

  const colors  = Array.isArray(product.colors) ? product.colors : [];
  const sizes   = Array.isArray(product.sizes)  ? product.sizes  : [];

  // ── Real variants (size/color/stock/price combinations set by the admin) ──
  const realVariants = Array.isArray(product.variants) ? product.variants : [];
  const hasRealVariants = realVariants.length > 0;

  // Which axes actually vary across this product's real variants
  const variantSizes  = hasRealVariants ? [...new Set(realVariants.map(v => v.size).filter(Boolean))]  : [];
  const variantColors = hasRealVariants ? [...new Set(realVariants.map(v => v.color).filter(Boolean))] : [];
  const needsSize  = variantSizes.length > 0;
  const needsColor = variantColors.length > 0;

  // The option lists actually rendered — real variant values take priority over the legacy hint fields
  const sizeOptions  = hasRealVariants ? variantSizes  : sizes;
  const colorOptions = hasRealVariants ? variantColors : colors;

  const selectedVariant = hasRealVariants
    ? realVariants.find(v =>
        (needsSize ? v.size === selSize : true) &&
        (needsColor ? v.color === selColor : true)
      )
    : null;

  const selectionComplete = !hasRealVariants || ((!needsSize || selSize) && (!needsColor || selColor));

  const effectivePrice = selectedVariant?.price ?? product.price;
  const effectiveStock = hasRealVariants
    ? (selectionComplete ? (selectedVariant?.stock ?? 0) : null) // null = "not yet known, still picking"
    : product.stock;

  const hasDiscount = product.originalPrice > effectivePrice;
  const discount = hasDiscount
    ? Math.round(((product.originalPrice - effectivePrice) / product.originalPrice) * 100)
    : 0;

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  // Reset quantity if it now exceeds what's available for the newly selected variant
  useEffect(() => {
    if (effectiveStock != null && qty > effectiveStock) setQty(Math.max(1, effectiveStock));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVariant?.id]);

  const galleryImages = Array.isArray(product.images) && product.images.length > 0 ? product.images : [product.image];
  const displayImages = selectedVariant?.image
    ? [selectedVariant.image, ...galleryImages.filter(img => img !== selectedVariant.image)]
    : galleryImages;

  const [activeImageIndex, setActiveImageIndex] = useState(0);

  // Jump to the variant's own photo the moment a matching variant is selected
  useEffect(() => {
    if (selectedVariant?.image) setActiveImageIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVariant?.id]);

  const handleAddToCart = async () => {
    if (!selectionComplete) {
      setCartMsg({ type: "error", text: `Please select a ${!selSize && needsSize ? "size" : "color"}.` });
      setTimeout(() => setCartMsg(null), 2500);
      return;
    }
    setCartMsg(null);
    try {
      await onAddToCart(product, qty, selectedVariant);
      setCartMsg({ type: "success", text: "✓ Added to cart!" });
    } catch (err) {
      setCartMsg({ type: "error", text: err.message || "Failed to add to cart" });
    }
    setTimeout(() => setCartMsg(null), 2500);
  };

  const handleBuyNow = async () => {
    if (!selectionComplete) {
      setCartMsg({ type: "error", text: `Please select a ${!selSize && needsSize ? "size" : "color"}.` });
      setTimeout(() => setCartMsg(null), 2500);
      return;
    }
    setCartMsg(null);
    try {
      await onAddToCart(product, qty, selectedVariant);
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
          {/* Left — Image carousel */}
          <div className="modal-img-wrap">
            <div className="modal-img-main">
              <img
                src={displayImages[activeImageIndex]}
                alt={product.name}
                className="modal-img"
                onError={e => {
                  e.target.onerror = null;
                  e.target.src = "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400&q=80";
                }}
              />
              {displayImages.length > 1 && (
                <>
                  <button className="carousel-arrow carousel-arrow-left" onClick={() => setActiveImageIndex(i => (i - 1 + displayImages.length) % displayImages.length)}>‹</button>
                  <button className="carousel-arrow carousel-arrow-right" onClick={() => setActiveImageIndex(i => (i + 1) % displayImages.length)}>›</button>
                </>
              )}
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
            {displayImages.length > 1 && (
              <div className="carousel-thumbs">
                {displayImages.map((img, i) => (
                  <button
                    key={i}
                    className={`carousel-thumb ${i === activeImageIndex ? "active" : ""}`}
                    onClick={() => setActiveImageIndex(i)}
                  >
                    <img src={img} alt="" onError={e => { e.target.style.opacity = 0.3; }} />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right — Details */}
          <div className="modal-details">
            {/* Category breadcrumb */}
            <p className="modal-cat">{catDisplay.toUpperCase()}</p>

            <h2 className="modal-title">{product.name}</h2>

            {/* Description — real backend field. Clamped to 2 lines with a
                Show more/less toggle so long descriptions don't dominate the page. */}
            {product.description && (
              <div className="modal-description-wrap">
                <p ref={descRef} className={`modal-description ${descExpanded ? "" : "clamped"}`}>
                  {product.description}
                </p>
                {descOverflows && (
                  <button type="button" className="desc-toggle" onClick={() => setDescExpanded(v => !v)}>
                    {descExpanded ? "Show less ▲" : "Show more ▼"}
                  </button>
                )}
              </div>
            )}

            {/* Rating */}
            <div className="modal-rating">
              <Stars rating={product.rating} />
              <span className="review-count">{product.reviews} reviews</span>
            </div>

            {/* Pricing */}
            <div className="modal-pricing">
              <span className="modal-price">₹{effectivePrice.toLocaleString()}</span>
              {hasDiscount && (
                <>
                  <span className="modal-original">₹{product.originalPrice.toLocaleString()}</span>
                  <span className="modal-saved">
                    You save ₹{(product.originalPrice - effectivePrice).toLocaleString()} ({discount}%)
                  </span>
                </>
              )}
            </div>

            {colorOptions.length > 0 && (
              <div className="modal-section">
                <p className="option-label">Color{hasRealVariants && !selColor && <span className="size-hint"> — please select</span>}</p>
                <div className="color-options">
                  {colorOptions.map((c, i) => (
                    <span
                      key={i}
                      className={`color-dot lg ${selColor === c ? "selected" : ""}`}
                      style={{ background: c, border: c === "#fff" ? "1px solid #ccc" : "none" }}
                      onClick={() => setSelColor(c)}
                      title={c}
                    />
                  ))}
                </div>
              </div>
            )}

            {sizeOptions.length > 0 && (
              <div className="modal-section">
                <p className="option-label">
                  Size&nbsp;
                  <button type="button" className="size-guide" onClick={() => setShowSizeGuide(true)}>Size Guide</button>
                </p>
                <div className="size-options">
                  {sizeOptions.map(s => (
                    <button
                      key={s}
                      className={`size-btn ${selSize === s ? "selected" : ""}`}
                      onClick={() => setSelSize(s)}
                    >{s}</button>
                  ))}
                </div>
                {!selSize && (
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
                <button onClick={() => setQty(q => Math.min((effectiveStock ?? product.stock) || 99, q + 1))}>+</button>
              </div>
              <span className="stock-count">
                {effectiveStock == null
                  ? <span style={{ color: "var(--text-muted)" }}>Select options to see stock</span>
                  : effectiveStock > 0
                    ? `${effectiveStock} in stock`
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
                disabled={effectiveStock === 0}
              >
                🛒 Add to Cart
              </button>
              <button
                className="btn-buy"
                disabled={effectiveStock === 0}
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
      {showSizeGuide && (
        <div className="modal-overlay" onClick={() => setShowSizeGuide(false)} style={{ zIndex: 1001 }}>
          <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 480, padding: 26 }}>
            <button className="modal-close" onClick={() => setShowSizeGuide(false)}>✕</button>
            <h2 style={{ marginTop: 0, marginBottom: 16 }}>Size Guide</h2>
            <SizeGuideContent/>
          </div>
        </div>
      )}
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
function MadeJustForYou({ user, customFabricPick, onClearFabricPick, onBrowseSarees, onRequireLogin }) {
  const [designs, setDesigns] = useState([]);
  const [designsLoading, setDesignsLoading] = useState(true);
  const [selectedDesign, setSelectedDesign] = useState(null);
  const [comboType, setComboType] = useState("Mom & Daughter");
  const [fabricType, setFabricType] = useState(null); // "design" | "store-product" | "own"

  const [recipients, setRecipients] = useState([
    { label: "Person 1", sizeMode: "standard", standardSize: "", measurements: { chest:"", waist:"", hip:"", length:"", shoulder:"" } }
  ]);

  const [blouseType, setBlouseType] = useState("");
  const [neckPattern, setNeckPattern] = useState("");
  const [backDesign, setBackDesign] = useState("");
  const [referenceImage, setReferenceImage] = useState("");
  const [refUploading, setRefUploading] = useState(false);
  const [notes, setNotes] = useState("");

  const [step, setStep] = useState("customize"); // "customize" | "address" | "payment"
  const [address, setAddress] = useState({ name:"", phone:"", line1:"", line2:"", city:"", state:"", pincode:"" });
  const [payMethod, setPayMethod] = useState("cod");
  const setA = (k, v) => setAddress(a => ({ ...a, [k]: v }));

  const [savedAddresses, setSavedAddresses] = useState([]);
  const [selectedSavedId, setSelectedSavedId] = useState(null);

  useEffect(() => {
    if (!user?.token) return;
    fetch(`${API_BASE}/addresses`, { headers: { Authorization: `Bearer ${user.token}` } })
      .then(async res => {
        const data = await res.json().catch(() => ([]));
        return res.ok && Array.isArray(data) ? data : [];
      })
      .then(list => {
        setSavedAddresses(list);
        const def = list.find(a => a.isDefault);
        if (def && !address.name) {
          setAddress({ name:def.name, phone:def.phone, line1:def.line1, line2:def.line2||"", city:def.city, state:def.state||"", pincode:def.pincode });
          setSelectedSavedId(def.id);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.token]);

  const pickSavedAddress = (a) => {
    setAddress({ name:a.name, phone:a.phone, line1:a.line1, line2:a.line2||"", city:a.city, state:a.state||"", pincode:a.pincode });
    setSelectedSavedId(a.id);
  };

  const [stitchingSettings, setStitchingSettings] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submittedOrder, setSubmittedOrder] = useState(null);
  const panelRef = useRef(null);

  useEffect(() => {
    fetch(`${API_BASE}/custom-designs?activeOnly=true`)
      .then(res => res.json()).then(setDesigns).catch(() => setDesigns([]))
      .finally(() => setDesignsLoading(false));
    fetch(`${API_BASE}/stitching-settings`)
      .then(res => res.json()).then(setStitchingSettings)
      .catch(() => setStitchingSettings({ sizePricing: { XS:449,S:499,M:599,L:699,XL:799,XXL:899,XXXL:999 }, ownFabricFee: 799 }));
  }, []);

  useEffect(() => {
    if (customFabricPick) {
      setFabricType("store-product");
      setSelectedDesign(null);
      setTimeout(() => panelRef.current?.scrollIntoView({ behavior:"smooth", block:"start" }), 100);
    }
  }, [customFabricPick]);

  const handleCustomize = (design) => {
    setSelectedDesign(design);
    setFabricType("design");
    setComboType(design.comboType);
    onClearFabricPick?.();
    setTimeout(() => panelRef.current?.scrollIntoView({ behavior:"smooth", block:"start" }), 100);
  };

  const handleUseOwnFabric = () => {
    setFabricType("own");
    setSelectedDesign(null);
    onClearFabricPick?.();
  };

  const addRecipient = () => {
    setRecipients(r => [...r, { label: `Person ${r.length + 1}`, sizeMode: "standard", standardSize: "", measurements: { chest:"", waist:"", hip:"", length:"", shoulder:"" } }]);
  };
  const removeRecipient = (i) => setRecipients(r => r.length > 1 ? r.filter((_, idx) => idx !== i) : r);
  const updateRecipient = (i, field, value) => setRecipients(r => r.map((rec, idx) => idx === i ? { ...rec, [field]: value } : rec));
  const updateMeasurement = (i, key, value) => setRecipients(r => r.map((rec, idx) => idx === i ? { ...rec, measurements: { ...rec.measurements, [key]: value } } : rec));

  const stitchingCostFor = (r) => {
    if (!stitchingSettings) return null;
    if (r.sizeMode === "standard" && r.standardSize) {
      const sizeCode = r.standardSize.split(" ")[0];
      const fee = stitchingSettings.sizePricing?.[sizeCode];
      if (fee != null) return Number(fee);
    }
    return stitchingSettings.ownFabricFee;
  };

  const fabricCost = fabricType === "design" && selectedDesign ? selectedDesign.basePrice
    : fabricType === "store-product" && customFabricPick ? customFabricPick.price
    : fabricType === "own" ? 0 : null;

  const totalStitchingCost = stitchingSettings ? recipients.reduce((sum, r) => sum + (stitchingCostFor(r) || 0), 0) : null;
  const previewPrice = fabricCost != null && totalStitchingCost != null ? fabricCost + totalStitchingCost : null;

  const handleRefUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRefUploading(true);
    try {
      const url = await uploadImageToCloudinary(file);
      setReferenceImage(url);
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setRefUploading(false);
      e.target.value = "";
    }
  };

  const handleProceedToAddress = () => {
    setSubmitError("");
    if (!user?.token) { onRequireLogin(); return; }
    if (!fabricType) { setSubmitError("Please select a design, a saree from our store, or your own fabric."); return; }
    if (fabricType === "design" && !selectedDesign) { setSubmitError("Please select a design."); return; }
    if (fabricType === "store-product" && !customFabricPick) { setSubmitError("Please pick a saree from our store."); return; }
    for (const r of recipients) {
      if (!r.label.trim()) { setSubmitError("Please label every garment (e.g. 'Mom', 'Daughter 1')."); return; }
      if (r.sizeMode === "standard" && !r.standardSize) { setSubmitError(`Please select a size for "${r.label}".`); return; }
      if (r.sizeMode === "custom" && Object.values(r.measurements).some(v => !v)) { setSubmitError(`Please fill in all measurements for "${r.label}".`); return; }
    }
    setStep("address");
    setTimeout(() => panelRef.current?.scrollIntoView({ behavior:"smooth", block:"start" }), 50);
  };

  const handleProceedToPayment = () => {
    if (!address.name || !address.phone || !address.line1 || !address.city || !address.pincode) {
      setSubmitError("Please fill in all required address fields.");
      return;
    }
    if (!isValidIndianPincode(address.pincode)) {
      setSubmitError("Sorry, we currently only deliver within India — that doesn't look like a valid 6-digit Indian PIN code (non-serviceable area).");
      return;
    }
    setSubmitError("");
    setStep("payment");
  };

  const handleFinalSubmit = async () => {
    setSubmitError("");
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/custom-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
        body: JSON.stringify({
          designId: fabricType === "design" ? selectedDesign.id : undefined,
          sourceProductId: fabricType === "store-product" ? customFabricPick.id : undefined,
          comboType,
          fabricType,
          recipients: recipients.map(r => ({
            label: r.label.trim(),
            sizeMode: r.sizeMode,
            standardSize: r.sizeMode === "standard" ? r.standardSize.split(" ")[0] : undefined,
            measurements: r.sizeMode === "custom" ? r.measurements : undefined,
          })),
          blouseType: blouseType || undefined,
          neckPattern: neckPattern || undefined,
          backDesign: backDesign || undefined,
          referenceImage: referenceImage || undefined,
          notes: notes || undefined,
          address,
          paymentMethod: payMethod.toUpperCase(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Failed to submit request");
      setSubmittedOrder(data.customOrder);
      onClearFabricPick?.();
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const readyToSubmit = fabricType && (fabricType !== "design" || selectedDesign) && (fabricType !== "store-product" || customFabricPick);

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

      {step === "customize" && !submittedOrder && (
      <>
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
              style={{ background:c.color }} onClick={() => {
                setComboType(c.key);
                if (selectedDesign && selectedDesign.comboType !== c.key) {
                  setSelectedDesign(null);
                  setFabricType(null);
                }
              }}>
              <span className="combo-icon">{c.icon}</span>
              <h3>{c.key}</h3><p>{c.desc}</p>
              {comboType===c.key && <span className="combo-check">✓</span>}
            </div>
          ))}
        </div>
      </section>

      <section className="mjfy-section alt-bg">
        <div className="section-header">
          <div><h2 className="section-title">Design Gallery</h2><p className="section-sub">Designs for {comboType} — pick one, or use a saree of your choice below instead</p></div>
        </div>
        {designsLoading ? (
          <p style={{ textAlign: "center", color: "var(--text-muted)" }}>Loading designs…</p>
        ) : designs.filter(d => d.comboType === comboType).length === 0 ? (
          <p style={{ textAlign: "center", color: "var(--text-muted)" }}>No designs for "{comboType}" yet — you can still use your own saree or one from our store below.</p>
        ) : (
          <div className="design-grid">
            {designs.filter(d => d.comboType === comboType).map(d => (
              <div key={d.id} className={`design-card ${selectedDesign?.id===d.id?"selected":""}`}>
                <div className="design-img-wrap">
                  <img src={d.image} alt={d.name} className="design-img" loading="lazy"/>
                  {d.tag && <span className="design-tag">{d.tag}</span>}
                  <span className="design-combo-badge">{d.comboType}</span>
                </div>
                <div className="design-body">
                  <h4 className="design-name">{d.name}</h4>
                  <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "2px 0 8px" }}>Fabric: ₹{d.basePrice.toLocaleString()} + stitching per garment</p>
                  <button className="customize-btn" onClick={() => handleCustomize(d)}>
                    {selectedDesign?.id===d.id ? "✓ Selected" : "Customize This →"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mjfy-section" ref={panelRef}>
        <div className="section-header">
          <div>
            <h2 className="section-title">Customization Panel</h2>
            <p className="section-sub">
              {fabricType === "design" && selectedDesign ? `Customizing: ${selectedDesign.name}`
                : fabricType === "store-product" && customFabricPick ? `Using: ${customFabricPick.name}`
                : fabricType === "own" ? "Using your own saree"
                : "Pick a design above, or choose your fabric source below to begin"}
            </p>
          </div>
        </div>
        <div className={`custom-panel ${!fabricType?"panel-disabled":""}`}>
          {!fabricType && (
            <div className="panel-overlay-hint">
              <span>👆</span><p>Select a design above, or choose "Use a Saree from Our Store" / "Use My Own Saree" below to unlock customization</p>
            </div>
          )}

          {fabricType === "design" && selectedDesign && (
            <div className="custom-preview-bar">
              <img src={selectedDesign.image} alt="" className="preview-thumb"/>
              <div>
                <p className="preview-label">Selected Design</p>
                <p className="preview-name">{selectedDesign.name}</p>
                <span className="preview-combo">{comboType} · Fabric ₹{selectedDesign.basePrice.toLocaleString()}</span>
              </div>
              <button className="preview-change" onClick={() => { setSelectedDesign(null); setFabricType(null); }}>✕ Change</button>
            </div>
          )}
          {fabricType === "store-product" && customFabricPick && (
            <div className="custom-preview-bar">
              <img src={customFabricPick.image} alt="" className="preview-thumb"/>
              <div>
                <p className="preview-label">Saree Selected From Store</p>
                <p className="preview-name">{customFabricPick.name}</p>
                <span className="preview-combo">Fabric ₹{customFabricPick.price.toLocaleString()} + stitching per garment</span>
              </div>
              <button className="preview-change" onClick={() => { onClearFabricPick?.(); setFabricType(null); }}>✕ Change</button>
            </div>
          )}

          <div className="custom-grid">
            <div className="custom-block">
              <h4 className="custom-block-title">🧶 Choose Fabric</h4>
              <div className="fabric-options">
                <div className={`fabric-option ${fabricType==="store-product"?"selected":""}`} onClick={() => onBrowseSarees()}>
                  <span className={`fabric-radio ${fabricType==="store-product"?"active":""}`}/>
                  <div><p className="fabric-label">Use a Saree from Our Store</p><p className="fabric-desc">Browse real sarees and pick one to stitch</p></div>
                </div>
                <div className={`fabric-option ${fabricType==="own"?"selected":""}`} onClick={handleUseOwnFabric}>
                  <span className={`fabric-radio ${fabricType==="own"?"active":""}`}/>
                  <div><p className="fabric-label">Use My Own Saree</p><p className="fabric-desc">We'll stitch from your provided fabric</p></div>
                </div>
              </div>
            </div>

            {comboType === "Designer Blouse" && (
              <div className="custom-block">
                <h4 className="custom-block-title">✂️ Tailoring Details <span className="optional-tag">Helps our tailor get it right</span></h4>
                <div className="tailoring-detail-grid">
                  <select className="fabric-store-select" value={blouseType} onChange={e=>setBlouseType(e.target.value)}>
                    <option value="">Blouse Type — not specified</option>
                    {["Sleeveless","Short Sleeve","Full Sleeve","3/4 Sleeve"].map(o=><option key={o}>{o}</option>)}
                  </select>
                  <select className="fabric-store-select" value={neckPattern} onChange={e=>setNeckPattern(e.target.value)}>
                    <option value="">Neck Pattern — not specified</option>
                    {["Round","Boat","Sweetheart","Collar","Backless"].map(o=><option key={o}>{o}</option>)}
                  </select>
                  <select className="fabric-store-select" value={backDesign} onChange={e=>setBackDesign(e.target.value)}>
                    <option value="">Back Design — not specified</option>
                    {["Regular","Deep Back","Keyhole","Tie-Back"].map(o=><option key={o}>{o}</option>)}
                  </select>
                </div>
                <div style={{ marginTop: 10 }}>
                  {referenceImage ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <img src={referenceImage} alt="Reference" style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 8 }}/>
                      <button type="button" className="preview-change" onClick={() => setReferenceImage("")}>✕ Remove reference photo</button>
                    </div>
                  ) : CLOUDINARY_CONFIGURED ? (
                    <label className="ref-upload-label">
                      {refUploading ? "Uploading…" : "📎 Attach a reference photo (optional)"}
                      <input type="file" accept="image/*" onChange={handleRefUpload} disabled={refUploading} hidden/>
                    </label>
                  ) : null}
                </div>
              </div>
            )}
            </div>

          <div className="custom-block full-width">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h4 className="custom-block-title" style={{ margin: 0 }}>📏 Garments in This Combo</h4>
              <button type="button" className="add-recipient-btn" onClick={addRecipient}>+ Add Another Person</button>
            </div>
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: -4, marginBottom: 12 }}>
              One saree can be cut into several garments — add one entry per person (e.g. Mom, Daughter 1, Daughter 2), each with their own size.
            </p>
            {recipients.map((r, i) => (
              <div key={i} className="recipient-card">
                <div className="recipient-header">
                  <input className="recipient-label-input" value={r.label} onChange={e=>updateRecipient(i,"label",e.target.value)} placeholder="e.g. Mom, Daughter 1"/>
                  {stitchingCostFor(r) != null && <span className="recipient-price">₹{stitchingCostFor(r).toLocaleString()}</span>}
                  {recipients.length > 1 && <button type="button" className="recipient-remove" onClick={() => removeRecipient(i)}>✕</button>}
                </div>
                <div className="size-mode-tabs">
                  <button className={`size-mode-tab ${r.sizeMode==="standard"?"active":""}`} onClick={()=>updateRecipient(i,"sizeMode","standard")}>Standard Size</button>
                  <button className={`size-mode-tab ${r.sizeMode==="custom"?"active":""}`} onClick={()=>updateRecipient(i,"sizeMode","custom")}>Custom Measurement</button>
                </div>
                {r.sizeMode==="standard" ? (
                  <select className="fabric-store-select" value={r.standardSize} onChange={e=>updateRecipient(i,"standardSize",e.target.value)}>
                    <option value="">— Select standard size —</option>
                    {STANDARD_SIZES.map(s=><option key={s}>{s}</option>)}
                  </select>
                ) : (
                  <div className="measurement-form">
                    {[{key:"chest",label:"Chest (in)"},{key:"waist",label:"Waist (in)"},{key:"hip",label:"Hip (in)"},{key:"length",label:"Length (in)"},{key:"shoulder",label:"Shoulder (in)"}].map(f=>(
                      <div key={f.key} className="measurement-field">
                        <label>{f.label}</label>
                        <input type="number" placeholder="e.g. 36" value={r.measurements[f.key]} onChange={e=>updateMeasurement(i,f.key,e.target.value)} className="measurement-input"/>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="custom-block full-width">
            <h4 className="custom-block-title">📝 Add Notes <span className="optional-tag">Optional</span></h4>
            <textarea className="notes-textarea" rows={3} placeholder="Special instructions, colour requests, embellishments..." value={notes} onChange={e=>setNotes(e.target.value)}/>
          </div>

          {submitError && <div className="auth-general-error" style={{ margin: "0 20px 16px" }}>⚠️ {submitError}</div>}

          <div className="custom-cta-row">
            <div className="custom-cta-info">
              {previewPrice != null && (
                <p>💰 Estimated Total: <strong>₹{previewPrice.toLocaleString()}</strong>
                  {fabricCost > 0 && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> (₹{fabricCost.toLocaleString()} fabric + ₹{totalStitchingCost.toLocaleString()} stitching)</span>}
                </p>
              )}
              <p>🚚 Estimated Delivery: <strong>10–15 working days</strong></p>
              <p>✂️ Crafted by expert tailors — guaranteed satisfaction</p>
            </div>
            <button className={`custom-cta-btn ${!readyToSubmit?"btn-disabled":""}`}
              onClick={handleProceedToAddress}
              disabled={!readyToSubmit}>
              Continue to Delivery Address →
            </button>
          </div>
        </div>
      </section>
      </>
      )}

      {step === "address" && !submittedOrder && (
        <section className="mjfy-section">
          <div className="section-header">
            <div>
              <button className="back-step-btn" onClick={() => setStep("customize")}>← Back to Customization</button>
              <h2 className="section-title">Delivery Address</h2>
            </div>
          </div>

          {savedAddresses.length > 0 && (
            <div className="saved-address-picker" style={{ maxWidth: 640 }}>
              <p className="saved-address-picker-label">📍 Choose a saved address, or enter a new one below</p>
              <div className="saved-address-chips">
                {savedAddresses.map(a => (
                  <button key={a.id} className={`saved-address-chip ${selectedSavedId===a.id?"selected":""}`} onClick={() => pickSavedAddress(a)}>
                    <span className="saved-address-chip-label">{a.label}{a.isDefault && " · Default"}</span>
                    <span className="saved-address-chip-line">{a.line1}, {a.city} — {a.pincode}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="address-form" style={{ maxWidth: 640 }}>
            <div className="addr-row two-col">
              {[{k:"name",l:"Full Name",p:"Your full name"},{k:"phone",l:"Mobile Number",p:"10-digit number"}].map(f=>(
                <div key={f.k} className="addr-field">
                  <label>{f.l}</label>
                  <input type="text" placeholder={f.p} value={address[f.k]} onChange={e=>{setA(f.k,e.target.value); setSelectedSavedId(null);}} className="addr-input"/>
                </div>
              ))}
            </div>
            <div className="addr-field">
              <label>Address Line 1</label>
              <input type="text" placeholder="Flat, House no., Building, Street" value={address.line1} onChange={e=>{setA("line1",e.target.value); setSelectedSavedId(null);}} className="addr-input"/>
            </div>
            <div className="addr-field">
              <label>Address Line 2 <span className="optional-tag">Optional</span></label>
              <input type="text" placeholder="Area, Colony, Locality" value={address.line2} onChange={e=>{setA("line2",e.target.value); setSelectedSavedId(null);}} className="addr-input"/>
            </div>
            <div className="addr-row three-col">
              {[{k:"city",l:"City",p:"City"},{k:"state",l:"State",p:"State"},{k:"pincode",l:"Pincode",p:"6-digit pincode"}].map(f=>(
                <div key={f.k} className="addr-field">
                  <label>{f.l}</label>
                  <input type="text" placeholder={f.p} value={address[f.k]}
                    onChange={e=>{
                      const v = f.k==="pincode" ? e.target.value.replace(/\D/g,"") : e.target.value;
                      setA(f.k,v); setSelectedSavedId(null);
                    }}
                    maxLength={f.k==="pincode"?6:undefined}
                    className="addr-input"/>
                </div>
              ))}
            </div>
            {submitError && <div className="auth-general-error" style={{marginTop:12}}>⚠️ {submitError}</div>}
            <button className="cart-continue-btn" onClick={handleProceedToPayment}>Proceed to Payment →</button>
          </div>
        </section>
      )}

      {step === "payment" && !submittedOrder && (
        <section className="mjfy-section">
          <div className="section-header">
            <div>
              <button className="back-step-btn" onClick={() => setStep("address")}>← Back to Address</button>
              <h2 className="section-title">Payment Method</h2>
            </div>
          </div>
          <div style={{ maxWidth: 640 }}>
            <div className="payment-methods">
              {[
                { key:"cod",  icon:"💵", label:"Cash on Delivery",     desc:"Pay when your order arrives" },
                { key:"upi",  icon:"📱", label:"UPI / GPay / PhonePe", desc:"Instant payment via UPI" },
                { key:"card", icon:"💳", label:"Credit / Debit Card",  desc:"Visa, Mastercard, RuPay" },
              ].map(m => (
                <label key={m.key} className={`payment-option ${payMethod===m.key?"selected":""}`}>
                  <input type="radio" name="mjfy-payment" checked={payMethod===m.key} onChange={()=>setPayMethod(m.key)}/>
                  <span className="pay-icon">{m.icon}</span>
                  <div className="pay-info">
                    <p className="pay-label">{m.label}</p>
                    <p className="pay-desc">{m.desc}</p>
                  </div>
                  <span className={`pay-radio ${payMethod===m.key?"active":""}`}/>
                </label>
              ))}
            </div>

            <div className="address-summary-card">
              <div className="addr-summary-header">
                <p className="addr-summary-title">📍 Delivering to</p>
                <button className="auth-link bold" onClick={()=>setStep("address")}>Change</button>
              </div>
              <p className="addr-summary-name">{address.name}</p>
              <p className="addr-summary-line">{address.line1}{address.line2 ? `, ${address.line2}` : ""}</p>
              <p className="addr-summary-line">{address.city}, {address.state} — {address.pincode}</p>
              <p className="addr-summary-phone">📞 {address.phone}</p>
            </div>

            {previewPrice != null && (
              <p style={{ margin: "14px 0", fontSize: "0.95rem" }}>
                💰 Total: <strong>₹{previewPrice.toLocaleString()}</strong>
                <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> (₹{fabricCost.toLocaleString()} fabric + ₹{totalStitchingCost.toLocaleString()} stitching)</span>
              </p>
            )}

            {submitError && <div className="auth-general-error" style={{marginBottom:12}}>⚠️ {submitError}</div>}

            <button className={`place-order-btn ${submitting?"placing":""}`} onClick={handleFinalSubmit} disabled={submitting}>
              {submitting ? <><span className="auth-spinner"/> Submitting…</> : "🛒 Submit Custom Order Request"}
            </button>
          </div>
        </section>
      )}

      {submittedOrder && (
        <section className="mjfy-section">
          <div className="custom-cart-summary">
            <h3 className="cart-summary-title">🛍️ Your Custom Order Summary</h3>
            <div className="cart-summary-grid">
              {[
                { icon: submittedOrder.design ? <img src={submittedOrder.design.image} alt="" className="cart-thumb"/> : submittedOrder.sourceProduct ? <img src={submittedOrder.sourceProduct.image} alt="" className="cart-thumb"/> : <span className="cart-summary-icon">🧵</span>,
                  label: "Fabric / Design", value: submittedOrder.design?.name || submittedOrder.sourceProduct?.name || "Your own saree" },
                { icon:<span className="cart-summary-icon">👗</span>, label:"Combo Type", value:submittedOrder.comboType },
                { icon:<span className="cart-summary-icon">👥</span>, label:"Garments", value:submittedOrder.recipients.map(r=>`${r.label} (${r.sizeMode==="standard"?r.standardSize:"Custom"})`).join(", ") },
                { icon:<span className="cart-summary-icon">💰</span>, label:"Price", value:`₹${submittedOrder.price.toLocaleString()} (₹${submittedOrder.fabricCost.toLocaleString()} fabric + ₹${submittedOrder.stitchingCost.toLocaleString()} stitching)` },
                { icon:<span className="cart-summary-icon">🚚</span>, label:"Delivery Estimate", value:"10–15 working days after confirmation" },
              ].map((row,i)=>(
                <div key={i} className="cart-summary-row">
                  {row.icon}
                  <div className="cart-info"><p className="cart-info-label">{row.label}</p><p className="cart-info-value">{row.value}</p></div>
                </div>
              ))}
            </div>
            {submittedOrder.notes&&<div className="cart-notes"><p className="cart-info-label">Your Notes:</p><p className="cart-notes-text">"{submittedOrder.notes}"</p></div>}
            <p className="cart-confirmation">✅ Request #{submittedOrder.id} submitted! Our team will contact you within 24 hours to confirm details and pricing. Track it anytime under "My Custom Orders".</p>
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
      {[{icon:"📦",label:"My Orders",tab:"myorders"},{icon:"🧵",label:"My Custom Orders",tab:"mycustomorders"},{icon:"♥",label:"Wishlist",tab:"wishlist"},{icon:"📍",label:"Saved Addresses",tab:"addresses"},{icon:"💳",label:"Payment Methods",tab:"paymentmethods"},{icon:"⚙️",label:"Account Settings",tab:"accountsettings"}].map(item=>(
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

// ─────────────────────────────────────────────────────────────────────────────
// MY CUSTOM ORDERS (Made For You request history)
// ─────────────────────────────────────────────────────────────────────────────
const CUSTOM_ORDER_STEPS = ["PENDING", "CONFIRMED", "IN_PROGRESS", "SHIPPED", "DELIVERED"];

function MyCustomOrdersPage({ user, onBrowse }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const load = useCallback(() => {
    if (!user?.token) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/custom-orders`, { headers: { Authorization: `Bearer ${user.token}` } })
      .then(async res => {
        const data = await res.json().catch(() => ([]));
        if (!res.ok) throw new Error(data.error || data.message || "Failed to load custom orders");
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
        <p>Sign in to view your custom stitch requests.</p>
      </div>
    );
  }

  if (loading) return <LoadingGrid/>;
  if (error) return <ErrorBanner message={error} onRetry={load}/>;

  if (orders.length === 0) {
    return (
      <div className="no-results">
        <p>🧵</p><h3>No custom orders yet</h3>
        <p>Create a "Made For You" request and it'll show up here.</p>
        <button className="cta-primary" onClick={onBrowse}>Explore Made For You</button>
      </div>
    );
  }

  return (
    <div className="my-orders-page">
      <div className="wishlist-header">
        <h2>My Custom Orders</h2>
        <p>{orders.length} request{orders.length !== 1 ? "s" : ""}</p>
      </div>
      <div className="orders-list">
        {orders.map(order => {
          const isOpen = expandedId === order.id;
          const stepIndex = CUSTOM_ORDER_STEPS.indexOf(order.status);
          const image = order.design?.image || order.sourceProduct?.image;
          const sourceLabel = order.design?.name || order.sourceProduct?.name || "Your own saree";
          return (
            <div key={order.id} className="order-card">
              <button className="order-card-header" onClick={() => setExpandedId(isOpen ? null : order.id)}>
                <div className="order-card-main">
                  <span className="order-id">Custom Request #{order.id}</span>
                  <span className="order-date">{new Date(order.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</span>
                </div>
                <div className="order-card-meta">
                  <span className={`order-status-badge ${order.status}`}>{order.status.replace("_", " ")}</span>
                  <span className="order-total">₹{order.price.toLocaleString()}</span>
                  <span className="order-expand-icon">{isOpen ? "▲" : "▼"}</span>
                </div>
              </button>

              {isOpen && (
                <div className="order-card-body">
                  <div className="order-progress">
                    {CUSTOM_ORDER_STEPS.map((step, i) => (
                      <div key={step} className={`order-progress-step ${i <= stepIndex ? "done" : ""}`}>
                        <span className="order-progress-dot"/>
                        <span className="order-progress-label">{step.replace("_", " ")}</span>
                      </div>
                    ))}
                  </div>

                  <div className="order-item-row">
                    {image
                      ? <img src={image} alt=""/>
                      : <span style={{ fontSize: "1.5rem" }}>🧵</span>}
                    <div className="order-item-info">
                      <span className="order-item-name">{sourceLabel}</span>
                      <span className="order-item-qty">{order.comboType} · {order.recipients.length} garment{order.recipients.length !== 1 ? "s" : ""}</span>
                    </div>
                    <span className="order-item-total">₹{order.price.toLocaleString()}</span>
                  </div>

                  <div className="order-items-list">
                    {order.recipients.map((r, i) => (
                      <div key={i} className="order-item-row">
                        <span style={{ fontSize: "1.2rem" }}>👤</span>
                        <div className="order-item-info">
                          <span className="order-item-name">{r.label}</span>
                          <span className="order-item-qty">{r.sizeMode === "standard" ? `Size: ${r.standardSize}` : "Custom measurements"}</span>
                        </div>
                        <span className="order-item-total">₹{r.stitchingCost.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>

                  <div className="order-summary-box">
                    <div className="order-summary-row"><span>Fabric / Design Cost</span><span>₹{order.fabricCost.toLocaleString()}</span></div>
                    <div className="order-summary-row"><span>Stitching ({order.recipients.length} garment{order.recipients.length !== 1 ? "s" : ""})</span><span>₹{order.stitchingCost.toLocaleString()}</span></div>
                    <div className="order-summary-row total"><span>Total</span><span>₹{order.price.toLocaleString()}</span></div>
                  </div>

                  {(order.blouseType || order.neckPattern || order.backDesign) && (
                    <div className="order-shipping-box">
                      <h4>Tailoring Details</h4>
                      {order.blouseType && <p>Blouse: {order.blouseType}</p>}
                      {order.neckPattern && <p>Neck: {order.neckPattern}</p>}
                      {order.backDesign && <p>Back: {order.backDesign}</p>}
                    </div>
                  )}

                  {order.referenceImage && (
                    <div className="order-shipping-box">
                      <h4>Reference Photo</h4>
                      <img src={order.referenceImage} alt="Reference" style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 8 }}/>
                    </div>
                  )}

                  {order.notes && (
                    <div className="order-shipping-box">
                      <h4>Your Notes</h4>
                      <p>"{order.notes}"</p>
                    </div>
                  )}

                  <p className="order-payment-method">Estimated delivery: 10–15 working days after confirmation</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SAVED ADDRESSES
// ─────────────────────────────────────────────────────────────────────────────
function AddressForm({ initial, onSave, onCancel, saving, error }) {
  const [form, setForm] = useState(initial || { label:"Home", name:"", phone:"", line1:"", line2:"", city:"", state:"", pincode:"", isDefault:false });
  const [pincodeError, setPincodeError] = useState("");
  const set = (k,v) => setForm(f => ({ ...f, [k]: v }));

  const handleSaveClick = () => {
    if (!isValidIndianPincode(form.pincode)) {
      setPincodeError("Sorry, we currently only deliver within India — that doesn't look like a valid 6-digit Indian PIN code (non-serviceable area).");
      return;
    }
    setPincodeError("");
    onSave(form);
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="admin-modal-box" onClick={e=>e.stopPropagation()} style={{ maxWidth: 460 }}>
        <h3 style={{ marginTop: 0 }}>{initial ? "Edit Address" : "Add New Address"}</h3>
        {error && <div className="auth-general-error" style={{ marginBottom: 12 }}>⚠️ {error}</div>}
        <div className="admin-form-row">
          <label>Label</label>
          <select value={form.label} onChange={e=>set("label",e.target.value)}>
            {["Home","Work","Other"].map(l=><option key={l}>{l}</option>)}
          </select>
        </div>
        <div className="admin-two-col">
          <div className="admin-form-row"><label>Full Name</label><input value={form.name} onChange={e=>set("name",e.target.value)}/></div>
          <div className="admin-form-row"><label>Phone</label><input value={form.phone} onChange={e=>set("phone",e.target.value)}/></div>
        </div>
        <div className="admin-form-row"><label>Address Line 1</label><input value={form.line1} onChange={e=>set("line1",e.target.value)}/></div>
        <div className="admin-form-row"><label>Address Line 2 (optional)</label><input value={form.line2} onChange={e=>set("line2",e.target.value)}/></div>
        <div className="admin-two-col">
          <div className="admin-form-row"><label>City</label><input value={form.city} onChange={e=>set("city",e.target.value)}/></div>
          <div className="admin-form-row"><label>State</label><input value={form.state} onChange={e=>set("state",e.target.value)}/></div>
        </div>
        <div className="admin-form-row">
          <label>Pincode</label>
          <input value={form.pincode} maxLength={6} onChange={e=>{ set("pincode",e.target.value.replace(/\D/g,"")); setPincodeError(""); }}/>
          {pincodeError && <p style={{ color:"#b91c1c", fontSize:"0.78rem", marginTop:6 }}>⚠️ {pincodeError}</p>}
        </div>
        <div className="admin-form-row admin-checkbox-row">
          <input type="checkbox" checked={form.isDefault} onChange={e=>set("isDefault",e.target.checked)} id="addr-default"/>
          <label htmlFor="addr-default" style={{ marginBottom: 0 }}>Set as default address</label>
        </div>
        <div className="admin-form-actions">
          <button className="admin-btn admin-btn-outline" onClick={onCancel}>Cancel</button>
          <button className="admin-btn admin-btn-primary" disabled={saving} onClick={handleSaveClick}>{saving?"Saving…":"Save Address"}</button>
        </div>
      </div>
    </div>
  );
}

function SavedAddressesPage({ user }) {
  const [addresses, setAddresses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(() => {
    if (!user?.token) { setLoading(false); return; }
    setLoading(true);
    setError("");
    fetch(`${API_BASE}/addresses`, { headers: { Authorization: `Bearer ${user.token}` } })
      .then(async res => {
        const data = await res.json().catch(() => ([]));
        if (!res.ok) throw new Error(data.message || data.error || "Failed to load addresses");
        return data;
      })
      .then(data => setAddresses(Array.isArray(data) ? data : []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [user?.token]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (form) => {
    setSaving(true); setFormError("");
    try {
      const res = await fetch(`${API_BASE}/addresses${editing?.id ? `/${editing.id}` : ""}`, {
        method: editing?.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to save address");
      setEditing(null);
      load();
    } catch (e) { setFormError(e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this address?")) return;
    try {
      const res = await fetch(`${API_BASE}/addresses/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${user.token}` } });
      if (!res.ok) throw new Error("Failed to delete");
      load();
    } catch (e) { alert(e.message); }
  };

  const handleSetDefault = async (id) => {
    try {
      await fetch(`${API_BASE}/addresses/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
        body: JSON.stringify({ isDefault: true }),
      });
      load();
    } catch (e) { alert(e.message); }
  };

  if (!user) return <div className="no-results"><p>🔒</p><h3>Please sign in</h3><p>Sign in to manage your saved addresses.</p></div>;
  if (loading) return <LoadingGrid/>;

  return (
    <div className="my-orders-page">
      <div className="wishlist-header"><h2>Saved Addresses</h2><p>{addresses.length} address{addresses.length!==1?"es":""} saved</p></div>
      {error && <div className="auth-general-error" style={{ marginBottom: 16 }}>⚠️ {error}</div>}
      <div style={{ marginBottom: 16 }}>
        <button className="cta-primary" onClick={() => setEditing({})}>+ Add New Address</button>
      </div>
      {addresses.length === 0 ? (
        <div className="no-results"><p>📍</p><h3>No saved addresses yet</h3><p>Add one to speed up checkout next time.</p></div>
      ) : (
        <div className="orders-list">
          {addresses.map(a => (
            <div key={a.id} className="order-card">
              <div className="order-card-body" style={{ borderTop: "none", paddingTop: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <p style={{ fontWeight: 700, marginBottom: 4 }}>{a.label} {a.isDefault && <span className="order-status-badge DELIVERED">Default</span>}</p>
                    <p style={{ margin: "2px 0" }}>{a.name} · {a.phone}</p>
                    <p style={{ margin: "2px 0", color: "var(--text-muted)" }}>{a.line1}{a.line2 ? `, ${a.line2}` : ""}</p>
                    <p style={{ margin: "2px 0", color: "var(--text-muted)" }}>{a.city}, {a.state} — {a.pincode}</p>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <button className="admin-btn admin-btn-outline admin-btn-sm" onClick={() => setEditing(a)}>Edit</button>
                    {!a.isDefault && <button className="admin-btn admin-btn-outline admin-btn-sm" onClick={() => handleSetDefault(a.id)}>Set Default</button>}
                    <button className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => handleDelete(a.id)}>Delete</button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing !== null && (
        <AddressForm initial={editing.id ? editing : null} saving={saving} error={formError}
          onCancel={() => { setEditing(null); setFormError(""); }} onSave={handleSave}/>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT METHODS
// ─────────────────────────────────────────────────────────────────────────────
function PaymentMethodsPage({ user }) {
  const [method, setMethod] = useState("COD");
  const [upiId, setUpiId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!user?.token) { setLoading(false); return; }
    fetch(`${API_BASE}/users/me`, { headers: { Authorization: `Bearer ${user.token}` } })
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || data.error || "Failed to load payment preference");
        return data;
      })
      .then(d => { setMethod(d.preferredPaymentMethod || "COD"); setUpiId(d.savedUpiId || ""); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [user?.token]);

  const handleSave = async () => {
    setSaving(true); setError(""); setSaved(false);
    try {
      const res = await fetch(`${API_BASE}/users/payment-preference`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
        body: JSON.stringify({ preferredPaymentMethod: method, savedUpiId: upiId || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to save");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  if (!user) return <div className="no-results"><p>🔒</p><h3>Please sign in</h3><p>Sign in to manage payment preferences.</p></div>;
  if (loading) return <LoadingGrid/>;

  return (
    <div className="my-orders-page">
      <div className="wishlist-header"><h2>Payment Methods</h2><p>Your default checkout preference</p></div>
      <div className="order-card" style={{ padding: 24 }}>
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: 18 }}>
          We don't store card numbers — that needs a proper payment gateway, which isn't connected yet.
          For now you can set your preferred payment method so it's pre-selected at checkout, and save your UPI ID for quick reference.
        </p>
        {error && <div className="auth-general-error" style={{ marginBottom: 14 }}>⚠️ {error}</div>}
        <div className="payment-methods">
          {[
            { key:"COD",  icon:"💵", label:"Cash on Delivery",     desc:"Pay when your order arrives" },
            { key:"UPI",  icon:"📱", label:"UPI / GPay / PhonePe", desc:"Instant payment via UPI" },
            { key:"CARD", icon:"💳", label:"Credit / Debit Card",  desc:"Visa, Mastercard, RuPay" },
          ].map(m => (
            <label key={m.key} className={`payment-option ${method===m.key?"selected":""}`}>
              <input type="radio" name="pref-payment" checked={method===m.key} onChange={()=>setMethod(m.key)}/>
              <span className="pay-icon">{m.icon}</span>
              <div className="pay-info"><p className="pay-label">{m.label}</p><p className="pay-desc">{m.desc}</p></div>
              <span className={`pay-radio ${method===m.key?"active":""}`}/>
            </label>
          ))}
        </div>
        {method === "UPI" && (
          <div className="admin-form-row" style={{ marginTop: 16, maxWidth: 320 }}>
            <label>Your UPI ID (optional, for your reference)</label>
            <input value={upiId} onChange={e=>setUpiId(e.target.value)} placeholder="yourname@upi"/>
          </div>
        )}
        <div className="admin-form-actions" style={{ justifyContent: "flex-start", marginTop: 20 }}>
          <button className="admin-btn admin-btn-primary" disabled={saving} onClick={handleSave}>
            {saving ? "Saving…" : saved ? "✓ Saved" : "Save Preference"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCOUNT SETTINGS
// ─────────────────────────────────────────────────────────────────────────────
function AccountSettingsPage({ user }) {
  const [profile, setProfile] = useState(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState("");
  const [nameSaved, setNameSaved] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPass, setSavingPass] = useState(false);
  const [passError, setPassError] = useState("");
  const [passSaved, setPassSaved] = useState(false);

  const [profileError, setProfileError] = useState("");

  useEffect(() => {
    if (!user?.token) { setLoading(false); return; }
    fetch(`${API_BASE}/users/me`, { headers: { Authorization: `Bearer ${user.token}` } })
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || data.error || "Failed to load your profile");
        return data;
      })
      .then(d => { setProfile(d); setName(d.name); })
      .catch(e => setProfileError(e.message))
      .finally(() => setLoading(false));
  }, [user?.token]);

  const handleSaveName = async () => {
    if (!name.trim()) { setNameError("Name is required"); return; }
    setSavingName(true); setNameError(""); setNameSaved(false);
    try {
      const res = await fetch(`${API_BASE}/users/me`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to update name");
      setNameSaved(true);
      // Keep the locally stored session's display name in sync
      const updatedUser = { ...user, name: data.name };
      localStorage.setItem("user", JSON.stringify(updatedUser));
      setTimeout(() => setNameSaved(false), 2500);
    } catch (e) { setNameError(e.message); }
    finally { setSavingName(false); }
  };

  const handleChangePassword = async () => {
    setPassError(""); setPassSaved(false);
    if (!currentPassword || !newPassword) { setPassError("Please fill in both password fields."); return; }
    if (newPassword.length < 6) { setPassError("New password must be at least 6 characters."); return; }
    if (newPassword !== confirmPassword) { setPassError("Passwords do not match."); return; }
    setSavingPass(true);
    try {
      const res = await fetch(`${API_BASE}/users/change-password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to change password");
      setPassSaved(true);
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setTimeout(() => setPassSaved(false), 2500);
    } catch (e) { setPassError(e.message); }
    finally { setSavingPass(false); }
  };

  if (!user) return <div className="no-results"><p>🔒</p><h3>Please sign in</h3><p>Sign in to manage your account.</p></div>;
  if (loading) return <LoadingGrid/>;

  return (
    <div className="my-orders-page">
      <div className="wishlist-header"><h2>Account Settings</h2><p>Manage your profile and password</p></div>
      {profileError && <div className="auth-general-error" style={{ marginBottom: 16 }}>⚠️ {profileError}</div>}

      <div className="order-card" style={{ padding: 24, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0, fontSize: "1.05rem" }}>Profile</h3>
        {nameError && <div className="auth-general-error" style={{ marginBottom: 12 }}>⚠️ {nameError}</div>}
        <div className="admin-form-row">
          <label>Full Name</label>
          <input value={name} onChange={e=>setName(e.target.value)}/>
        </div>
        <div className="admin-form-row">
          <label>Email</label>
          <input value={profile?.email || ""} disabled style={{ background: "var(--surface2)", color: "var(--text-muted)" }}/>
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 4 }}>Email can't be changed here yet.</p>
        </div>
        <div className="admin-form-actions" style={{ justifyContent: "flex-start" }}>
          <button className="admin-btn admin-btn-primary" disabled={savingName} onClick={handleSaveName}>
            {savingName ? "Saving…" : nameSaved ? "✓ Saved" : "Save Name"}
          </button>
        </div>
      </div>

      <div className="order-card" style={{ padding: 24 }}>
        <h3 style={{ marginTop: 0, fontSize: "1.05rem" }}>Change Password</h3>
        {passError && <div className="auth-general-error" style={{ marginBottom: 12 }}>⚠️ {passError}</div>}
        <div className="admin-form-row"><label>Current Password</label><input type="password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)}/></div>
        <div className="admin-two-col">
          <div className="admin-form-row"><label>New Password</label><input type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)}/></div>
          <div className="admin-form-row"><label>Confirm New Password</label><input type="password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)}/></div>
        </div>
        <div className="admin-form-actions" style={{ justifyContent: "flex-start" }}>
          <button className="admin-btn admin-btn-primary" disabled={savingPass} onClick={handleChangePassword}>
            {savingPass ? "Changing…" : passSaved ? "✓ Changed" : "Change Password"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CartPage({ cartItems, onUpdateQty, onRemove, onClearCart, onContinue, onCheckout, onGoToOrders, user }) {
  const priceOf = (item) => item.variant?.price ?? item.product.price;
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
  const [pincodeError, setPincodeError] = useState("");

  const [savedAddresses, setSavedAddresses] = useState([]);
  const [selectedSavedId, setSelectedSavedId] = useState(null);

  useEffect(() => {
    if (!user?.token) return;
    fetch(`${API_BASE}/addresses`, { headers: { Authorization: `Bearer ${user.token}` } })
      .then(async res => {
        const data = await res.json().catch(() => ([]));
        return res.ok && Array.isArray(data) ? data : [];
      })
      .then(list => {
        setSavedAddresses(list);
        const def = list.find(a => a.isDefault);
        if (def && !address.name) {
          setAddress({ name:def.name, phone:def.phone, line1:def.line1, line2:def.line2||"", city:def.city, state:def.state||"", pincode:def.pincode });
          setSelectedSavedId(def.id);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.token]);

  const pickSavedAddress = (a) => {
    setAddress({ name:a.name, phone:a.phone, line1:a.line1, line2:a.line2||"", city:a.city, state:a.state||"", pincode:a.pincode });
    setSelectedSavedId(a.id);
    setPincodeError("");
  };

  const FREE_SHIP_THRESHOLD = 999;

  // ── Totals ──
  const subtotal     = cartItems.reduce((s, i) => s + priceOf(i) * i.qty, 0);
  const totalSavings = cartItems.reduce((s, i) => s + ((i.product.originalPrice || priceOf(i)) - priceOf(i)) * i.qty, 0);
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
                  const hasDiscount = item.product.originalPrice > priceOf(item);
                  const saving = hasDiscount ? (item.product.originalPrice - priceOf(item)) * item.qty : 0;
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
                              {item.variant?.size && <span className="meta-tag">Size: {item.variant.size}</span>}
                              {item.variant?.color && (
                                <span className="meta-tag color-meta">
                                  <span className="meta-color-dot" style={{ background: item.variant.color }}/>
                                  {item.variant.color}
                                </span>
                              )}
                              {item.isCustom && <span className="meta-tag custom-meta">Custom Stitch • 10–15 days</span>}
                            </div>
                          </div>
                          <button className="cart-remove-btn" onClick={() => onRemove(item.key)} title="Remove">✕</button>
                        </div>

                        <div className="cart-item-bottom">
                          <div className="cart-item-pricing">
                            <span className="cart-item-price">₹{(priceOf(item) * item.qty).toLocaleString()}</span>
                            {hasDiscount && <span className="cart-item-original">₹{(item.product.originalPrice * item.qty).toLocaleString()}</span>}
                            {saving > 0 && <span className="cart-item-saving">Save ₹{saving.toLocaleString()}</span>}
                          </div>

                          <div className="cart-qty-control">
                            <button onClick={() => onUpdateQty(item.key, item.qty - 1)}>−</button>
                            <span>{item.qty}</span>
                            <button onClick={() => onUpdateQty(item.key, item.qty + 1)}
                              disabled={item.qty >= (item.variant?.stock ?? item.product.stock ?? 99)}>+</button>
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

              {savedAddresses.length > 0 && (
                <div className="saved-address-picker">
                  <p className="saved-address-picker-label">📍 Choose a saved address, or enter a new one below</p>
                  <div className="saved-address-chips">
                    {savedAddresses.map(a => (
                      <button key={a.id} className={`saved-address-chip ${selectedSavedId===a.id?"selected":""}`} onClick={() => pickSavedAddress(a)}>
                        <span className="saved-address-chip-label">{a.label}{a.isDefault && " · Default"}</span>
                        <span className="saved-address-chip-line">{a.line1}, {a.city} — {a.pincode}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="address-form">
                <div className="addr-row two-col">
                  {[{k:"name",l:"Full Name",p:"Your full name"},{k:"phone",l:"Mobile Number",p:"10-digit number"}].map(f=>(
                    <div key={f.k} className="addr-field">
                      <label>{f.l}</label>
                      <input type="text" placeholder={f.p} value={address[f.k]} onChange={e=>{setA(f.k,e.target.value); setSelectedSavedId(null);}} className="addr-input"/>
                    </div>
                  ))}
                </div>
                <div className="addr-field">
                  <label>Address Line 1</label>
                  <input type="text" placeholder="Flat, House no., Building, Street" value={address.line1} onChange={e=>{setA("line1",e.target.value); setSelectedSavedId(null);}} className="addr-input"/>
                </div>
                <div className="addr-field">
                  <label>Address Line 2 <span className="optional-tag">Optional</span></label>
                  <input type="text" placeholder="Area, Colony, Locality" value={address.line2} onChange={e=>{setA("line2",e.target.value); setSelectedSavedId(null);}} className="addr-input"/>
                </div>
                <div className="addr-row three-col">
                  {[{k:"city",l:"City",p:"City"},{k:"state",l:"State",p:"State"},{k:"pincode",l:"Pincode",p:"6-digit pincode"}].map(f=>(
                    <div key={f.k} className="addr-field">
                      <label>{f.l}</label>
                      <input type="text" placeholder={f.p} value={address[f.k]}
                        onChange={e=>{
                          const v = f.k==="pincode" ? e.target.value.replace(/\D/g,"") : e.target.value;
                          setA(f.k,v); setSelectedSavedId(null); if (f.k==="pincode") setPincodeError("");
                        }}
                        maxLength={f.k==="pincode"?6:undefined}
                        className="addr-input"/>
                    </div>
                  ))}
                </div>
                {pincodeError && <p style={{ color:"#b91c1c", fontSize:"0.82rem", marginTop:8 }}>⚠️ {pincodeError}</p>}
              </div>

              <button
                className="cart-continue-btn"
                onClick={() => {
                  if (!address.name || !address.phone || !address.line1 || !address.city || !address.pincode) {
                    alert("Please fill all required address fields.");
                    return;
                  }
                  if (!isValidIndianPincode(address.pincode)) {
                    setPincodeError("Sorry, we currently only deliver within India — that doesn't look like a valid 6-digit Indian PIN code (non-serviceable area).");
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
                  <span className="summary-item-price">₹{(priceOf(item) * item.qty).toLocaleString()}</span>
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // ── Search ──
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);

  // ── Filters ──
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterSubcategory, setFilterSubcategory] = useState(null);
  const [filterPrice, setFilterPrice] = useState(null);
  const [filterRating, setFilterRating] = useState(null);
  const [saleOnly, setSaleOnly] = useState(false); // "Sale" footer link: show only discounted products
  const [infoModal, setInfoModal] = useState(null); // null | "sizeguide" | "returns" — footer/legal info popups
  const [sortBy, setSortBy] = useState("popular");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ── Product state ──
  const [viewProduct, setViewProduct] = useState(null);
  const [wishlist, setWishlist] = useState([]);
  const [pickingFabricMode, setPickingFabricMode] = useState(false);
  const [customFabricPick, setCustomFabricPick] = useState(null);

  const handleBrowseSareesForCustom = () => {
    setPickingFabricMode(true);
    setFilterCategory("women");
    setFilterSubcategory(null);
    setActiveTab("collection");
  };

  const handlePickFabric = (product) => {
    setCustomFabricPick(product);
    setPickingFabricMode(false);
    setActiveTab("madejustforyou");
  };

  // ── Cart state: [{ product, qty, size, color }] ──
  const [cartItems, setCartItems] = useState([]);
  const cartCount = cartItems.reduce((s, i) => s + i.qty, 0);

  const addToCart = (product, qty = 1, variant = null, cartItemId = null) => {
    setCartItems(prev => {
      const key = `${product.id}-${variant?.id ?? "novariant"}`;
      const existing = prev.find(i => i.key === key);
      const maxStock = variant ? variant.stock : (product.stock || 99);
      if (existing) {
        return prev.map(i => i.key === key
          ? { ...i, qty: Math.min(i.qty + qty, maxStock), cartItemId: cartItemId ?? i.cartItemId }
          : i);
      }
      return [...prev, { key, product, qty, variant, cartItemId }];
    });
  };

  const removeFromCart = (key) => {
    setCartItems(prev => {
      const item = prev.find(i => i.key === key);
      if (item?.cartItemId && user?.token) {
        fetch(`${API_BASE}/cart/${item.cartItemId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${user.token}` },
        }).catch(err => console.error("Failed to sync cart removal:", err.message));
      }
      return prev.filter(i => i.key !== key);
    });
  };

  const updateQty = (key, qty) => {
    if (qty < 1) { removeFromCart(key); return; }
    setCartItems(prev => {
      const item = prev.find(i => i.key === key);
      if (item?.cartItemId && user?.token) {
        fetch(`${API_BASE}/cart/${item.cartItemId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
          body: JSON.stringify({ quantity: qty }),
        }).catch(err => console.error("Failed to sync quantity update:", err.message));
      }
      return prev.map(i => i.key === key ? { ...i, qty } : i);
    });
  };

  const clearCart = () => setCartItems([]);

  // ── Hero ──
  const [heroSlide, setHeroSlide] = useState(0);
  const [heroBanner, setHeroBanner] = useState(null); // admin-set background override for slide 1
  useEffect(() => {
    fetch(`${API_BASE}/hero-banner`)
      .then(res => res.json()).then(setHeroBanner)
      .catch(() => setHeroBanner(null)); // fetch failure just falls back to the default gradient
  }, []);

  // ── Vouchers (real, admin-created promotions) ──
  const [activePromotions, setActivePromotions] = useState([]);
  const [copiedVoucherCode, setCopiedVoucherCode] = useState(null);
  useEffect(() => {
    fetch(`${API_BASE}/promotions/active`)
      .then(res => res.json()).then(data => setActivePromotions(Array.isArray(data) ? data : []))
      .catch(() => setActivePromotions([]));
  }, []);
  const handleVoucherClick = (code) => {
    navigator.clipboard?.writeText(code).catch(() => {});
    setCopiedVoucherCode(code);
    setTimeout(() => setCopiedVoucherCode(c => (c === code ? null : c)), 1500);
  };

  // ── Category card images (admin-uploaded, optional per category) ──
  const [categoryImages, setCategoryImages] = useState({});
  useEffect(() => {
    fetch(`${API_BASE}/category-images`)
      .then(res => res.json()).then(setCategoryImages)
      .catch(() => setCategoryImages({})); // fetch failure just falls back to default gradient cards
  }, []);

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

  // Restore the logged-in user's actual cart from the backend once products are loaded —
  // without this, refreshing the page shows an empty cart even though the backend still
  // has the real items (they're just not reflected in local state until now).
  useEffect(() => {
    if (!user?.token || products.length === 0 || cartItems.length > 0) return;
    fetch(`${API_BASE}/cart`, { headers: { Authorization: `Bearer ${user.token}` } })
      .then(res => res.json())
      .then(cart => {
        if (!cart?.items?.length) return;
        const restored = cart.items
          .map(ci => {
            const product = products.find(p => p.id === ci.productId);
            if (!product) return null;
            return { key: `${ci.productId}-${ci.variantId ?? "novariant"}`, product, qty: ci.quantity, variant: ci.variant || null, cartItemId: ci.id };
          })
          .filter(Boolean);
        if (restored.length > 0) setCartItems(restored);
      })
      .catch(err => console.error("Failed to restore cart:", err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, products]);

  const DEFAULT_HERO_BG = "linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%)";
  // Admin can only override slide 1's background — headline/sub/CTA stay as-is either way.
  // An image background gets a dark overlay layered on top so the existing white text stays readable.
  const heroSlide1Bg =
    heroBanner?.backgroundType === "image" && heroBanner.backgroundImage
      ? `linear-gradient(rgba(10,14,30,0.55),rgba(10,14,30,0.55)), url("${heroBanner.backgroundImage}") center/cover no-repeat`
      : heroBanner?.backgroundType === "color" && heroBanner.backgroundColor
      ? heroBanner.backgroundColor
      : DEFAULT_HERO_BG;

  const heroSlides = [
    { bg:heroSlide1Bg, headline:"New Season Arrivals", sub:"Discover the latest in fashion — curated just for you", cta:"Shop Now" },
    { bg:"linear-gradient(135deg,#2d1b4e 0%,#6b2fa0 50%,#a855f7 100%)", headline:"Women's Exclusive Edit", sub:"Elevate your style with our premium women's collection", cta:"Explore Women's" },
    { bg:"linear-gradient(135deg,#0d2137 0%,#1a4b6e 50%,#2980b9 100%)", headline:"Men's Essentials", sub:"Smart, sharp, and effortlessly styled", cta:"Shop Men's" },
  ];

  useEffect(()=>{ const t=setInterval(()=>setHeroSlide(s=>(s+1)%heroSlides.length),4500); return()=>clearInterval(t); },[heroSlides.length]);
  useEffect(()=>{ const h=()=>{ setOpenDropdown(null); setUserDropOpen(false); }; document.addEventListener("click",h); return()=>document.removeEventListener("click",h); },[]);

  const toggleWishlist = id => setWishlist(w => w.includes(id) ? w.filter(x=>x!==id) : [...w,id]);

  // ── Add to cart (real API + local state) ──
  const handleAddToCart = async (product, qty, variant = null) => {
    try {
      if (user?.token) {
        const result = await apiAddToCart(product.id, qty, user.token, variant?.id);
        addToCart(product, qty, variant, result.id);
      } else {
        addToCart(product, qty, variant);
      }
    } catch (err) {
      throw err;
    }
  };

  const navigateTo = (tab, category=null, subcategory=null) => {
    setActiveTab(tab);
    if (category) setFilterCategory(category); else if (tab==="collection") setFilterCategory("all");
    setFilterSubcategory(subcategory);
    setSaleOnly(false); // any normal navigation clears the "Sale" footer filter so it doesn't stick around unexpectedly
    setOpenDropdown(null);
  };

  const viewSaleItems = () => {
    navigateTo("collection");
    setSaleOnly(true);
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
      const saleMatch = !saleOnly || (p.originalPrice && p.originalPrice > p.price);
      const searchMatch = !searchQuery ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.description || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.categoryKey.includes(searchQuery.toLowerCase());
      return catMatch && subMatch && priceMatch && ratingMatch && saleMatch && searchMatch;
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
        <button className="mobile-menu-btn" onClick={()=>setMobileMenuOpen(o=>!o)} aria-label="Open menu">
          <span/><span/><span/>
        </button>
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

      {/* ══ MOBILE MENU DRAWER ══ */}
      {mobileMenuOpen && (
        <div className="mobile-menu-overlay" onClick={()=>setMobileMenuOpen(false)}>
          <div className="mobile-menu-drawer" onClick={e=>e.stopPropagation()}>
            <div className="mobile-menu-header">
              <span className="brand-text">ELMA'S FASHION</span>
              <button className="mobile-menu-close" onClick={()=>setMobileMenuOpen(false)}>✕</button>
            </div>

            <div className="mobile-search-wrap">
              <span className="search-icon">🔍</span>
              <input type="text" placeholder="Search products..." value={searchQuery}
                onChange={e=>setSearchQuery(e.target.value)}
                onKeyDown={e=>{ if(e.key==="Enter"&&searchQuery){ navigateTo("collection","all"); setMobileMenuOpen(false); } }}
                className="search-input"/>
            </div>

            <ul className="mobile-nav-links">
              {NAV_LINKS.map(link=>(
                <li key={link.key}>
                  <button className={`mobile-nav-link ${link.special?"nav-link-special":""}`}
                    onClick={()=>{
                      if(link.key==="home"||link.key==="collection"||link.key==="madejustforyou") navigateTo(link.key);
                      else navigateTo("collection",link.key);
                      setMobileMenuOpen(false);
                    }}>
                    {link.label}
                  </button>
                </li>
              ))}
            </ul>

            <div className="mobile-menu-divider"/>

            <div className="mobile-menu-actions">
              <button className="mobile-menu-action-btn" onClick={()=>{ setActiveTab("wishlist"); setMobileMenuOpen(false); }}>
                ♥ Wishlist <span className="badge-count">{wishlist.length}</span>
              </button>
              <button className="mobile-menu-action-btn" onClick={()=>{ setActiveTab("cart"); setMobileMenuOpen(false); }}>
                🛒 Cart <span className="badge-count">{cartCount}</span>
              </button>
            </div>

            <div className="mobile-menu-divider"/>

            {user ? (
              <div className="mobile-menu-account">
                <p className="mobile-menu-account-name">👤 {user.name}</p>
                {[{icon:"📦",label:"My Orders",tab:"myorders"},{icon:"🧵",label:"My Custom Orders",tab:"mycustomorders"},{icon:"📍",label:"Saved Addresses",tab:"addresses"},{icon:"💳",label:"Payment Methods",tab:"paymentmethods"},{icon:"⚙️",label:"Account Settings",tab:"accountsettings"}].map(item=>(
                  <button key={item.tab} className="mobile-menu-action-btn" onClick={()=>{ setActiveTab(item.tab); setMobileMenuOpen(false); }}>
                    {item.icon} {item.label}
                  </button>
                ))}
                <button className="mobile-menu-action-btn logout" onClick={()=>{
                  localStorage.removeItem("user"); localStorage.removeItem("token"); setUser(null);
                  clearCart(); setWishlist([]); setMobileMenuOpen(false);
                }}>🚪 Sign Out</button>
              </div>
            ) : (
              <div className="mobile-menu-auth-btns">
                <button className="nav-login-btn" onClick={()=>{ setAuthModal("login"); setMobileMenuOpen(false); }}>Sign In</button>
                <button className="nav-register-btn" onClick={()=>{ setAuthModal("register"); setMobileMenuOpen(false); }}>Register</button>
              </div>
            )}
          </div>
        </div>
      )}

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

          {activePromotions.length > 0 && (
            <section className="vouchers">
              {activePromotions.map((p) => {
                const { icon, title, sub } = voucherDisplay(p);
                const copied = copiedVoucherCode === p.code;
                return (
                  <div key={p.id} className="voucher-card" onClick={() => handleVoucherClick(p.code)} title="Click to copy code">
                    <span className="voucher-icon">{icon}</span>
                    <h4>{title}</h4><p>{sub}</p>
                    <span className="voucher-code">{copied ? "Copied!" : p.code}</span>
                  </div>
                );
              })}
            </section>
          )}

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
              ].map(cat=>{
                const img = categoryImages[cat.key];
                return (
                  <div
                    key={cat.key}
                    className={`cat-card ${img ? "has-image" : ""}`}
                    style={img ? { backgroundImage: `url("${img}")` } : { background: cat.gradient }}
                    onClick={()=>navigateTo("collection",cat.key)}
                  >
                    {!img && <span className="cat-emoji">{cat.emoji}</span>}
                    <h3>{cat.label}</h3><p>{cat.items}</p>
                    <span className="cat-arrow">→</span>
                  </div>
                );
              })}
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
                <p>
                  Elma's Fashion is your online destination for trendy men's, women's, boys', and girls' clothing in India,
                  with new-season styles added regularly across ethnic wear, casuals, and everyday essentials.
                  Beyond ready-to-wear, our Made For You custom stitching service lets you get sarees and outfits
                  tailored to your exact measurements — quality fashion, delivered to your door.
                </p>
              </div>
              <div>
                <h4>Quick Links</h4>
                <ul>
                  <li><span className="footer-link" onClick={()=>navigateTo("collection","men")}>Men</span></li>
                  <li><span className="footer-link" onClick={()=>navigateTo("collection","women")}>Women</span></li>
                  <li><span className="footer-link" onClick={()=>navigateTo("collection","boys")}>Boys</span></li>
                  <li><span className="footer-link" onClick={()=>navigateTo("collection","girls")}>Girls</span></li>
                  <li><span className="footer-link" onClick={()=>navigateTo("madejustforyou")}>Made For You</span></li>
                  <li><span className="footer-link" onClick={viewSaleItems}>Sale</span></li>
                </ul>
              </div>
              <div>
                <h4>Customer Care</h4>
                <ul>
                  <li><span className="footer-link" onClick={()=>navigateTo("myorders")}>My Orders</span></li>
                  <li><span className="footer-link" onClick={()=>navigateTo("mycustomorders")}>Custom Orders</span></li>
                  <li><span className="footer-link" onClick={()=>setInfoModal("returns")}>Returns</span></li>
                  <li><span className="footer-link" onClick={()=>navigateTo("myorders")}>Track Order</span></li>
                  <li><span className="footer-link" onClick={()=>setInfoModal("sizeguide")}>Size Guide</span></li>
                  <li><a className="footer-link" href="mailto:elmafashionstore@gmail.com">Contact Us</a></li>
                </ul>
              </div>
              <div>
                <h4>Connect</h4>
                <p><a href="mailto:elmafashionstore@gmail.com" className="footer-contact-link">📧 elmafashionstore@gmail.com</a></p>
                <p><a href="tel:+919445579303" className="footer-contact-link">📞 +91 94455 79303</a></p>
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

      {/* ══ FOOTER INFO MODALS (Size Guide / Returns) ══ */}
      {infoModal && (
        <div className="modal-overlay" onClick={()=>setInfoModal(null)}>
          <div className="modal-box" onClick={e=>e.stopPropagation()} style={{ maxWidth: 520, padding: 28 }}>
            <button className="modal-close" onClick={()=>setInfoModal(null)}>✕</button>
            <h2 style={{ marginTop: 0, marginBottom: 16 }}>{infoModal === "sizeguide" ? "Size Guide" : "Returns & Exchanges"}</h2>
            {infoModal === "sizeguide" ? <SizeGuideContent/> : <ReturnsPolicyContent/>}
          </div>
        </div>
      )}

      {/* ══ COLLECTION ══ */}
      {activeTab==="collection" && (
        <div className="collection-page">
          {pickingFabricMode && (
            <div className="fabric-picking-banner">
              <span>🧵 Selecting a saree for your custom stitch order — click any product below to choose it.</span>
              <button onClick={() => setPickingFabricMode(false)}>Cancel</button>
            </div>
          )}
          <aside className={`filter-sidebar ${sidebarOpen?"open":""}`}>
            <div className="sidebar-header">
              <h3>Filters</h3>
              <button className="clear-filters" onClick={()=>{ setFilterCategory("all"); setFilterSubcategory(null); setFilterPrice(null); setFilterRating(null); setSaleOnly(false); }}>Clear All</button>
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
              {saleOnly&&<span className="filter-chip">Sale<button onClick={()=>setSaleOnly(false)}>✕</button></span>}
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
                 <button className="cta-primary" onClick={()=>{ setFilterCategory("all"); setFilterSubcategory(null); setFilterPrice(null); setFilterRating(null); setSearchQuery(""); setSaleOnly(false); }}>Reset Filters</button>
               </div>
             ) : (
               <div className="products-grid">
                 {filteredProducts.map(p=>(
                   <ProductCard key={p.id} product={p} onView={setViewProduct} onWishlist={toggleWishlist} wishlist={wishlist} onAddToCart={handleAddToCart} pickMode={pickingFabricMode} onPick={handlePickFabric}/>
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

      {/* ══ MY CUSTOM ORDERS ══ */}
      {activeTab==="mycustomorders" && (
        <MyCustomOrdersPage user={user} onBrowse={()=>setActiveTab("madejustforyou")}/>
      )}

      {/* ══ SAVED ADDRESSES ══ */}
      {activeTab==="addresses" && (
        <SavedAddressesPage user={user}/>
      )}

      {/* ══ PAYMENT METHODS ══ */}
      {activeTab==="paymentmethods" && (
        <PaymentMethodsPage user={user}/>
      )}

      {/* ══ ACCOUNT SETTINGS ══ */}
      {activeTab==="accountsettings" && (
        <AccountSettingsPage user={user}/>
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
        <MadeJustForYou
          user={user}
          customFabricPick={customFabricPick}
          onClearFabricPick={() => setCustomFabricPick(null)}
          onBrowseSarees={handleBrowseSareesForCustom}
          onRequireLogin={() => setAuthModal("login")}
        />
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
    if (u?.token) {
      localStorage.setItem("token", u.token);
      // Sync any items added while browsing as a guest to the real backend cart.
      // Without this, the backend's cart stays empty even though the screen still
      // shows items — and checkout fails with "Cart is empty" at the last step.
      if (cartItems.length > 0) {
        Promise.all(cartItems.map(item =>
          apiAddToCart(item.product.id, item.qty, u.token, item.variant?.id).then(result => ({ key: item.key, cartItemId: result.id }))
        )).then(results => {
          setCartItems(prev => prev.map(i => {
            const match = results.find(r => r.key === i.key);
            return match ? { ...i, cartItemId: match.cartItemId } : i;
          }));
        }).catch(err => console.error("Failed to sync guest cart after login:", err.message));
      }
    }
  }}
/>
      )}
    </div>
  );
}
