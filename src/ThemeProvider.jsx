import {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(
    localStorage.getItem("theme") || "light"
  );

  useEffect(() => {
    document.documentElement.setAttribute(
      "data-theme",
      theme
    );

    localStorage.setItem("theme", theme);
  }, [theme]);

  const dark = theme === "dark";

  const appTheme = {
    dark,

    base: dark
      ? "bg-black text-white border-white"
      : "bg-white text-black border-black",

    hover: dark
      ? "hover:bg-black hover:text-[var(--accent)] hover:border-[var(--accent)] hover:shadow-[10px_10px_0_var(--accent)]"
      : "hover:bg-[var(--accent)] hover:text-white hover:border-black hover:shadow-[10px_10px_0_#000]",

    transition:
      "transition-all duration-200 hover:scale-95",
  };

  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme,
        appTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}