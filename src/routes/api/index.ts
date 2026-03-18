import { Hono } from "hono";

import { auth } from "@/routes/api/auth";
import { attributes } from "@/routes/api/attributes";
import { categories } from "@/routes/api/categories";
import { listings } from "@/routes/api/listings";
import { chats } from "@/routes/api/chats";
import { messages } from "@/routes/api/messages";
import { escrows } from "@/routes/api/escrows";

export const api = new Hono();
api.route("/chats", chats);
api.route("/messages", messages);
api.route("/listings", listings);
api.route("/escrows", escrows);
api.route("/auth", auth);
api.route("/categories", categories);
api.route("/attributes", attributes);
