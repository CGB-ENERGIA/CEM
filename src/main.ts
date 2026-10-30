import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/jetbrains-mono/500.css";
import "./app.css";
import { mount } from "svelte";
import App from "./App.svelte";
import { registrarPwa } from "./lib/pwa.svelte";

registrarPwa();

const app = mount(App, { target: document.getElementById("app")! });

export default app;
