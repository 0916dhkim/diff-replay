import "./style.css";
import { render } from "@solidjs/web";
import { App } from "./App.jsx";

const app = document.getElementById("app")!;

render(() => <App />, app);
