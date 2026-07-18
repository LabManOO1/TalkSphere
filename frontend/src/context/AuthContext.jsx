import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import apiClient from "../api/client";

const AuthContext = createContext(null);

const TOKEN_KEY = "token";
const USER_KEY = "auth_user";

const parseApiError = (error, fallbackMessage) => {
  const detail = error.response?.data?.detail;

  if (typeof detail === "string") return detail;

  if (Array.isArray(detail)) {
    return (
      detail
        .map((item) => item?.msg)
        .filter(Boolean)
        .join(". ") || fallbackMessage
    );
  }

  if (!error.response) return "Не удалось подключиться к серверу";

  return fallbackMessage;
};

const decodeTokenPayload = (token) => {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;

    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );

    return JSON.parse(window.atob(padded));
  } catch {
    return null;
  }
};

const isExpired = (token) => {
  const payload = decodeTokenPayload(token);
  return Boolean(payload?.exp && payload.exp * 1000 <= Date.now());
};

const readStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
};

const getPayloadUsername = (payload) =>
  payload?.username || payload?.preferred_username || payload?.name || null;

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const clearSession = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
    setIsAuthenticated(false);
  };

  const saveSession = (token, userData) => {
    const normalizedUser = {
      id: userData?.id ?? null,
      username: userData?.username || "Пользователь",
      email: userData?.email || null,
    };

    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(normalizedUser));
    setUser(normalizedUser);
    setIsAuthenticated(true);
  };

  useEffect(() => {
    const handleUnauthorized = () => clearSession();

    window.addEventListener("auth:unauthorized", handleUnauthorized);

    const token = localStorage.getItem(TOKEN_KEY);

    if (!token || isExpired(token)) {
      handleUnauthorized();
      setLoading(false);

      return () => {
        window.removeEventListener("auth:unauthorized", handleUnauthorized);
      };
    }

    const payload = decodeTokenPayload(token);
    const storedUser = readStoredUser();
    const restoredUser = {
      id: storedUser?.id ?? payload?.sub ?? payload?.user_id ?? null,
      username:
        storedUser?.username || getPayloadUsername(payload) || "Пользователь",
      email: storedUser?.email || payload?.email || null,
    };

    localStorage.setItem(USER_KEY, JSON.stringify(restoredUser));
    setUser(restoredUser);
    setIsAuthenticated(true);
    setLoading(false);

    return () => {
      window.removeEventListener("auth:unauthorized", handleUnauthorized);
    };
  }, []);

  const register = async (username, email, password) => {
    try {
      const response = await apiClient.post("/auth/register", {
        username,
        email,
        password,
      });

      const token = response.data?.access_token;
      if (!token) {
        return { success: false, error: "Сервер не вернул токен доступа" };
      }

      const payload = decodeTokenPayload(token);
      const responseUser = response.data?.user || {};

      saveSession(token, {
        id: responseUser.id ?? payload?.sub ?? null,
        username: responseUser.username ?? username,
        email: responseUser.email ?? email,
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: parseApiError(error, "Ошибка регистрации"),
      };
    }
  };

  const login = async (username, password) => {
    try {
      const previousUser = readStoredUser();
      const body = new URLSearchParams();
      body.set("username", username);
      body.set("password", password);

      const response = await apiClient.post("/auth/login", body, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      const token = response.data?.access_token;
      if (!token) {
        return { success: false, error: "Сервер не вернул токен доступа" };
      }

      const payload = decodeTokenPayload(token);
      const responseUser = response.data?.user || {};
      const resolvedUsername =
        responseUser.username || getPayloadUsername(payload) || username;
      const sameStoredUser =
        previousUser?.username?.trim().toLowerCase() ===
        resolvedUsername.trim().toLowerCase();

      saveSession(token, {
        id: responseUser.id ?? payload?.sub ?? null,
        username: resolvedUsername,
        email:
          responseUser.email ||
          payload?.email ||
          (sameStoredUser ? previousUser?.email : null),
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: parseApiError(error, "Ошибка входа"),
      };
    }
  };

  const logout = () => clearSession();

  const value = useMemo(
    () => ({ user, loading, isAuthenticated, register, login, logout }),
    [user, loading, isAuthenticated],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth должен использоваться внутри AuthProvider");
  }
  return context;
};
