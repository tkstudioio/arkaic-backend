import { Hono } from "hono";
import { auth } from "@/routes/v2/auth";
import { listings } from "./listings";
import { chats } from "./chats";
import { messages } from "./messages";
import { escrows } from "./escrows";

export const v2 = new Hono();

v2.route("/chats", chats);
v2.route("/messages", messages);
v2.route("/listings", listings);
v2.route("/escrows", escrows);
v2.route("/auth", auth);
