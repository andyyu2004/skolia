import { mount } from "svelte";
import Root from "./Root.svelte";
import "./app.css";

const target = document.getElementById("app");
if (!target) throw new Error("index.html has no #app element");
mount(Root, { target });
