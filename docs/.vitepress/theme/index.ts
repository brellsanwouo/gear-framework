import DefaultTheme from "vitepress/theme";
import { h } from "vue";
import { useData, type Theme } from "vitepress";
import "./custom.css";

const GearVersion = {
  setup() {
    const { theme } = useData();
    return () => h("span", { class: "gear-release" }, [
      h("span", { class: "gear-release__dot" }),
      `Current version ${theme.value.gearVersion}`
    ]);
  }
};

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("GearVersion", GearVersion);
  }
} satisfies Theme;
