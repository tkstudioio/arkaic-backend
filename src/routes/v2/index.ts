import { Hono } from "hono";
import { auth } from "@/routes/v2/auth";
import { bearerAuth } from "@/lib/auth";
import { listings } from "./listings";

export const v2 = new Hono();

v2.route("/listings", listings);
v2.route("/auth", auth);
