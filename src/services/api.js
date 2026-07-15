import axios from "axios";

const API = axios.create({
  baseURL: process.env.REACT_APP_API_URL || "http://localhost:5000/api",
});

API.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ─── AUTH ─────────────────────────────
export const loginUser = async (email, password) => {
  const res = await API.post("/auth/login", { email, password });
  return res.data;
};

export const registerUser = async (userData) => {
  const res = await API.post("/auth/register", userData);
  return res.data;
};

// ─── CART ─────────────────────────────
export const addToCart = async (productId, quantity, token) => {
  const res = await API.post(
    "/cart",
    { productId, quantity },
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
  return res.data;
};

export const getCart = async (token) => {
  const res = await API.get("/cart", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return res.data;
};

export default API;