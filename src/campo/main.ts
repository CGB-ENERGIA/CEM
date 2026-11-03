import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/jetbrains-mono/500.css";
import "../app.css";
import { mount } from "svelte";
import Campo from "./Campo.svelte";
import { registrarPwaCampo } from "./pwa";

registrarPwaCampo();

const app = mount(Campo, { target: document.getElementById("app")! });

export default app;
